import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distill, toMarkdown, toHTML } from '../src/distill.js';
import { render, estimateTokens } from '../src/render.js';

const html = readFileSync(new URL('./pages/news.html', import.meta.url), 'utf8');
const page = () => distill(html, 'https://example.test/news');

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

test('long runs of short links collapse into a range marker', () => {
  const nav = Array.from({ length: 15 }, (_, i) => `<a href="/s/${i}">sub${i}</a>`).join(' ');
  const navHtml = `<html><head><title>T</title></head><body>${nav}<p>actual content</p></body></html>`;
  const { text } = render(distill(navHtml, 'https://x.test'), { budget: 2000 });
  assert.ok(text.includes('[6-15] 10 similar links'), `run not collapsed:\n${text}`);
  assert.ok(text.includes('actual content'), 'content after the run was lost');
  assert.ok(!text.includes('sub9'), 'collapsed link still rendered');
});
