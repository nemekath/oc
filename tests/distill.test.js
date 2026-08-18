import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distill, toMarkdown, toHTML, feedToHTML } from '../src/distill.js';
import { render, estimateTokens } from '../src/render.js';

const html = readFileSync(new URL('./pages/news.html', import.meta.url), 'utf8');
const page = () => distill(html, 'https://example.test/news');
const feed = readFileSync(new URL('./pages/feed.xml', import.meta.url), 'utf8');

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

test('interactive elements get numbered handles in document order', () => {
  const p = page();
  const links = p.blocks.filter((b) => b.type === 'link');
  assert.equal(links[0].n, 1);
  assert.equal(links[0].text, 'Show HN: I built a tiny CSV toolkit');
  const input = p.blocks.find((b) => b.type === 'input');
  assert.equal(input.name, 'q');
  const button = p.blocks.find((b) => b.type === 'button');
  assert.equal(button.text, 'Search');
});

test('same page yields the same output', () => {
  assert.equal(render(page()).text, render(page()).text);
});

test('render respects the token budget', () => {
  const { text, stats } = render(page(), { budget: 100 });
  assert.ok(stats.tokens <= 120, `render cost ~${stats.tokens} tokens against a budget of 100`);
  assert.ok(text.includes('over budget'), 'skipped blocks must be announced');
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

test('long runs of short links collapse into a range marker', () => {
  const nav = Array.from({ length: 15 }, (_, i) => `<a href="/s/${i}">sub${i}</a>`).join(' ');
  const navHtml = `<html><head><title>T</title></head><body>${nav}<p>actual content</p></body></html>`;
  const { text } = render(distill(navHtml, 'https://x.test'), { budget: 2000 });
  assert.ok(text.includes('[6-15] 10 similar links'), `run not collapsed:\n${text}`);
  assert.ok(text.includes('actual content'), 'content after the run was lost');
  assert.ok(!text.includes('sub9'), 'collapsed link still rendered');
});
