import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distill, toMarkdown, toHTML, feedToHTML, TEXT_CAP } from '../src/distill.js';
import { render, estimateTokens } from '../src/render.js';

const html = readFileSync(new URL('./pages/news.html', import.meta.url), 'utf8');
const page = () => distill(html, 'https://example.test/news');
const feed = readFileSync(new URL('./pages/feed.xml', import.meta.url), 'utf8');
const forum = readFileSync(new URL('./pages/forum.html', import.meta.url), 'utf8');
const thread = () => distill(forum, 'https://example.test/t/1');
const timeline = readFileSync(new URL('./pages/social.html', import.meta.url), 'utf8');
const social = () => distill(timeline, 'https://social.test/fixture');

test('noise never reaches the output, compact or raw', () => {
  for (const out of [render(page(), { budget: 5000 }).text, toMarkdown(html), toHTML(html)]) {
    assert.ok(!out.includes('tracker'), 'script content leaked');
    assert.ok(!out.includes('font-family'), 'style content leaked');
    assert.ok(!out.includes('cookies'), 'display:none content leaked');
    assert.ok(!out.includes('hidden drawer'), 'hidden attribute content leaked');
    assert.ok(!out.includes('csrf'), 'hidden input leaked');
  }
});

test('raw mode emits real markdown with hrefs an agent can follow', () => {
  const md = toMarkdown(html);
  assert.ok(md.startsWith('# Fixture News'));
  assert.ok(md.includes('[Show HN: I built a tiny CSV toolkit](/item?id=1)'), 'link markdown missing');
});

test('raw html mode keeps markup', () => {
  const out = toHTML(html);
  assert.ok(out.includes('<a href="/item?id=1">'), 'anchor tag missing');
  assert.ok(!out.includes('<script'), 'script tag survived');
});

test('elements get numbered handles in document order', () => {
  const p = page();
  const links = p.blocks.filter((b) => b.type === 'link');
  assert.equal(links[0].text, 'Show HN: I built a tiny CSV toolkit');
  assert.equal(links[0].n, 2, 'the page heading takes [1]');
  const input = p.blocks.find((b) => b.type === 'input');
  assert.equal(input.name, 'q');
  const button = p.blocks.find((b) => b.type === 'button');
  assert.equal(button.text, 'Search');
  // Numbers rise once, in document order, and never repeat.
  const nums = p.blocks.filter((b) => b.n != null).map((b) => b.n);
  assert.deepEqual(nums, nums.map((_, i) => i + 1));
});

test('a text block long enough to be cut is numbered, a short one is not', () => {
  const p = page();
  const long = p.blocks.find((b) => b.type === 'text' && b.text.length > TEXT_CAP);
  assert.ok(long.n, 'a cut block with no number cannot be read back');
  const short = p.blocks.find((b) => b.type === 'text' && b.text === '312 points');
  assert.equal(short.n, undefined);
});

test('same page yields the same output', () => {
  assert.equal(render(page()).text, render(page()).text);
});

test('a page well past the budget is cut, and what was cut is priced', () => {
  const { text, stats } = render(page(), { budget: 25 });
  assert.ok(stats.tokens <= 60, `render cost ~${stats.tokens} tokens against a budget of 25`);
  assert.match(text, /\.\.\. \d+ more blocks \(~\d+ tokens\)/, 'what was cut must be priced');
  assert.ok(text.includes("'oc next'"), 'the cheapest way to the rest must be named');
  assert.ok(text.includes('| next |'), 'next belongs in the actions of a cut page');
});

test('a page that ends just past the budget is finished instead of cut', () => {
  // The fixture costs about 134 tokens whole. Cutting it at 40 would save 90
  // tokens and charge a whole extra turn to get them back, which is a bad trade.
  const { text, stats } = render(page(), { budget: 40 });
  assert.equal(stats.next, null, 'a page within reach of the budget must come out whole');
  assert.ok(!text.includes('more blocks'), 'nothing was cut, so nothing should be priced');
  assert.ok(text.includes('newest'), 'the last block of the page must be there');
  // The allowance is not unlimited: a page far past the budget still gets cut.
  assert.equal(typeof render(thread(), { budget: 100 }).stats.next, 'number');
});

test('what a render stops at is where the next one starts', () => {
  const p = page();
  const first = render(p, { budget: 25 });
  assert.equal(typeof first.stats.next, 'number');
  const rest = render(p, { budget: 500, from: first.stats.next });
  assert.ok(rest.text.startsWith('# Fixture News (continued)'));
  assert.equal(rest.stats.next, null, 'the second render finishes the page');
  // Nothing is printed twice and nothing is lost between the two.
  assert.ok(!rest.text.includes('Show HN'));
  assert.ok(first.text.includes('Show HN'));
  assert.ok(rest.text.includes('Postgres 18 released'));
  assert.ok(rest.text.includes('input q'));
});

test('a page render never stalls on a block bigger than the budget', () => {
  const { text, stats } = render(page(), { budget: 1 });
  assert.ok(stats.next > 0, 'one block must always go out or next can never advance');
  assert.ok(text.includes('Show HN'), 'the block that did not fit is printed anyway');
  assert.ok(text.includes('more blocks'));
});

test('default render of a normal page fits the 500 token target', () => {
  const { stats } = render(page());
  assert.ok(stats.tokens <= 500, `render cost ~${stats.tokens} tokens`);
});

test('long text is truncated with a marker', () => {
  const { text } = render(page(), { budget: 2000 });
  assert.ok(text.includes(' ...'), 'expected a truncation marker');
  assert.ok(!text.includes('safely does'), 'text cap was not applied');
});

test('title becomes the page heading', () => {
  assert.ok(render(page()).text.startsWith('# Fixture News'));
});

test('token estimate is stable and roughly chars over four', () => {
  assert.equal(estimateTokens('abcdefgh'), 2);
});

test('atom feeds render as pages: entries become headings, bodies unescape', () => {
  const p = distill(feed, 'https://example.test/feeds/question/42');
  assert.equal(p.title, 'Why is the sky blue? - Fixture Overflow');
  const headings = p.blocks.filter((b) => b.type === 'heading');
  assert.equal(headings[0].text, 'Why is the sky blue?');
  assert.equal(headings[1].text, 'Answer by Tyndall for Why is the sky blue?');
  const open = p.blocks.find((b) => b.type === 'link' && b.text === 'open');
  assert.equal(open.href, 'https://example.test/questions/42/why-is-the-sky-blue');
  const text = p.blocks.map((b) => b.text).join(' ');
  assert.ok(text.includes('Rayleigh scattering'), 'entry body missing');
  assert.ok(text.includes('by Ray Leigh, 2026-04-08'), 'byline missing');
  assert.ok(!text.includes('&lt;'), 'entry body left escaped');
});

test('feed entry code blocks survive raw markdown', () => {
  const md = toMarkdown(feed);
  assert.ok(md.startsWith('# Why is the sky blue? - Fixture Overflow'));
  assert.ok(md.includes('wavelength < 450nm'), 'code content missing');
  assert.ok(md.includes('[the derivation](https://example.test/scattering)'), 'link inside entry body missing');
});

test('rss with cdata bodies converts too, ordinary html does not', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture Blog</title>
    <item><title>Post one</title><guid>https://example.test/p/1</guid>
    <pubDate>Mon, 17 Aug 2026 00:00:00 GMT</pubDate>
    <description><![CDATA[<p>A <em>cdata</em> body with markup.</p>]]></description></item>
    </channel></rss>`;
  const p = distill(rss, 'https://example.test/rss');
  assert.equal(p.title, 'Fixture Blog');
  const text = p.blocks.map((b) => b.text).join(' ');
  assert.ok(text.includes('A cdata body with markup.'), 'cdata body missing');
  assert.equal(feedToHTML(html), null, 'ordinary html misread as a feed');
});

test('the content leads the page and the chrome follows it', () => {
  const { text } = render(thread(), { budget: 500 });
  const lines = text.split('\n');
  // The budget is spent top down, so what matters is that comments are inside
  // the first view at all: on this page they used to start below it.
  assert.ok(text.includes('Lynx is the one I keep coming back to'), `content missed the first view:\n${text}`);
  assert.ok(!text.includes('section 7'), 'nav still printed ahead of the content');
  const blocks = thread().blocks;
  const divider = blocks.findIndex((b) => b.type === 'divider' && b.text.includes('rest of page'));
  const nav = blocks.findIndex((b) => b.text === 'section 7');
  assert.ok(divider > 0 && nav > divider, 'the nav was not moved below the content');
  assert.ok(lines[1].startsWith('# '), 'the first line under the title is not the content heading');
});

test('nothing is dropped when the content is moved up, only reordered', () => {
  const blocks = thread().blocks;
  const text = blocks.map((b) => b.text).join(' ');
  assert.ok(text.includes('section 13'), 'a nav link went missing');
  assert.ok(text.includes('terms'), 'a footer link went missing');
  assert.ok(text.includes('This sidebar exists on every page'), 'sidebar text went missing');
});

test('per item controls that repeat down a page are dropped, and say so', () => {
  const blocks = thread().blocks;
  assert.ok(!blocks.some((b) => b.type === 'link' && b.text === 'permalink'), 'per comment chrome survived');
  assert.ok(blocks.some((b) => b.type === 'link' && b.text === 'commenter3'), 'a unique link was dropped with them');
  const note = blocks.find((b) => b.type === 'divider' && b.text.includes('repeated controls hidden'));
  assert.ok(note, 'links vanished with nothing said about it');
  assert.ok(note.text.includes("'oc raw' has them"), 'the note does not say how to get them back');
  assert.ok(toMarkdown(forum).includes('permalink'), 'raw lost them too, so the note lies');
});

test('a page that fits the budget is left in document order', () => {
  const blocks = page().blocks;
  assert.ok(!blocks.some((b) => b.type === 'divider'), 'a small page was reordered for no reason');
  assert.equal(blocks[0].text, 'Fixture News');
});

test('an entity does not put spaces inside a word', () => {
  // linkedom splits a text node at every entity, so `isn&#x27;t` arrives as
  // three nodes and used to come back out as `isn ' t`.
  const text = social().blocks.map((b) => b.text).join('\n');
  assert.ok(text.includes("isn't drawing"), `apostrophe split:\n${text.slice(0, 400)}`);
  assert.ok(text.includes('interface & its restraint'), 'a real space was swallowed');
});

test('an icon button is named by its aria-label, a nameless one is dropped', () => {
  const blocks = social().blocks;
  assert.ok(blocks.some((b) => b.type === 'button' && b.text === 'Follow'), 'a labelled button went missing');
  assert.ok(!blocks.some((b) => b.type === 'button' && b.text === 'button'), 'a button with no name was printed anyway');
  const html = '<html><head><title>T</title></head><body><button aria-label="Reply"></button></body></html>';
  const one = distill(html, 'https://x.test').blocks.find((b) => b.type === 'button');
  assert.equal(one.text, 'Reply');
});

test('per item buttons repeat sooner than links before they count as furniture', () => {
  const blocks = social().blocks;
  // Six posts, six sets of Reply/Repost/Like/Bookmark/Share/More.
  assert.ok(!blocks.some((b) => b.type === 'button' && b.text === 'Reply'), 'per post controls survived');
  const note = blocks.find((b) => b.type === 'divider' && b.text.includes('repeated controls hidden'));
  assert.ok(note, 'controls vanished with nothing said about it');
});

test('separate posts stay separate blocks', () => {
  // With the per post controls gone there is nothing left between one post and
  // the next, so without a block boundary six posts merge into one long line
  // and `read <n>` can no longer address any single one of them.
  const texts = social().blocks.filter((b) => b.type === 'text').map((b) => b.text);
  const ncurses = texts.find((t) => t.includes('ncurses'));
  assert.ok(ncurses, 'the first post went missing');
  assert.ok(!ncurses.includes('1987 manual'), `two posts merged into one block:\n${ncurses}`);
});

test('long runs of short links collapse into a range marker', () => {
  const nav = Array.from({ length: 15 }, (_, i) => `<a href="/s/${i}">sub${i}</a>`).join(' ');
  const navHtml = `<html><head><title>T</title></head><body>${nav}<p>actual content</p></body></html>`;
  const { text } = render(distill(navHtml, 'https://x.test'), { budget: 2000 });
  assert.ok(text.includes('[6-15] 10 similar links'), `run not collapsed:\n${text}`);
  assert.ok(text.includes('actual content'), 'content after the run was lost');
  assert.ok(!text.includes('sub9'), 'collapsed link still rendered');
});
