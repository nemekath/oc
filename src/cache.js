/**
 * Day cache for the big static files a local search ranks: a Sphinx site's
 * searchindex.js, the Node.js docs' all.json. Each is megabytes over the
 * wire but rebuilds at most a few times a day, and a stale result list still
 * links to live pages, so a day-old copy is a fair trade against moving the
 * file again on every search.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { fetchPage } from './fetch.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The file at `url`, parsed, from the disk cache while it is fresh and from
 * the network otherwise. One directory per backend, one file per host, kept
 * under the URL's own extension so the cache directory reads plainly. The
 * file is parsed before it is written, so a block page or an error never
 * poisons the cache, and a cache that cannot be written costs nothing but
 * the refetch, the same policy session state follows.
 * @param {string} kind - cache subdirectory, one per backend ('sphinx')
 * @param {string} url
 * @param {(text: string) => any} parse - throws on anything but the real file
 * @returns {Promise<{data: any, via: 'cache'|'network'}>}
 */
export async function cachedFile(kind, url, parse) {
  const dir = join(process.env.OC_HOME ?? join(homedir(), '.only-cli'), kind);
  const file = join(dir, `${new URL(url).host}${extname(new URL(url).pathname)}`);
  try {
    if (Date.now() - statSync(file).mtimeMs < CACHE_TTL_MS) {
      return { data: parse(readFileSync(file, 'utf8')), via: 'cache' };
    }
  } catch {}
  const { html } = await fetchPage(url);
  const data = parse(html);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, html);
  } catch {}
  return { data, via: 'network' };
}
