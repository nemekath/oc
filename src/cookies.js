/**
 * Per-session cookie jar, stored in a sidecar file next to the page-state
 * JSON. Credentials never live in the session snapshot itself.
 */

import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, chmodSync } from 'node:fs';

import { sessionDir, assertSafeName } from './session.js';

const DEFAULT_EXPIRES_MS = 60 * 60 * 1000; // 1h
export { DEFAULT_EXPIRES_MS };
const FILE_MODE = 0o600;

/** Returned by loadCookieJar when a sidecar existed but its session ceiling had passed. */
export const JAR_EXPIRED = Object.freeze({ expired: true });

let purged = false;

/**
 * @param {string} name
 * @returns {string}
 */
export function cookieJarPath(name) {
  return join(sessionDir(), `${assertSafeName(name)}.cookies.json`);
}

/**
 * Parse --expires values like 1h, 30m, 2d into milliseconds.
 * @param {string} value
 * @returns {number}
 */
export function parseExpires(value) {
  const m = String(value).trim().match(/^(\d+(?:\.\d+)?)(h|m|d|s)?$/i);
  if (!m) throw new Error(`invalid --expires '${value}', use a duration like 1h, 30m, or 2d`);
  const n = Number(m[1]);
  const unit = (m[2] ?? 'h').toLowerCase();
  const mult = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000;
  return n * mult;
}

/**
 * @typedef {Object} Cookie
 * @property {string} name
 * @property {string} value
 * @property {string} domain
 * @property {string} path
 * @property {boolean} [secure]
 * @property {boolean} [httpOnly]
 * @property {string} [expires] - ISO timestamp
 */

/**
 * @typedef {Object} CookieJar
 * @property {string} expiresAt - ISO session ceiling
 * @property {Cookie[]} cookies
 */

/**
 * Seed a jar from a Cookie request header string.
 * @param {string} header
 * @param {string} domain
 * @param {{ expiresMs?: number }} [opts]
 * @returns {CookieJar}
 */
export function jarFromCookieHeader(header, domain, { expiresMs = DEFAULT_EXPIRES_MS } = {}) {
  const host = domain.toLowerCase().replace(/^\./, '');
  if (!host || host.includes('/') || host.includes(':')) {
    throw new Error('--domain must be a hostname like example.com');
  }
  /** @type {Cookie[]} */
  const cookies = [];
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name) continue;
    cookies.push({ name, value, domain: host, path: '/' });
  }
  if (!cookies.length) throw new Error('no cookies found in --cookie string');
  return {
    expiresAt: new Date(Date.now() + expiresMs).toISOString(),
    cookies,
  };
}

/**
 * @param {CookieJar} jar
 * @returns {boolean}
 */
export function isSessionExpired(jar) {
  return Date.now() >= Date.parse(jar.expiresAt);
}

/**
 * @param {Cookie} cookie
 * @param {string} sessionCeiling
 * @returns {boolean}
 */
function isCookieExpired(cookie, sessionCeiling) {
  const ceiling = Date.parse(sessionCeiling);
  if (Date.now() >= ceiling) return true;
  if (!cookie.expires) return false;
  const exp = Date.parse(cookie.expires);
  if (Number.isNaN(exp)) return false;
  return exp <= Date.now() || exp > ceiling;
}

/**
 * @param {CookieJar} jar
 * @returns {CookieJar}
 */
function pruneExpiredCookies(jar) {
  return {
    ...jar,
    cookies: jar.cookies.filter((c) => !isCookieExpired(c, jar.expiresAt)),
  };
}

/**
 * Read this session's jar before the process-wide purge can erase the evidence
 * of expiry; then sweep other stale sidecars.
 * @param {string} name
 * @returns {CookieJar | typeof JAR_EXPIRED | null}
 */
export function loadCookieJar(name) {
  let result = null;
  try {
    const jar = /** @type {CookieJar} */ (JSON.parse(readFileSync(cookieJarPath(name), 'utf8')));
    if (!jar?.expiresAt || !Array.isArray(jar.cookies)) {
      result = null;
    } else if (isSessionExpired(jar)) {
      clearCookieJar(name);
      result = JAR_EXPIRED;
    } else {
      const pruned = pruneExpiredCookies(jar);
      if (!pruned.cookies.length) {
        clearCookieJar(name);
        result = JAR_EXPIRED;
      } else {
        result = pruned;
      }
    }
  } catch {
    result = null;
  }
  ensurePurged();
  return result;
}

/**
 * @param {string} name
 * @param {CookieJar} jar
 */
export function saveCookieJar(name, jar) {
  mkdirSync(sessionDir(), { recursive: true });
  // writeFileSync only sets the mode on create, so an existing sidecar has its
  // owner-only mode reasserted on every save.
  const path = cookieJarPath(name);
  writeFileSync(path, JSON.stringify(pruneExpiredCookies(jar)), { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

/**
 * @param {string} name
 */
export function clearCookieJar(name) {
  try {
    unlinkSync(cookieJarPath(name));
  } catch {
    // missing file is fine
  }
}

/**
 * Delete expired sidecar jars under OC_HOME/sessions.
 */
export function purgeExpiredJars() {
  let dir;
  try {
    dir = sessionDir();
    readdirSync(dir);
  } catch {
    return;
  }
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.cookies.json')) continue;
    const name = file.slice(0, -'.cookies.json'.length);
    try {
      const jar = /** @type {CookieJar} */ (JSON.parse(readFileSync(join(dir, file), 'utf8')));
      if (isSessionExpired(jar)) clearCookieJar(name);
    } catch {
      try { unlinkSync(join(dir, file)); } catch {}
    }
  }
}

function ensurePurged() {
  if (purged) return;
  purged = true;
  purgeExpiredJars();
}

/** Reset purge-once guard (tests). */
export function _resetPurgeGuard() {
  purged = false;
}

/**
 * RFC 6265 domain matching (host-only and domain cookies).
 * @param {Cookie} cookie
 * @param {string} host
 */
function domainMatches(cookie, host) {
  const d = cookie.domain.toLowerCase().replace(/^\./, '');
  return host === d || host.endsWith(`.${d}`);
}

/**
 * @param {Cookie} cookie
 * @param {string} path
 */
function pathMatches(cookie, path) {
  const p = cookie.path || '/';
  if (path === p) return true;
  if (!path.startsWith(p)) return false;
  return p.endsWith('/') || path[p.length] === '/';
}

/**
 * Cookies to send for a request URL.
 * @param {CookieJar} jar
 * @param {string} urlStr
 * @returns {string | undefined}
 */
export function cookieHeaderFor(jar, urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname || '/';
  const secure = url.protocol === 'https:';
  const active = jar.cookies.filter((c) => {
    if (isCookieExpired(c, jar.expiresAt)) return false;
    if (c.secure && !secure) return false;
    return domainMatches(c, host) && pathMatches(c, path);
  });
  if (!active.length) return undefined;
  return active.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Parse one Set-Cookie header value.
 * @param {string} header
 * @param {string} requestUrl
 * @returns {Cookie | null}
 */
export function parseSetCookie(header, requestUrl) {
  const parts = header.split(';').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const eq = parts[0].indexOf('=');
  if (eq <= 0) return null;
  const name = parts[0].slice(0, eq).trim();
  const value = parts[0].slice(eq + 1).trim();
  if (!name) return null;

  const url = new URL(requestUrl);
  /** @type {Cookie} */
  const cookie = {
    name,
    value,
    domain: url.hostname.toLowerCase(),
    path: '/',
  };

  for (const attr of parts.slice(1)) {
    const sep = attr.indexOf('=');
    const key = (sep === -1 ? attr : attr.slice(0, sep)).trim().toLowerCase();
    const val = sep === -1 ? '' : attr.slice(sep + 1).trim();
    // The Domain attribute is deliberately ignored: cookies learned from a
    // response are pinned host-only to the host that set them. Honoring Domain
    // safely needs the Public Suffix List (a site could otherwise scope a
    // cookie to '.com' and have it sent to every site under it), and a PSL is a
    // dependency this project will not take. User-seeded cookies still scope by
    // the --domain they pass, which is trusted input.
    if (key === 'path') {
      cookie.path = val || '/';
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'max-age') {
      const age = Number(val);
      if (Number.isFinite(age)) {
        cookie.expires = new Date(Date.now() + age * 1000).toISOString();
      }
    } else if (key === 'expires') {
      const exp = Date.parse(val);
      if (!Number.isNaN(exp)) cookie.expires = new Date(exp).toISOString();
    }
  }
  return cookie;
}

/**
 * Extract Set-Cookie header values from a fetch/impers response.
 * @param {any} res
 * @returns {string[]}
 */
export function getSetCookieHeaders(res) {
  if (typeof res.headers?.getSetCookie === 'function') {
    const list = res.headers.getSetCookie();
    if (Array.isArray(list) && list.length) return list;
  }
  const raw = res.headers?.get?.('set-cookie');
  if (!raw) return [];
  // Undici joins with ", " but Expires contains commas: split only on ", " followed by a token=
  return raw.split(/,\s(?=[\w!#$%&'*+\-.^`|~]+=)/);
}

/**
 * Apply Set-Cookie headers to the jar for a response URL.
 * @param {CookieJar} jar
 * @param {string} url
 * @param {string[]} setCookieHeaders
 * @returns {CookieJar}
 */
export function storeFromResponse(jar, url, setCookieHeaders) {
  if (!setCookieHeaders.length) return jar;
  let cookies = [...jar.cookies];
  for (const header of setCookieHeaders) {
    const parsed = parseSetCookie(header, url);
    if (!parsed) continue;
    // Max-Age=0 or Expires in the past deletes the cookie
    if (parsed.expires && Date.parse(parsed.expires) <= Date.now()) {
      cookies = cookies.filter((c) => !(c.name === parsed.name && domainMatches(c, parsed.domain)));
      continue;
    }
    cookies = cookies.filter((c) => !(c.name === parsed.name && domainMatches(c, parsed.domain)));
    if (parsed.expires) {
      const ceiling = Date.parse(jar.expiresAt);
      const exp = Date.parse(parsed.expires);
      if (exp > ceiling) parsed.expires = jar.expiresAt;
    }
    cookies.push(parsed);
  }
  return { ...jar, cookies };
}

/**
 * Mutable jar wrapper for fetch to update in place.
 * @param {string} sessionName
 * @param {CookieJar} data
 */
export function createJarHandle(sessionName, data) {
  let jar = data;
  return {
    sessionName,
    cookieHeaderFor(url) {
      return cookieHeaderFor(jar, url);
    },
    storeFromResponse(url, headers) {
      jar = storeFromResponse(jar, url, headers);
    },
    toJSON() {
      return jar;
    },
  };
}

/**
 * @param {string} name
 * @param {string} header
 * @param {string} domain
 * @param {{ expiresMs?: number }} [opts]
 */
export function loginCookieJar(name, header, domain, opts) {
  const jar = jarFromCookieHeader(header, domain, opts);
  saveCookieJar(name, jar);
}
