import test from 'node:test';
import assert from 'node:assert/strict';

const { fetchPage, followRedirects } = await import('../src/fetch.js');

const BLOCKED_MESSAGE = 'blocked: private or internal URL';

test('fetchPage blocks literal loopback and RFC 1918 / link-local hosts', async () => {
  const blocked = [
    'localhost',
    'localhost:8080',
    '127.0.0.1',
    '127.0.0.1/admin',
    '10.0.0.1',
    '192.168.1.1/admin',
    '172.16.0.5',
    '172.31.255.255',
    '169.254.169.254/latest/meta-data/',
    '0.0.0.0',
    '[::1]',
  ];
  for (const host of blocked) {
    await assert.rejects(() => fetchPage(host), new RegExp(BLOCKED_MESSAGE), `expected ${host} to be blocked`);
  }
});

test('fetchPage does not block an ordinary public hostname', async () => {
  // A live fetch of example.com should succeed outright, or at worst fail for
  // a network reason - it must never be rejected by the private-URL guard.
  try {
    await fetchPage('example.com');
  } catch (err) {
    assert.ok(!err.message.includes(BLOCKED_MESSAGE), `unexpected block: ${err.message}`);
  }
});

test('fetchPage does not false-positive on a public hostname that merely starts with a private-looking numeric label', async () => {
  // Regression check: an earlier version of this guard matched the URL's
  // hostname STRING against ^-anchored prefixes like "10." and could not
  // tell a private IPv4 octet from an ordinary DNS label, so a domain like
  // 10.example.com (subdomain "10" of example.com) was wrongly blocked as if
  // it were 10.0.0.0/8. Validating the resolved address instead of the
  // string fixes this.
  try {
    await fetchPage('10.example.com');
  } catch (err) {
    assert.ok(!err.message.includes(BLOCKED_MESSAGE), `unexpected block: ${err.message}`);
  }
});

test('fetchPage blocks an IPv4-mapped IPv6 loopback literal', async () => {
  // new URL('https://[::ffff:127.0.0.1]/').hostname === '::ffff:7f00:1'
  // (compressed hex) - a string blocklist checking for "127." or "::1" never
  // matches this form, so it has to be decoded and checked as the IPv4
  // address it embeds.
  await assert.rejects(() => fetchPage('https://[::ffff:127.0.0.1]/'), new RegExp(BLOCKED_MESSAGE));
});

test('fetchPage blocks a hostname that merely resolves to a loopback address (DNS rebinding shape)', async () => {
  // localtest.me is a public, real-world domain that resolves to 127.0.0.1 /
  // ::1. Its hostname string looks nothing like a private address, so this
  // can only be caught by resolving it and validating the resulting IP -
  // exactly the shape of a DNS-rebinding attack.
  await assert.rejects(() => fetchPage('localtest.me'), new RegExp(BLOCKED_MESSAGE));
});

// A response, as little of one as the redirect loop reads.
const replies = (...hops) => {
  const asked = [];
  const get = (url) => {
    asked.push(url);
    const hop = hops[asked.length - 1] ?? { status: 200 };
    return Promise.resolve({ status: hop.status, headers: new Map(hop.location ? [['location', hop.location]] : []) });
  };
  return { get, asked };
};

test('every redirect hop is re-validated, not just the original URL', async () => {
  // An SSRF hides the real target behind a public-looking first hop, so the
  // check has to run again on what the 302 names. This used to be proven
  // against httpbin.org, which meant a third party's uptime could fail the
  // release, and it never covered the impers transport's own copy of the loop.
  const { get, asked } = replies({ status: 302, location: 'http://127.0.0.1/admin' });
  await assert.rejects(() => followRedirects(get, 'https://public.example/start'), new RegExp(BLOCKED_MESSAGE));
  // Blocked before the socket, not after: the private address is never asked for.
  assert.deepEqual(asked, ['https://public.example/start']);
});

test('a hop to somewhere public is followed', async () => {
  // The other half of the guarantee. A loop that rejected everything would
  // pass the test above and break every redirect on the web.
  const { get, asked } = replies(
    { status: 301, location: 'https://elsewhere.example/moved' },
    { status: 302, location: '/relative' },
  );
  const { res, url } = await followRedirects(get, 'https://public.example/start');
  assert.equal(res.status, 200);
  assert.equal(url, 'https://elsewhere.example/relative');
  assert.equal(asked.length, 3);
});

test('a redirect loop gives up instead of spinning', async () => {
  const get = () => Promise.resolve({ status: 302, headers: new Map([['location', 'https://public.example/again']]) });
  await assert.rejects(() => followRedirects(get, 'https://public.example/start'), /too many redirects/);
});

test('the readable-type gate accepts text and refuses binary, on either transport', async () => {
  const { assertReadableType } = await import('../src/fetch.js');

  // Everything oc has something to say about.
  for (const type of [
    'text/html; charset=utf-8',
    'text/plain',
    'text/markdown',
    'application/json',
    'application/json; charset=utf-8',
    'application/xml',
    'application/atom+xml',
    'application/rss+xml',
    'application/ld+json',
    ' text/html ',
  ]) {
    assert.doesNotThrow(() => assertReadableType(type), `expected ${type} to be readable`);
  }

  // A missing header is not a refusal: small servers omit it and the page
  // behind it is usually fine.
  assert.doesNotThrow(() => assertReadableType(undefined));
  assert.doesNotThrow(() => assertReadableType(''));

  // Binary renders as pages of mojibake the agent pays for, so it is named
  // and refused rather than distilled.
  for (const type of ['image/png', 'image/jpeg', 'application/pdf', 'application/octet-stream', 'video/mp4', 'application/zip']) {
    assert.throws(() => assertReadableType(type), /not a page oc can read/, `expected ${type} to be refused`);
  }
  assert.throws(() => assertReadableType('image/png'), /image\/png/);
});
