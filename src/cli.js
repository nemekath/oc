#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fetchPage } from './fetch.js';
import { distill, toMarkdown, toHTML } from './distill.js';
import { render, estimateTokens, contentTokens, contentFailure, MIN_CONTENT } from './render.js';
import { resolveSite, listSites } from './sites.js';
import { sphinxSearch } from './sphinx.js';
import { nodeSearch } from './nodedocs.js';
import { rdocSearch } from './rdoc.js';
import { apiSearch } from './apisearch.js';
import * as act from './act.js';
import { DEFAULT_SESSION, loadSession, saveSession, sessionFromPage } from './session.js';

const HELP = `only-cli: the web as a compact terminal, built for AI agents.

usage: oc <command> [args] [flags]

  open <url>          fetch and render a page with numbered actions
  <site> <verb> ...   site shortcut: 'oc hn top', 'oc reddit sub ClaudeAI'
  sites               the site shortcuts that ship with oc
  find <query>        where a string appears on the page already open, or
                      the region itself when only one place matches
  next                the next budget worth of the page already open
  read <n>            full text of the region at [n], up to 2000 tokens
  raw [url]           distilled markdown of the whole page
  do <n>              follow the numbered link [n], or read [n] if it is text
  fill <n> <text>     type into a numbered input               (planned)
  submit [n]          submit a form                            (planned)
  back                return to the previous page              (planned)
  session ls|rm       manage saved sessions                    (planned)

flags:
  --budget <tokens>   tighten or loosen the render budget (default 500,
                      2000 for read). It is a target, not a ceiling: a page
                      that would finish within about four times it is printed
                      whole rather than costing you a second command
  --json              machine-stable JSON output
  --html              raw only: cleaned HTML instead of markdown
  --verbose, -v       metrics on stderr: tokens saved vs the page HTML, HTTP
                      status and client identity, timing, transfer size, and
                      memory. --stats is an alias; OC_VERBOSE=1 turns it on
                      globally. Off by default because metrics cost tokens too.
  --session <name>    keep separate page state under a name (default: default)

A page that comes back with no readable text (JavaScript-only, a consent wall,
a bot challenge) says so in one line on stderr and exits 2, so a caller can
tell an empty page from a page oc could not read and fall back to a browser.

'oc open' remembers the page it printed, so 'oc do 3' follows link [3] without
you ever handling its URL, and 'oc next' or 'oc read 12' picks up what the
budget left behind without fetching it again. 'oc do' on a search result title
opens the result, because that title is a link. State lives in ~/.only-cli
(override with OC_HOME).`;

// A rendered page has to be remembered or its [3] means nothing to the next
// command. Saving state must never break a render, so a home directory that
// cannot be written costs the agent `do`, `read`, and `next`, and nothing
// else, but silently: a sandbox that blocks the write leaves `do` resolving
// against whatever session last saved successfully, possibly from an
// unrelated page, with no sign anything is wrong. So the failure still prints,
// on stderr where it costs nothing until something breaks.
const remember = (page, name, cursor) => {
  try {
    saveSession(name, sessionFromPage(page, loadSession(name), { cursor }));
  } catch (err) {
    console.error(`oc: warning: could not save session '${name}' (${err.message}), 'do'/'read'/'next' may act on stale state`);
  }
};

// What browsing costs without this tool is the raw page HTML in context.
const savings = (out, raw) =>
  `~${out} tokens vs ~${raw} for the page HTML (${Math.max(0, 100 - Math.round((out / Math.max(raw, 1)) * 100))}% saved)`;

// Nonzero, and distinct from the exit 1 that every other failure uses, so a
// caller can branch on 'oc could not read this' without parsing prose.
const NO_CONTENT_EXIT = 2;

const noContent = (url, detail, hint = "; 'oc raw' has the page's markdown if there is any, otherwise this one needs a browser") => {
  console.error(`oc: no readable content at ${url} (${detail}), so it is JavaScript-only, gated, or challenged${hint}`);
  // Not process.exit: stdout may still be draining, and whatever did render is
  // worth printing even when the render failed.
  process.exitCode = NO_CONTENT_EXIT;
};

// Anything else in the first position is tried as a site shortcut before it is
// called unknown, so a new clis/ definition needs no change here.
const COMMANDS = new Set([
  'open', 'do', 'raw', 'read', 'next', 'find', 'fill', 'submit', 'back', 'session', 'sites',
]);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      html: { type: 'boolean', default: false },
      stats: { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      budget: { type: 'string' },
      session: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  // Metrics cost tokens too, so they are opt-in: agents pass --verbose only
  // when their own verbose mode is on, or the user exports OC_VERBOSE=1.
  const verbose = values.stats || values.verbose || process.env.OC_VERBOSE === '1';

  let [command, ...args] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  // A first word that is not a command may still be a site oc ships a
  // definition for, and a shortcut is only ever a URL, so it resolves to one
  // here and the rest of this function never learns it was not typed.
  let search = null;
  if (!COMMANDS.has(command)) {
    const site = resolveSite(command, args);
    if (!site) throw new Error(`unknown command '${command}', run oc --help`);
    // Only a search shape resolves with a query; a URL shape never has one.
    if (site.query != null) {
      search = site;
      command = 'search';
    } else {
      args = [site.url];
      command = 'open';
    }
  }

  const sessionName = values.session || DEFAULT_SESSION;
  // Zero means "whatever this command's default is", which differs: the
  // compact view targets 500 tokens, read targets 2000.
  const asked = values.budget ? Number(values.budget) : 0;
  if (values.budget && (!Number.isFinite(asked) || asked <= 0)) {
    throw new Error('--budget must be a positive number');
  }

  switch (command) {
    case 'open':
    case 'do':
    case 'raw': {
      // `do` is `open` with the URL looked up from the last render instead of
      // typed, so both commands share one fetch, render, and save path. `raw`
      // with no URL means the page already open, which is what the compact
      // view's footer offers when it has cut something.
      let url;
      if (command === 'do') {
        const target = act.activate(Number(args[0]), { session: sessionName });
        // A number that points at text has no page behind it, so `do` reads it
        // rather than making the agent pay for a second command to be told.
        if (target.read != null) {
          return console.log(act.read(target.read, { session: sessionName, budget: asked || 2000 }));
        }
        url = target.url;
      } else {
        url = args[0] ?? (command === 'raw' ? loadSession(sessionName)?.url : undefined);
      }
      if (!url) throw new Error(`usage: oc ${command} <url>`);
      const budget = asked || 500;
      const t0 = performance.now();
      const { url: finalUrl, html, status, via } = await fetchPage(url);
      const fetchMs = performance.now() - t0;
      const resources = () => {
        const processMs = performance.now() - t0 - fetchMs;
        const rss = process.memoryUsage().rss;
        return `HTTP ${status} via ${via}, fetch ${Math.round(fetchMs)}ms, process ${Math.round(processMs)}ms, `
          + `${Math.round(html.length / 1024)}KB transferred, ${Math.round(rss / 1048576)}MB memory`;
      };
      const htmlTokens = estimateTokens(html);
      if (values.json) {
        const page = distill(html, finalUrl);
        remember(page, sessionName);
        const failure = contentFailure(contentTokens(page), htmlTokens);
        // Always present, so a caller can branch on the field rather than on
        // whether a field it was hoping for turned up.
        console.log(JSON.stringify({ ...page, empty: failure != null }));
        if (verbose) console.error(resources());
        if (failure) noContent(finalUrl, failure);
        return;
      }
      if (command === 'raw') {
        const out = values.html ? toHTML(html, finalUrl) : toMarkdown(html, finalUrl);
        const outTokens = estimateTokens(out);
        console.log(out);
        if (verbose) {
          const cost = outTokens < MIN_CONTENT
            ? `nothing distilled out of ~${htmlTokens} tokens of page HTML`
            : savings(outTokens, htmlTokens);
          console.error(`${cost}; ${resources()}`);
        }
        // Only the blank case here. `raw` is the fallback the compact view's
        // failure line names, so it must not fail on the same pages: a page
        // whose only text is its menu still has markup, and printing it is the
        // whole point of `raw`.
        if (outTokens < MIN_CONTENT) noContent(finalUrl, `~${outTokens} tokens of markdown`, '');
        return;
      }
      const page = distill(html, finalUrl);
      const failure = contentFailure(contentTokens(page), htmlTokens);
      const { text, stats } = render(page, { budget });
      remember(page, sessionName, stats.next);
      console.log(text);
      if (verbose) {
        // Reporting '100% saved' of a render that extracted nothing is the one
        // place this line lies, and it lies in the tool's own favour.
        const cost = failure
          ? `no content distilled out of ~${htmlTokens} tokens of page HTML`
          : savings(stats.tokens, htmlTokens);
        console.error(`~${stats.tokens} tokens, ${stats.rendered}/${stats.blocks} blocks rendered, ${cost}; ${resources()}`);
      }
      if (failure) noContent(finalUrl, failure);
      return;
    }
    case 'search': {
      // A search oc runs itself: a site's static index or docs corpus is
      // fetched (or read back from its day cache) and ranked here, a JSON
      // search API is asked directly. Either way the result list rides the
      // exact `open` path: distilled, rendered, remembered, so `do <n>`
      // follows a result. Only the list is ever printed; the index, corpus,
      // and response stay out of context.
      const t0 = performance.now();
      const local = { sphinx: sphinxSearch, nodedoc: nodeSearch, rdoc: rdocSearch };
      const kind = Object.keys(local).find((k) => search[k]);
      const { url, html, via } = kind
        ? await local[kind](search[kind], search.query)
        : await apiSearch(search.api, search.query);
      const page = distill(html, url);
      if (values.json) {
        remember(page, sessionName);
        console.log(JSON.stringify({ ...page, empty: false }));
        return;
      }
      const { text, stats } = render(page, { budget: asked || 500 });
      remember(page, sessionName, stats.next);
      console.log(text);
      if (verbose) {
        console.error(`~${stats.tokens} tokens, results via ${via}, ${Math.round(performance.now() - t0)}ms`);
      }
      return;
    }
    case 'read': return console.log(act.read(Number(args[0]), { session: sessionName, budget: asked || 2000 }));
    case 'next': return console.log(act.next({ session: sessionName, budget: asked || 500 }));
    case 'find': return console.log(act.find(args.join(' '), { session: sessionName, budget: asked || 500 }));
    case 'fill': return act.fill(Number(args[0]), args.slice(1).join(' '));
    case 'submit': return act.submit(args[0] ? Number(args[0]) : undefined);
    case 'back': return act.back();
    case 'sites': return console.log(listSites());
    case 'session': throw new act.NotImplemented('session');
    default:
      throw new Error(`unknown command '${command}', run oc --help`);
  }
}

main().catch((err) => {
  console.error(`oc: ${err.message}`);
  process.exit(1);
});
