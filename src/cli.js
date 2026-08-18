#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fetchPage } from './fetch.js';
import { distill, toMarkdown, toHTML } from './distill.js';
import { render, estimateTokens } from './render.js';
import * as act from './act.js';

const HELP = `only-cli: the web as a compact terminal, built for AI agents.

usage: oc <command> [args] [flags]

  open <url>          fetch and render a page with numbered actions
  raw <url>           distilled markdown of the whole page
  do <n>              activate a numbered element              (v0.2)
  fill <n> <text>     type into a numbered input               (v0.2)
  submit [n]          submit a form                            (v0.2)
  read [n]            full text of one region                  (v0.2)
  find <query>        search visible text on the current page  (v0.2)
  back | next         history and pagination                   (v0.2)
  session ls|rm       manage saved sessions                    (v0.2)

flags:
  --budget <tokens>   tighten or loosen the render budget (default 500)
  --json              machine-stable JSON output
  --html              raw only: cleaned HTML instead of markdown
  --verbose, -v       metrics on stderr: tokens saved vs the page HTML, HTTP
                      status and client identity, timing, transfer size, and
                      memory. --stats is an alias; OC_VERBOSE=1 turns it on
                      globally. Off by default because metrics cost tokens too.
  --session <name>    named session                            (v0.2)`;

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

  switch (command) {
    case 'open':
    case 'raw': {
      const url = args[0];
      if (!url) throw new Error(`usage: oc ${command} <url>`);
      const budget = values.budget ? Number(values.budget) : 500;
      if (!Number.isFinite(budget) || budget <= 0) throw new Error('--budget must be a positive number');
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
        console.log(JSON.stringify(distill(html, finalUrl)));
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
      console.log(text);
      if (verbose) {
        console.error(`~${stats.tokens} tokens, ${stats.rendered}/${stats.blocks} blocks rendered, ${savings(stats.tokens, htmlTokens)}; ${resources()}`);
      }
      return;
    }
    case 'do': return act.activate(Number(args[0]));
    case 'fill': return act.fill(Number(args[0]), args.slice(1).join(' '));
    case 'submit': return act.submit(args[0] ? Number(args[0]) : undefined);
    case 'read': return act.read(args[0] ? Number(args[0]) : undefined);
    case 'find': return act.find(args.join(' '));
    case 'back': return act.back();
    case 'next': return act.next();
    case 'session': throw new act.NotImplemented('session');
    default:
      throw new Error(`unknown command '${command}', run oc --help`);
  }
}

main().catch((err) => {
  console.error(`oc: ${err.message}`);
  process.exit(1);
});
