/**
 * RDoc search backend. The Ruby docs (docs.ruby-lang.org) are built with
 * RDoc, which like Sphinx has no search server: the generated site ships its
 * whole search index as one static file, js/search_index.js, and matches in
 * the visitor's browser. So `search` ranks that file locally: every class,
 * module, method, and guide page in the index becomes a result linking to
 * its own anchor. The file is ~3.4MB (~560KB over the wire) and static, so
 * it lives in the same day cache the other local backends use, and what
 * reaches the agent is the ranked result list only.
 */

import { cachedFile } from './cache.js';
import { escapeHTML } from './sphinx.js';
import { searchEntries } from './nodedocs.js';

const MAX_RESULTS = 20;

/**
 * The index file is `var search_data = {...}`: JSON behind one assignment
 * for the browser's benefit. Anything that does not parse that way, or that
 * lacks the info rows, is not an RDoc index, which on a wrong or moved URL
 * is the honest error, and it keeps a block page out of the cache too.
 * @param {string} js
 * @returns {any}
 */
export function parseRdocIndex(js) {
  const start = js.indexOf('=');
  if (start >= 0) {
    try {
      const data = JSON.parse(js.slice(start + 1));
      if (Array.isArray(data?.index?.info)) return data;
    } catch {}
  }
  throw new Error('not an RDoc search index');
}

/**
 * Flatten the index's info rows into the entries the shared ranker scores.
 * A row is [name, namespace, path, params, snippet]; the path's own anchor
 * says what the row is, so 'dig' in 'Array' with anchor method-i-dig reads
 * back as the heading a rubyist expects, Array#dig(*args). Snippets stay
 * behind: matching on them would rank prose over the symbol asked for.
 * @param {any} data - parsed search_index.js
 * @returns {{text: string, name: string, kind: string, path: string}[]}
 */
export function buildRdocEntries(data) {
  return data.index.info.map(([name, namespace, path, params]) => {
    const p = String(path ?? '');
    const kind = p.includes('#method-c-') ? 'class method'
      : p.includes('#method-i-') ? 'method'
        : /^[A-Z]/.test(String(name)) ? 'class' : 'page';
    const text = kind === 'class method' ? `${namespace}.${name}${params}`
      : kind === 'method' ? `${namespace}#${name}${params}`
        : namespace ? `${namespace}::${name}` : String(name ?? '');
    return { text, name: String(name ?? ''), kind, path: p };
  }).filter((e) => e.text && e.path);
}

/**
 * The result list becomes the same small synthetic page the other search
 * backends emit, so it distills, renders, numbers, and remembers like any
 * fetched page and `do <n>` follows a result.
 * @param {string} base
 * @param {string} query
 * @param {ReturnType<typeof searchEntries>} found
 * @returns {string}
 */
export function resultsToHTML(base, query, found) {
  const host = new URL(base).host;
  const items = found.hits.map((e) =>
    `<li><a href="${escapeHTML(new URL(e.path, base).href)}">${escapeHTML(e.text)}</a>`
    + ` ${escapeHTML(e.kind)}</li>`);
  const partial = found.partial ? '; no entry matches every word, so these match some' : '';
  const summary = items.length
    ? `${found.total} entr${found.total === 1 ? 'y matches' : 'ies match'} in the docs' own index,`
      + ` ranked locally${found.total > MAX_RESULTS ? `, top ${MAX_RESULTS} shown` : ''}${partial}:`
    : `nothing in the docs' own index matches; try fewer or different words`;
  return `<html><head><title>${escapeHTML(host)} search: ${escapeHTML(query)}</title></head><body><main>`
    + `<p>${summary}</p>`
    + (items.length ? `<ol>${items.join('')}</ol>` : '')
    + `</main></body></html>`;
}

/**
 * Search one RDoc site. The site has no search URL of its own to remember,
 * so the session keeps the docs root, the page a reader would start from.
 * @param {string} base - docs root ending in '/', e.g. https://docs.ruby-lang.org/en/3.4/
 * @param {string} query
 */
export async function rdocSearch(base, query) {
  if (!query.trim()) throw new Error('usage: search <query>');
  const { data, via } = await cachedFile('rdoc', new URL('js/search_index.js', base).href, parseRdocIndex);
  return {
    url: new URL('index.html', base).href,
    html: resultsToHTML(base, query, searchEntries(buildRdocEntries(data), query)),
    via,
  };
}
