/**
 * Sessions are plain JSON files on disk, one per name: the current URL, the
 * numbered handles from the last render so actions can resolve them, and a
 * short history. No daemon, no background process, no cookies yet.
 *
 * The file exists so `oc do <n>` can follow a link the compact view never
 * printed the URL of. Hiding URLs is what makes `oc open` cheap; this is what
 * makes hiding them free.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const DEFAULT_SESSION = 'default';

// OC_HOME relocates the whole state directory, for sandboxes, CI, and tests.
export const sessionDir = () => join(process.env.OC_HOME ?? join(homedir(), '.only-cli'), 'sessions');

/**
 * @param {string} name
 * @returns {string}
 */
export const sessionPath = (name) => join(sessionDir(), `${name}.json`);

// Search engines and link aggregators wrap outbound links in a tracking
// redirector whose landing page is a script, not content, so following one
// verbatim renders nothing. The target is sitting in the query string.
const REDIRECT_PATH = /^\/(l|l\.php|url|out|redirect|away|link)\/?$/i;
const REDIRECT_PARAMS = ['uddg', 'url', 'u', 'q', 'target', 'to', 'dest'];

/**
 * @param {URL} url
 * @returns {string|null} the wrapped destination, or null if this is a normal link
 */
function unwrapRedirect(url) {
  if (!REDIRECT_PATH.test(url.pathname)) return null;
  for (const param of REDIRECT_PARAMS) {
    const value = url.searchParams.get(param);
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

/**
 * Absolute URL for a handle, or null when the link is not followable
 * (javascript: handlers, malformed hrefs).
 * @param {string} href
 * @param {string} base
 * @returns {string|null}
 */
export function resolveHref(href, base) {
  if (!href || /^(javascript|about):/i.test(href)) return null;
  try {
    const url = new URL(href, base || undefined);
    return unwrapRedirect(url) ?? url.href;
  } catch {
    return null;
  }
}

const HISTORY_LIMIT = 20;

/**
 * Session state for a freshly rendered page. Every numbered block is kept,
 * including the ones the budget skipped, because the handles an agent wants
 * are often the ones that did not fit.
 * @param {import('./distill.js').Page} page
 * @param {{history?: string[]}} [previous]
 */
export function sessionFromPage(page, previous) {
  /** @type {Record<string, {type: string, text: string, href?: string, name?: string}>} */
  const handles = {};
  for (const block of page.blocks) {
    if (block.n == null) continue;
    const url = block.href ? resolveHref(block.href, page.url) : null;
    handles[block.n] = {
      type: block.type,
      text: block.text,
      ...(url ? { href: url } : {}),
      ...(block.name ? { name: block.name } : {}),
    };
  }
  const history = [...(previous?.history ?? []), page.url].slice(-HISTORY_LIMIT);
  return { url: page.url, title: page.title, savedAt: new Date().toISOString(), handles, history };
}

/**
 * @param {string} name
 * @param {object} state
 */
export function saveSession(name, state) {
  mkdirSync(sessionDir(), { recursive: true });
  writeFileSync(sessionPath(name), JSON.stringify(state));
}

/**
 * Missing or unreadable state is not an error: it means nothing is open yet,
 * and the caller says so in a sentence that names the next command.
 * @param {string} name
 * @returns {any|null}
 */
export function loadSession(name) {
  try {
    return JSON.parse(readFileSync(sessionPath(name), 'utf8'));
  } catch {
    return null;
  }
}
