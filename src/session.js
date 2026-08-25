/**
 * Sessions are plain JSON files on disk, one per name: the current URL, the
 * distilled blocks of the page it holds, how far the last render got through
 * them, and a short history. No daemon, no background process; cookies live in
 * a separate sidecar file (see cookies.js).
 *
 * The file exists so `oc do <n>` can follow a link the compact view never
 * printed the URL of. Hiding URLs is what makes `oc open` cheap; this is what
 * makes hiding them free. Keeping the blocks costs disk, not tokens, and it is
 * what lets `oc read` and `oc next` answer without fetching the page again.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';

export const DEFAULT_SESSION = 'default';

// OC_HOME relocates the whole state directory, for sandboxes, CI, and tests.
export const sessionDir = () => join(process.env.OC_HOME ?? join(homedir(), '.only-cli'), 'sessions');

// A session name is interpolated straight into a filename, and the cookie
// sidecar it names now holds real credentials, so a name that is a path
// (absolute, or with a separator or '..') could write or delete a file outside
// the store. Names are user-facing labels, so this charset loses nothing real.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * @param {string} name
 * @returns {string} the same name, once it is known to be a safe filename
 */
export function assertSafeName(name) {
  if (typeof name !== 'string' || name === '.' || name === '..' || !SAFE_NAME.test(name)) {
    throw new Error(`invalid session name '${name}', use letters, numbers, '.', '-', or '_'`);
  }
  return name;
}

/**
 * @param {string} name
 * @returns {string}
 */
export const sessionPath = (name) => join(sessionDir(), `${assertSafeName(name)}.json`);

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

// A ceiling on what one page may leave on disk. Nothing real comes close;
// it is here so a runaway page cannot fill a home directory.
const SNAPSHOT_CHARS = 500_000;

/**
 * Session state for a freshly rendered page. Every block is kept, including
 * the ones the budget stopped short of, because the part an agent wants next
 * is by definition the part that did not fit.
 * @param {import('./distill.js').Page} page
 * @param {{history?: string[]}} [previous]
 * @param {{cursor?: number|null}} [opts] - where the render stopped, null when it finished the page
 */
export function sessionFromPage(page, previous, { cursor = 0 } = {}) {
  /** @type {import('./distill.js').Block[]} */
  const blocks = [];
  let chars = 0;
  let dropped = 0;
  for (const block of page.blocks) {
    chars += block.text.length;
    if (chars > SNAPSHOT_CHARS) {
      dropped++;
      continue;
    }
    const href = block.href ? resolveHref(block.href, page.url) : null;
    blocks.push({
      type: block.type,
      text: block.text,
      ...(block.n == null ? {} : { n: block.n }),
      ...(block.level == null ? {} : { level: block.level }),
      ...(href ? { href } : {}),
      ...(block.name ? { name: block.name } : {}),
    });
  }
  const history = [...(previous?.history ?? []), page.url].slice(-HISTORY_LIMIT);
  return {
    url: page.url,
    title: page.title,
    savedAt: new Date().toISOString(),
    blocks,
    cursor,
    ...(dropped ? { dropped } : {}),
    history,
  };
}

/**
 * Handle lookup for a saved page. Sessions written by earlier versions hold a
 * handles map instead of blocks, so `oc do` keeps working across an upgrade
 * even though `oc read` and `oc next` need the page reopened.
 * @param {any} state
 * @param {number} n
 */
export function handleFor(state, n) {
  if (state?.blocks) return state.blocks.find((b) => b.n === n) ?? null;
  return state?.handles?.[n] ?? null;
}

/**
 * The numbers a saved page offers, for error messages that tell an agent what
 * it could have asked for.
 * @param {any} state
 * @returns {number[]}
 */
export function handleNumbers(state) {
  if (state?.blocks) return state.blocks.filter((b) => b.n != null).map((b) => b.n);
  return Object.keys(state?.handles ?? {}).map(Number);
}

/**
 * @param {string} name
 * @param {object} state
 */
export function saveSession(name, state) {
  mkdirSync(sessionDir(), { recursive: true });
  // A snapshot of an authenticated page holds that page's text, so it gets the
  // same owner-only mode as the cookie sidecar. writeFileSync only sets the
  // mode on create, so a snapshot left world-readable by an older version is
  // tightened explicitly on the next save.
  const path = sessionPath(name);
  writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Drop a saved page. `oc logout` calls this alongside clearing the cookie jar:
 * a snapshot taken under a login holds that page's text, so leaving it behind
 * would make logout mean "the cookies are gone" rather than "nothing of this
 * login remains".
 * @param {string} name
 */
export function clearSession(name) {
  try {
    unlinkSync(sessionPath(name));
  } catch {
    // nothing saved under that name is fine
  }
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
