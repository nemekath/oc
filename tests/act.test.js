import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every session helper reads OC_HOME when it runs, so pointing it at a temp
// directory here keeps the suite offline and out of the real home directory.
process.env.OC_HOME = mkdtempSync(join(tmpdir(), 'oc-test-'));

const { distill } = await import('../src/distill.js');
const { activate, read, next } = await import('../src/act.js');
const { sessionFromPage, saveSession, loadSession, resolveHref } = await import('../src/session.js');
const { render } = await import('../src/render.js');

const html = readFileSync(new URL('./pages/news.html', import.meta.url), 'utf8');
const page = () => distill(html, 'https://example.test/news');
const open = (name = 'default', budget = 500) => {
  const p = page();
  saveSession(name, sessionFromPage(p, loadSession(name), { cursor: render(p, { budget }).stats.next }));
};

test('a rendered page is remembered with absolute URLs for every handle', () => {
  open();
  const state = loadSession('default');
  assert.equal(state.url, 'https://example.test/news');
  assert.equal(state.blocks.find((b) => b.n === 2).href, 'https://example.test/item?id=1');
  assert.equal(state.blocks.length, page().blocks.length, 'the whole page must survive for read and next');
});

test('do follows the link behind a number without the agent seeing a URL', () => {
  open();
  assert.deepEqual(activate(2), { url: 'https://example.test/item?id=1', text: 'Show HN: I built a tiny CSV toolkit' });
});

test('do still works on a session saved by an older version', () => {
  saveSession('legacy', { url: 'https://example.test/old', handles: { 1: { type: 'link', text: 'a', href: 'https://example.test/a' } } });
  assert.equal(activate(1, { session: 'legacy' }).url, 'https://example.test/a');
  assert.throws(() => next({ session: 'legacy' }), /older oc, run 'oc open https:\/\/example.test\/old'/);
});

test('read prints the region at a number in full, uncut', () => {
  open();
  const out = read(9);
  assert.ok(out.includes('safely does'), 'read must not stop at the compact cap');
  assert.ok(!out.includes('+144 chars'), 'read must not print a cut marker for text it printed whole');
  assert.ok(out.includes('## [8] About'), 'the heading above the block gives it context');
  assert.ok(!out.includes('Postgres 18 released'), 'the section before it is not part of the region');
});

test('read of a heading takes the section under it', () => {
  open();
  const out = read(8);
  assert.ok(out.startsWith('## [8] About'));
  assert.ok(out.includes('safely does'));
});

test('a region too big for the budget says where to pick it up', () => {
  open();
  const out = read(8, { budget: 20 });
  assert.match(out, /region cut at ~20 tokens, continue with 'oc read \d+'/);
});

test('read and next explain themselves when the number or the page is missing', () => {
  open();
  assert.throws(() => read(9999), /no \[9999\].*oc open/s);
  assert.throws(() => read(0), /usage: oc read <n>/);
  assert.throws(() => read(1, { session: 'never-opened' }), /oc open <url>' first/);
});

test('next continues where the budget stopped, then says the page is done', () => {
  open('paged', 100);
  const first = next({ session: 'paged', budget: 100 });
  assert.ok(first.startsWith('# Fixture News (continued)'));
  assert.ok(!first.includes('Show HN'), 'next must not reprint what open already charged for');
  let out = first;
  for (let i = 0; i < 10 && loadSession('paged').cursor != null; i++) {
    out = next({ session: 'paged', budget: 100 });
  }
  assert.equal(loadSession('paged').cursor, null, 'paging must reach the end of the page');
  assert.ok(out.includes('newest'), 'the last block of the page must come out eventually');
  assert.match(next({ session: 'paged' }), /end of https:\/\/example.test\/news/);
});

test('search result redirectors resolve to the page they wrap', () => {
  const wrapped = 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fdoc.rust-lang.org%2Fbook%2F&rut=abc';
  assert.equal(resolveHref(wrapped, 'https://html.duckduckgo.com/html/'), 'https://doc.rust-lang.org/book/');
  assert.equal(resolveHref('https://www.google.com/url?q=https://example.test/a', ''), 'https://example.test/a');
  // A normal link that merely has a url-shaped query parameter is left alone.
  assert.equal(
    resolveHref('/search?url=https://example.test/a', 'https://example.test/'),
    'https://example.test/search?url=https://example.test/a',
  );
});

test('links a browser cannot follow are not offered as handles', () => {
  assert.equal(resolveHref('javascript:void(0)', 'https://example.test/'), null);
  assert.equal(resolveHref('', 'https://example.test/'), null);
});

test('every failure names the command that fixes it', () => {
  open();
  assert.throws(() => activate(9999), /handles 1-\d+.*oc open/s);
  assert.throws(() => activate(0), /usage: oc do <n>/);
  assert.throws(() => activate(1, { session: 'never-opened' }), /oc open <url>' first/);

  const input = page().blocks.find((b) => b.type === 'input');
  assert.throws(() => activate(input.n), /is an input.*oc fill/s);
  const button = page().blocks.find((b) => b.type === 'button');
  assert.throws(() => activate(button.n), /no link to follow/);
  // The numbers that are not links point at the command that does use them.
  assert.throws(() => activate(1), /is heading.*oc read 1/s);
  assert.throws(() => activate(9), /is text.*oc read 9/s);
});

test('named sessions keep separate page state', () => {
  open('work');
  saveSession('other', { url: 'https://example.test/other', blocks: [], cursor: null });
  assert.equal(activate(2, { session: 'work' }).url, 'https://example.test/item?id=1');
  assert.throws(() => activate(2, { session: 'other' }), /no \[2\]/);
});

test('history grows with each page and stays bounded', () => {
  let state = null;
  for (let i = 0; i < 25; i++) state = sessionFromPage(distill(html, `https://example.test/p${i}`), state);
  assert.equal(state.history.length, 20);
  assert.equal(state.history.at(-1), 'https://example.test/p24');
});
