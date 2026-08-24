import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveSite, listSites, sites } = await import('../src/sites.js');

test('a site resolves by short name, bare name, and full domain alike', () => {
  const expected = 'https://news.ycombinator.com/item?id=4711';
  for (const name of ['hn', 'ycombinator', 'news.ycombinator.com']) {
    assert.equal(resolveSite(name, ['item', '4711']).url, expected, `via ${name}`);
  }
});

test('a name oc ships no definition for resolves to null, not an error', () => {
  // cli.js reports 'unknown command' on null, so a typo must not be reported
  // as a site problem.
  assert.equal(resolveSite('example.com', ['open']), null);
  assert.equal(resolveSite('opne', []), null);
});

test('templating fills every arg in order and percent-encodes each value', () => {
  assert.equal(
    resolveSite('gh', ['repo', 'only-cli', 'oc']).url,
    'https://github.com/only-cli/oc');
  assert.equal(
    resolveSite('ddg', ['search', 'c++ operator?']).url,
    'https://html.duckduckgo.com/html/?q=c%2B%2B%20operator%3F');
});

test('the last arg takes every remaining word, so a query needs no quoting', () => {
  const quoted = resolveSite('ddg', ['search', 'claude code cli']).url;
  const bare = resolveSite('ddg', ['search', 'claude', 'code', 'cli']).url;
  assert.equal(bare, quoted);
});

test('a shortcut with no args ignores nothing and takes no args', () => {
  assert.equal(resolveSite('hn', ['top']).url, 'https://news.ycombinator.com');
});

test('a real site with a missing or unknown verb names the verbs it has', () => {
  assert.throws(() => resolveSite('reddit', []), /usage: oc reddit <verb>.*sub <name>/s);
  assert.throws(() => resolveSite('reddit', ['subreddit', 'ClaudeAI']),
    /not a reddit\.com shortcut.*sub <name>/s);
});

test('a shortcut called with too few args says what it needs', () => {
  assert.throws(() => resolveSite('gh', ['repo', 'only-cli']), /usage: oc gh repo <owner> <name>/);
});

test('every shipped definition is reachable and every url template is filled', () => {
  const domains = new Set([...sites().values()].map((s) => s.domain));
  assert.ok(domains.size >= 10, `expected the shipped definitions, saw ${domains.size}`);
  for (const [name, site] of sites()) {
    for (const [verb, def] of Object.entries(site.commands)) {
      const args = (def.args ?? []).map((a) => `test-${a}`);
      const { url } = resolveSite(name, [verb, ...args]);
      assert.doesNotMatch(url, /[{}]/, `oc ${name} ${verb} left a template var in ${url}`);
      assert.equal(new URL(url).protocol, 'https:', `oc ${name} ${verb} is not https`);
    }
  }
});

test('oc sites lists every site once, with a verb line an agent can copy', () => {
  const text = listSites();
  const domains = new Set([...sites().values()].map((s) => s.domain));
  for (const domain of domains) {
    assert.equal(text.split(domain).length - 1, 1, `${domain} should appear exactly once`);
  }
  assert.match(text, /^oc hn <verb> \(ycombinator, news\.ycombinator\.com\): top \| new \| item <id>/m);
});

test('language docs shortcuts resolve, and a doc path keeps its slashes', () => {
  assert.equal(
    resolveSite('py', ['library', 'json']).url,
    'https://docs.python.org/3/library/json.html');
  assert.equal(
    resolveSite('python', ['doc', 'reference/datamodel']).url,
    'https://docs.python.org/3/reference/datamodel.html');
  assert.equal(
    resolveSite('mdn', ['js', 'Array/map']).url,
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map');
  assert.equal(
    resolveSite('mozilla', ['css', 'grid-template-columns']).url,
    'https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns');
  assert.equal(
    resolveSite('node', ['api', 'fs']).url,
    'https://nodejs.org/api/fs.html');
  assert.equal(
    resolveSite('nodejs.org', ['search', 'readFile options']).url,
    'https://html.duckduckgo.com/html/?q=site%3Anodejs.org+readFile%20options');
});
