import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

/**
 * @typedef {Object} Block
 * @property {'heading'|'text'|'link'|'input'|'button'} type
 * @property {string} text
 * @property {number} [n] - action handle, only on interactive blocks
 * @property {number} [level] - heading level 1..6
 * @property {string} [href] - links only
 * @property {string} [name] - inputs only
 *
 * @typedef {Object} Page
 * @property {string} url
 * @property {string} title
 * @property {Block[]} blocks
 */

// Dropped wholesale, subtree included. Nav and footer stay in v0.1: on many
// sites they carry the only working links, and the budget in render.js is
// what keeps them from costing anything.
const DROP = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'iframe',
  'link', 'meta', 'head', 'canvas', 'video', 'audio', 'object',
]);

const clean = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Reduce raw HTML to an interaction tree: readable text plus numbered
 * interactive elements, in document order. Handles are assigned during a
 * single deterministic walk, so the same page always yields the same numbers.
 * @param {string} html
 * @param {string} url
 * @returns {Page}
 */
export function distill(html, url = '') {
  const { document } = parseHTML(html);
  const title = clean(document.querySelector('title')?.textContent ?? '');
  /** @type {Block[]} */
  const blocks = [];
  let handle = 0;

  const hidden = (el) =>
    el.getAttribute('hidden') !== null ||
    el.getAttribute('aria-hidden') === 'true' ||
    /display:\s*none/.test(el.getAttribute('style') ?? '');

  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = clean(node.textContent);
      if (text) blocks.push({ type: 'text', text });
      return;
    }
    if (node.nodeType !== 1) return;
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
        blocks.push({ type: 'link', n: ++handle, text, href: node.getAttribute('href') });
      }
      return;
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const kind = node.getAttribute('type') ?? 'text';
      if (kind === 'hidden') return;
      if (kind === 'submit' || kind === 'button') {
        blocks.push({ type: 'button', n: ++handle, text: node.getAttribute('value') ?? 'submit' });
        return;
      }
      const name = node.getAttribute('name') ?? node.getAttribute('placeholder') ?? tag;
      blocks.push({ type: 'input', n: ++handle, text: kind, name });
      return;
    }
    if (tag === 'button') {
      const text = clean(node.textContent) || 'button';
      blocks.push({ type: 'button', n: ++handle, text });
      return;
    }
    for (const child of node.childNodes) walk(child);
  };

  const body = bodyOf(document);
  if (body) walk(body);
  return { url, title, blocks: mergeText(blocks) };
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
  const { document } = parseHTML(html);
  for (const tag of DROP) {
    for (const el of [...document.querySelectorAll(tag)]) el.remove();
  }
  for (const el of [...document.querySelectorAll('[hidden], [aria-hidden="true"], input[type="hidden"]')]) el.remove();
  for (const el of [...document.querySelectorAll('[style]')]) {
    if (/display:\s*none/.test(el.getAttribute('style') ?? '')) el.remove();
  }
  return document;
}

/**
 * Whole-page markdown for `oc raw`, produced by turndown so lists, emphasis,
 * links, and code blocks come out as real markdown instead of flat lines.
 * @param {string} html
 * @returns {string}
 */
export function toMarkdown(html) {
  const document = cleanDocument(html);
  const title = clean(document.querySelector('title')?.textContent ?? '');
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
  const document = cleanDocument(html);
  const el = bodyOf(document);
  return el ? el.innerHTML.trim() : '';
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
