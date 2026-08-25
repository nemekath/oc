import test from 'node:test';
import assert from 'node:assert/strict';

const { parseRdocIndex, buildRdocEntries, resultsToHTML } = await import('../src/rdoc.js');
const { searchEntries } = await import('../src/nodedocs.js');

const BASE = 'https://docs.ruby-lang.org/en/3.4/';

// A miniature search_index.js: a class page, instance and class methods, a
// name shared across classes, a guide page, and a snippet that would be
// markup if it were ever trusted. Rows are [name, namespace, path, params,
// snippet], the shape RDoc generates.
const INDEX = `var search_data = ${JSON.stringify({
  index: {
    searchIndex: ['array', 'dig', 'dig', 'new', 'each_slice', 'contributing', 'evil'],
    longSearchIndex: ['array', 'array::dig', 'hash::dig', 'array::new', 'array::each_slice', 'contributing', 'evil'],
    info: [
      ['Array', '', 'Array.html', '', '<p>An Array is an ordered collection.'],
      ['dig', 'Array', 'Array.html#method-i-dig', '(*args)', '<p>Finds the object in nested objects.'],
      ['dig', 'Hash', 'Hash.html#method-i-dig', '(*args)', '<p>Finds the object in nested objects.'],
      ['new', 'Array', 'Array.html#method-c-new', '(size, default)', '<p>Returns a new array.'],
      ['each_slice', 'Array', 'Array.html#method-i-each_slice', '(n)', '<p>Iterates in slices.'],
      ['contributing', '', 'contributing_md.html', '', '<p>How to contribute.'],
      ['evil<script>alert(1)</script>', 'Array', 'Array.html#method-i-evil', '', ''],
    ],
  },
})}`;

const entries = () => buildRdocEntries(parseRdocIndex(INDEX));

test('only an RDoc index parses, so an error page never enters the cache', () => {
  assert.ok(parseRdocIndex(INDEX).index.info.length > 0);
  assert.throws(() => parseRdocIndex('<html>blocked</html>'), /not an RDoc search index/);
  assert.throws(() => parseRdocIndex('var search_data = {"unrelated": true}'), /not an RDoc search index/);
});

test('rows read back as the headings a rubyist expects', () => {
  const all = entries();
  assert.equal(all.find((e) => e.path.includes('method-i-dig') && e.text.startsWith('Array')).text, 'Array#dig(*args)');
  assert.equal(all.find((e) => e.path.includes('method-c-new')).text, 'Array.new(size, default)');
  assert.equal(all.find((e) => e.path === 'Array.html').text, 'Array');
  assert.equal(all.find((e) => e.path === 'contributing_md.html').kind, 'page');
});

test('a symbol query finds its methods across classes, exact name first', () => {
  const found = searchEntries(entries(), 'dig');
  assert.equal(found.total, 2);
  assert.deepEqual(found.hits.map((e) => e.text).sort(), ['Array#dig(*args)', 'Hash#dig(*args)']);
  assert.equal(found.partial, false);
});

test('a class and method pair narrows to the one entry matching both words', () => {
  const found = searchEntries(entries(), 'array each_slice');
  assert.equal(found.total, 1);
  assert.equal(found.hits[0].text, 'Array#each_slice(n)');
});

test('results link into the live docs, anchors intact, and name their kind', () => {
  const html = resultsToHTML(BASE, 'dig', searchEntries(entries(), 'dig'));
  assert.match(html, /href="https:\/\/docs\.ruby-lang\.org\/en\/3\.4\/Array\.html#method-i-dig"/);
  assert.match(html, /Array#dig\(\*args\)<\/a> method/);
  assert.match(html, /2 entries match in the docs' own index, ranked locally:/);
});

test('an index row is data, never markup on the results page', () => {
  const html = resultsToHTML(BASE, 'evil', searchEntries(entries(), 'evil'));
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /evil&lt;script&gt;/);
});

test('nothing matching renders an honest empty page, not an error', () => {
  const html = resultsToHTML(BASE, 'zzqqxx', searchEntries(entries(), 'zzqqxx'));
  assert.match(html, /nothing in the docs' own index matches/);
  assert.doesNotMatch(html, /<ol>/);
});
