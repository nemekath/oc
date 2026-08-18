import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every session helper reads OC_HOME when it runs, so pointing it at a temp
// directory here keeps the suite offline and out of the real home directory.
process.env.OC_HOME = mkdtempSync(join(tmpdir(), 'oc-test-'));

const { distill } = await import('../src/distill.js');
const { activate } = await import('../src/act.js');
const { sessionFromPage, saveSession, loadSession, resolveHref } = await import('../src/session.js');

const html = readFileSync(new URL('./pages/news.html', import.meta.url), 'utf8');
const page = () => distill(html, 'https://example.test/news');
const open = (name = 'default') => saveSession(name, sessionFromPage(page(), loadSession(name)));

test('a rendered page is remembered with absolute URLs for every handle', () => {
  open();
  const state = loadSession('default');
  assert.equal(state.url, 'https://example.test/news');
  assert.equal(state.handles[1].href, 'https://example.test/item?id=1');
  const numbered = page().blocks.filter((b) => b.n != null);
  assert.equal(Object.keys(state.handles).length, numbered.length, 'every numbered block must be resolvable');
});

test('do follows the link behind a number without the agent seeing a URL', () => {
  open();
  assert.deepEqual(activate(1), { url: 'https://example.test/item?id=1', text: 'Show HN: I built a tiny CSV toolkit' });
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
});

test('named sessions keep separate page state', () => {
  open('work');
  saveSession('other', { url: 'https://example.test/other', handles: {} });
  assert.equal(activate(1, { session: 'work' }).url, 'https://example.test/item?id=1');
  assert.throws(() => activate(1, { session: 'other' }), /no \[1\]/);
});

test('history grows with each page and stays bounded', () => {
  let state = null;
  for (let i = 0; i < 25; i++) state = sessionFromPage(distill(html, `https://example.test/p${i}`), state);
  assert.equal(state.history.length, 20);
  assert.equal(state.history.at(-1), 'https://example.test/p24');
});
