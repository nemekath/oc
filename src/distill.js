import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

/**
 * @typedef {Object} Block
 * @property {'heading'|'text'|'link'|'input'|'button'|'divider'} type
 * @property {string} text
 * @property {number} [n] - action handle
 * @property {number} [level] - heading level 1..6
 * @property {string} [href] - links only
 * @property {string} [name] - inputs only
 *
 * @typedef {Object} Page
 * @property {string} url
 * @property {string} title
 * @property {Block[]} blocks
 */

// Where the compact view cuts a text block. It lives here because numbering
// depends on it: a block long enough to be cut is a block that needs a handle.
export const TEXT_CAP = 200;

// Dropped wholesale, subtree included. Nav and footer stay in v0.1: on many
// sites they carry the only working links, and the budget in render.js is
// what keeps them from costing anything.
const DROP = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'iframe',
  'link', 'meta', 'head', 'canvas', 'video', 'audio', 'object',
]);

// Elements that are furniture by definition. The main content is never one of
// them, so the search below refuses to descend into them.
const FURNITURE = new Set(['nav', 'header', 'footer', 'aside']);

// Selectors a page uses to say where its content is. One match is a claim
// worth believing; several <article> elements mean a listing, where the list
// is the content and taking the first would throw the rest away.
const MAIN_SELECTORS = ['main', '[role="main"]', 'article'];

// Reordering only matters on a page that cannot be printed whole: if the
// budget covers everything, what leads is a question with no consequences.
// Below this much text the page is left in document order.
const MIN_PAGE = 3000;
// A candidate has to hold this share of the page's prose to be believed.
const MIN_SHARE = 0.25;
// How much of its parent's prose a child must hold before the search moves
// down into it, and how much of the page's it must keep to be worth choosing.
const DESCEND_SHARE = 0.6;
const KEEP_SHARE = 0.5;
const MAX_DEPTH = 12;

// A short link label repeated this many times down a page is per-item
// furniture (permalink, embed, save, reply, hide) rather than content. On a
// forum thread there is one set per comment, which costs more than the
// comments do.
const REPEAT_LIMIT = 5;
const REPEAT_MAX_LEN = 25;

const clean = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Reduce raw HTML to an interaction tree: readable text plus numbered
 * elements, in document order. The walk is deterministic and numbering is a
 * second pass over its result, so the same page always yields the same
 * numbers.
 * @param {string} html
 * @param {string} url
 * @returns {Page}
 */
export function distill(html, url = '') {
  const { document } = parseHTML(feedToHTML(html) ?? html);
  const title = clean(document.querySelector('title')?.textContent ?? '');
  /** @type {Block[]} */
  const blocks = [];

  const hidden = (el) =>
    el.getAttribute('hidden') !== null ||
    el.getAttribute('aria-hidden') === 'true' ||
    /display:\s*none/.test(el.getAttribute('style') ?? '');

  /** Subtree already emitted, skipped when the rest of the page is walked. */
  let done = null;

  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = clean(node.textContent);
      if (text) blocks.push({ type: 'text', text });
      return;
    }
    if (node.nodeType !== 1) return;
    if (node === done) return;
    const tag = node.localName;
    if (DROP.has(tag) || hidden(node)) return;

    if (/^h[1-6]$/.test(tag)) {
      const text = clean(node.textContent);
      if (text) blocks.push({ type: 'heading', level: Number(tag[1]), text });
      return;
    }
    if (tag === 'a' && node.getAttribute('href')) {
      const text = clean(node.textContent);
      if (text) {
        blocks.push({ type: 'link', text, href: node.getAttribute('href') });
      }
      return;
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const kind = node.getAttribute('type') ?? 'text';
      if (kind === 'hidden') return;
      if (kind === 'submit' || kind === 'button') {
        blocks.push({ type: 'button', text: node.getAttribute('value') ?? 'submit' });
        return;
      }
      const name = node.getAttribute('name') ?? node.getAttribute('placeholder') ?? tag;
      blocks.push({ type: 'input', text: kind, name });
      return;
    }
    if (tag === 'button') {
      const text = clean(node.textContent) || 'button';
      blocks.push({ type: 'button', text });
      return;
    }
    for (const child of node.childNodes) walk(child);
  };

  const body = bodyOf(document);
  const main = body ? mainOf(document, body) : null;
  if (main) {
    // Content first, everything else after it. The budget in render.js is
    // spent top down, so whatever leads the list is what an agent gets for
    // its first 500 tokens, and on most pages the top of the document is
    // menus. Nothing is dropped: the chrome carries links `oc do` needs, it
    // just stops being the thing that gets read.
    walk(main);
    done = main;
    const contentBlocks = blocks.length;
    if (body) walk(body);
    if (blocks.length > contentBlocks) {
      blocks.splice(contentBlocks, 0, { type: 'divider', text: '--- rest of page: navigation, sidebar, footer ---' });
    }
  } else if (body) {
    walk(body);
  }
  return { url, title, blocks: number(mergeText(dropRepeats(blocks))) };
}

/**
 * Remove link labels that repeat down the page. They are the per-item controls
 * a template stamps onto every row, and on a long thread they outweigh the
 * content. What went is stated in place, because a view that quietly drops
 * things is a view an agent cannot trust.
 * @param {Block[]} blocks
 * @returns {Block[]}
 */
function dropRepeats(blocks) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const b of blocks) {
    if (b.type !== 'link' || b.text.length > REPEAT_MAX_LEN) continue;
    const key = b.text.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = new Set([...counts].filter(([, n]) => n >= REPEAT_LIMIT).map(([k]) => k));
  if (!repeated.size) return blocks;
  const kept = blocks.filter((b) => !(b.type === 'link' && repeated.has(b.text.toLowerCase())));
  const gone = blocks.length - kept.length;
  const names = [...repeated].slice(0, 3).join(', ');
  const note = { type: 'divider', text: `--- ${gone} repeated links hidden (${names}), 'oc raw' has them ---` };
  // The note belongs with the content it was cut from, not after the chrome.
  const boundary = kept.findIndex((b) => b.type === 'divider');
  kept.splice(boundary === -1 ? kept.length : boundary, 0, note);
  return kept;
}

/**
 * Find the element holding the page's main content, or null when the page is
 * too small or too flat for the question to have an answer.
 * @param {any} document
 * @param {any} body
 * @returns {any}
 */
function mainOf(document, body) {
  if (clean(body.textContent ?? '').length < MIN_PAGE) return null;
  const total = prose(body);
  for (const selector of MAIN_SELECTORS) {
    const found = [...document.querySelectorAll(selector)];
    if (found.length !== 1) continue;
    const el = found[0];
    if (el !== body && prose(el) >= total * MIN_SHARE) return el;
  }
  return densest(body, total);
}

/**
 * Walk down the tree while one child holds most of the prose of the element
 * above it. That is what separates a content column from the page around it
 * without knowing anything about the site.
 * @param {any} body
 * @param {number} total
 * @returns {any}
 */
function densest(body, total) {
  let node = body;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    let best = null;
    let bestProse = 0;
    for (const child of node.children ?? []) {
      if (FURNITURE.has(child.localName) || DROP.has(child.localName)) continue;
      const len = prose(child);
      if (len > bestProse) {
        best = child;
        bestProse = len;
      }
    }
    if (!best || bestProse < prose(node) * DESCEND_SHARE || bestProse < total * KEEP_SHARE) break;
    node = best;
  }
  return node === body ? null : node;
}

/**
 * Text length minus link text. Link text is what navigation is made of, so
 * subtracting it is what keeps a menu from outscoring an article.
 * @param {any} el
 * @returns {number}
 */
function prose(el) {
  const text = clean(el.textContent ?? '').length;
  let links = 0;
  for (const a of el.querySelectorAll?.('a') ?? []) links += clean(a.textContent ?? '').length;
  return text - links;
}

/**
 * Assign handles in document order. Interactive elements get one because they
 * can be acted on, headings and long text blocks because they can be read:
 * a text block over the cap is printed cut, and its number is what makes the
 * rest of it reachable with `oc read <n>` instead of a second whole-page fetch.
 * @param {Block[]} blocks
 * @returns {Block[]}
 */
function number(blocks) {
  let handle = 0;
  for (const block of blocks) {
    if (block.type === 'divider') continue;
    if (block.type !== 'text' || block.text.length > TEXT_CAP) block.n = ++handle;
  }
  return blocks;
}

/**
 * linkedom's document.body getter comes back empty on some real pages (Bing)
 * while querySelector finds the populated element, so always resolve the body
 * this way.
 * @returns {any}
 */
const bodyOf = (document) => document.querySelector('body') ?? document.documentElement;

/**
 * Shared cleanup for the raw modes: parse, then delete the same noise
 * distill() skips, so neither raw output ever leaks scripts, styles, or
 * hidden content.
 * @param {string} html
 */
function cleanDocument(html) {
  const { document } = parseHTML(feedToHTML(html) ?? html);
  // Read the title before the sweep below removes the head with it.
  const title = clean(document.querySelector('title')?.textContent ?? '');
  for (const tag of DROP) {
    for (const el of [...document.querySelectorAll(tag)]) el.remove();
  }
  for (const el of [...document.querySelectorAll('[hidden], [aria-hidden="true"], input[type="hidden"]')]) el.remove();
  for (const el of [...document.querySelectorAll('[style]')]) {
    if (/display:\s*none/.test(el.getAttribute('style') ?? '')) el.remove();
  }
  return { document, title };
}

/**
 * Whole-page markdown for `oc raw`, produced by turndown so lists, emphasis,
 * links, and code blocks come out as real markdown instead of flat lines.
 * @param {string} html
 * @returns {string}
 */
export function toMarkdown(html) {
  const { document, title } = cleanDocument(html);
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const el = bodyOf(document);
  const body = el ? turndown.turndown(el.innerHTML).trim() : '';
  return title && !body.startsWith(`# ${title}`) ? `# ${title}\n\n${body}` : body;
}

/**
 * Whole-page cleaned HTML for `oc raw --html`, for agents that would rather
 * work with markup than markdown. Same noise removal, no other rewriting.
 * @param {string} html
 * @returns {string}
 */
export function toHTML(html) {
  const { document } = cleanDocument(html);
  const el = bodyOf(document);
  return el ? el.innerHTML.trim() : '';
}

/**
 * Sites behind hard bot challenges often leave their Atom or RSS feeds open:
 * Stack Overflow challenges every HTML page but publishes full question and
 * answer bodies under /feeds. A feed is XML with the real content escaped
 * inside each entry, so this converts one into a plain HTML document and
 * everything downstream stays unchanged. Returns null for non-feed input.
 * @param {string} text
 * @returns {string | null}
 */
export function feedToHTML(text) {
  const head = text.slice(0, 2000);
  if (!/<(feed|rss)[\s>]/i.test(head) || /<(html|body)[\s>]/i.test(head)) return null;
  // RSS wraps bodies in CDATA, which an HTML parser reads as a comment and
  // drops. Escaping the section turns it into ordinary text, the same shape
  // Atom feeds already use.
  const xml = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) =>
    inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const { document } = parseHTML(xml);
  const root = document.querySelector('feed, rss');
  if (!root) return null;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Feed elements are unknown to the HTML parser, so self-closed ones like
  // <category /> stay open and swallow their siblings. Descendant queries
  // still land, because a closing </entry> or </item> pops the whole pile.
  const field = (el, sel) => clean(el.querySelector(sel)?.textContent ?? '');
  const feedTitle = field(root, 'title');
  const parts = [];
  for (const entry of root.querySelectorAll('entry, item')) {
    const title = field(entry, 'title');
    const href = entry.querySelector('link[rel="alternate"]')?.getAttribute('href')
      ?? entry.querySelector('link[href]')?.getAttribute('href')
      ?? field(entry, 'guid');
    const author = field(entry, 'author name') || field(entry, 'author');
    const date = (field(entry, 'updated') || field(entry, 'published') || field(entry, 'pubdate')).slice(0, 10);
    const byline = [author && `by ${author}`, date].filter(Boolean).join(', ');
    // Atom escapes the entry body, so textContent of content/summary is the
    // HTML itself, ready to be embedded and parsed like any page.
    const body = (entry.querySelector('content') ?? entry.querySelector('summary') ?? entry.querySelector('description'))?.textContent ?? '';
    parts.push('<article>');
    if (title) parts.push(`<h2>${esc(title)}</h2>`);
    if (byline || href) {
      parts.push(`<p>${esc(byline)}${href ? ` <a href="${esc(href)}">open</a>` : ''}</p>`);
    }
    parts.push(body, '</article>');
  }
  // A full skeleton, because linkedom treats the first element of a bare
  // multi-rooted fragment as the whole document and drops its siblings.
  return `<html><head><title>${esc(feedTitle)}</title></head><body>\n${parts.join('\n')}\n</body></html>`;
}

/**
 * Adjacent text nodes arrive fragmented (one per inline element boundary).
 * Merging them is what turns DOM noise into readable lines.
 * @param {Block[]} blocks
 * @returns {Block[]}
 */
function mergeText(blocks) {
  /** @type {Block[]} */
  const out = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (b.type === 'text' && prev?.type === 'text') {
      prev.text = `${prev.text} ${b.text}`;
    } else {
      out.push(b);
    }
  }
  // Single stray characters (list bullets, separators) cost tokens and say nothing.
  return out.filter((b) => b.type !== 'text' || b.text.length > 1);
}
