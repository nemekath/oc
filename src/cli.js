#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fetchPage } from './fetch.js';
import { distill, toMarkdown, toHTML } from './distill.js';
import { render, estimateTokens } from './render.js';
import * as act from './act.js';
import { DEFAULT_SESSION, loadSession, saveSession, sessionFromPage } from './session.js';

const HELP = `only-cli: the web as a compact terminal, built for AI agents.

usage: oc <command> [args] [flags]

  open <url>          fetch and render a page with numbered actions
  find <query>        where a string appears on the page already open
  next                the next budget worth of the page already open
  read <n>            full text of the region at [n], up to 2000 tokens
  raw [url]           distilled markdown of the whole page
  do <n>              follow the numbered link [n], or read [n] if it is text
  fill <n> <text>     type into a numbered input               (v0.2)
  submit [n]          submit a form                            (v0.2)
  back                return to the previous page              (v0.2)
  session ls|rm       manage saved sessions                    (v0.2)

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

'oc open' remembers the page it printed, so 'oc do 3' follows link [3] without
you ever handling its URL, and 'oc next' or 'oc read 12' picks up what the
budget left behind without fetching it again. State lives in ~/.only-cli
(override with OC_HOME).`;

// A rendered page has to be remembered or its [3] means nothing to the next
// command. Saving state must never break a render, so a home directory that
// cannot be written costs the agent `do`, `read`, and `next`, and nothing else.
const remember = (page, name, cursor) => {
  try {
    saveSession(name, sessionFromPage(page, loadSession(name), { cursor }));
  } catch {}
};

// What browsing costs without this tool is the raw page HTML in context.
const savings = (out, raw) =>
  `~${out} tokens vs ~${raw} for the page HTML (${Math.max(0, 100 - Math.round((out / Math.max(raw, 1)) * 100))}% saved)`;

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

  const [command, ...args] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return;
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
      if (values.json) {
        const page = distill(html, finalUrl);
        remember(page, sessionName);
        console.log(JSON.stringify(page));
        if (verbose) console.error(resources());
        return;
      }
      const htmlTokens = estimateTokens(html);
      if (command === 'raw') {
        const out = values.html ? toHTML(html) : toMarkdown(html);
        console.log(out);
        if (verbose) console.error(`${savings(estimateTokens(out), htmlTokens)}; ${resources()}`);
        return;
      }
      const page = distill(html, finalUrl);
      const { text, stats } = render(page, { budget });
      remember(page, sessionName, stats.next);
      console.log(text);
      if (verbose) {
        console.error(`~${stats.tokens} tokens, ${stats.rendered}/${stats.blocks} blocks rendered, ${savings(stats.tokens, htmlTokens)}; ${resources()}`);
      }
      return;
    }
    case 'read': return console.log(act.read(Number(args[0]), { session: sessionName, budget: asked || 2000 }));
    case 'next': return console.log(act.next({ session: sessionName, budget: asked || 500 }));
    case 'find': return console.log(act.find(args.join(' '), { session: sessionName, budget: asked || 500 }));
    case 'fill': return act.fill(Number(args[0]), args.slice(1).join(' '));
    case 'submit': return act.submit(args[0] ? Number(args[0]) : undefined);
    case 'back': return act.back();
    case 'session': throw new act.NotImplemented('session');
    default:
      throw new Error(`unknown command '${command}', run oc --help`);
  }
}

main().catch((err) => {
  console.error(`oc: ${err.message}`);
  process.exit(1);
});
