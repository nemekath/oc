import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.OC_HOME = mkdtempSync(join(tmpdir(), 'oc-cookie-test-'));

const {
  jarFromCookieHeader,
  parseExpires,
  cookieHeaderFor,
  parseSetCookie,
  storeFromResponse,
  saveCookieJar,
  loadCookieJar,
  clearCookieJar,
  purgeExpiredJars,
  isSessionExpired,
  cookieJarPath,
  JAR_EXPIRED,
  _resetPurgeGuard,
} = await import('../src/cookies.js');

test('parseExpires accepts common durations', () => {
  assert.equal(parseExpires('1h'), 3_600_000);
  assert.equal(parseExpires('30m'), 1_800_000);
  assert.equal(parseExpires('2d'), 172_800_000);
});

test('jarFromCookieHeader parses a Cookie header for a domain', () => {
  const jar = jarFromCookieHeader('session=abc; auth=xyz', 'Example.COM');
  assert.equal(jar.cookies.length, 2);
  assert.equal(jar.cookies[0].name, 'session');
  assert.equal(jar.cookies[0].value, 'abc');
  assert.equal(jar.cookies[0].domain, 'example.com');
  assert.ok(Date.parse(jar.expiresAt) > Date.now());
});

test('cookieHeaderFor matches domain and path', () => {
  const jar = {
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    cookies: [
      { name: 'a', value: '1', domain: 'example.com', path: '/' },
      { name: 'b', value: '2', domain: 'other.com', path: '/' },
      { name: 'c', value: '3', domain: 'example.com', path: '/app', secure: true },
    ],
  };
  assert.equal(cookieHeaderFor(jar, 'https://example.com/app/home'), 'a=1; c=3');
  assert.equal(cookieHeaderFor(jar, 'http://example.com/app/home'), 'a=1');
  assert.equal(cookieHeaderFor(jar, 'https://other.com/'), 'b=2');
  assert.equal(cookieHeaderFor(jar, 'https://example.com/other'), 'a=1');
});

test('parseSetCookie reads attributes and pins the cookie host-only', () => {
  const c = parseSetCookie('sid=val; Path=/app; Domain=.example.com; Secure; HttpOnly; Max-Age=3600',
    'https://www.example.com/login');
  assert.equal(c.name, 'sid');
  assert.equal(c.value, 'val');
  // Domain is ignored: the cookie is scoped to the host that set it, not the
  // wider domain the response asked for.
  assert.equal(c.domain, 'www.example.com');
  assert.equal(c.path, '/app');
  assert.ok(c.secure);
  assert.ok(c.httpOnly);
  assert.ok(c.expires);
});

test('a response cannot widen a cookie to a public suffix and reach other sites', () => {
  const jar = { expiresAt: new Date(Date.now() + 3_600_000).toISOString(), cookies: [] };
  // A page fetched under the jar tries to plant a '.com'-scoped cookie.
  const next = storeFromResponse(jar, 'https://evil.example/', ['sid=x; Domain=.com; Path=/']);
  assert.equal(next.cookies[0].domain, 'evil.example');
  // It is never sent to an unrelated site that merely shares the suffix.
  assert.equal(cookieHeaderFor(next, 'https://bank.com/'), undefined);
  assert.equal(cookieHeaderFor(next, 'https://evil.example/'), 'sid=x');
});

test('storeFromResponse replaces cookies with the same name and domain', () => {
  const jar = {
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    cookies: [{ name: 'sid', value: 'old', domain: 'example.com', path: '/' }],
  };
  const next = storeFromResponse(jar, 'https://example.com/', ['sid=new; Path=/; Domain=example.com']);
  assert.equal(next.cookies.length, 1);
  assert.equal(next.cookies[0].value, 'new');
});

test('session ceiling caps per-cookie expiry from Set-Cookie', () => {
  const ceiling = new Date(Date.now() + 3_600_000).toISOString();
  const jar = { expiresAt: ceiling, cookies: [] };
  const next = storeFromResponse(jar, 'https://example.com/', [
    'sid=x; Max-Age=86400; Domain=example.com; Path=/',
  ]);
  assert.equal(next.cookies[0].expires, ceiling);
});

test('saveCookieJar writes with mode 0600 and loadCookieJar reads back', () => {
  clearCookieJar('work');
  const jar = jarFromCookieHeader('token=secret', 'example.com', { expiresMs: 3_600_000 });
  saveCookieJar('work', jar);
  const mode = statSync(cookieJarPath('work')).mode & 0o777;
  assert.equal(mode, 0o600);
  const loaded = loadCookieJar('work');
  assert.equal(loaded.cookies[0].value, 'secret');
});

test('loadCookieJar returns JAR_EXPIRED and clears an expired jar', () => {
  clearCookieJar('expired');
  saveCookieJar('expired', {
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    cookies: [{ name: 'a', value: 'b', domain: 'example.com', path: '/' }],
  });
  _resetPurgeGuard();
  assert.equal(loadCookieJar('expired'), JAR_EXPIRED);
  assert.throws(() => readFileSync(cookieJarPath('expired')), /ENOENT/);
});

test('purgeExpiredJars removes stale sidecar files', () => {
  clearCookieJar('old');
  clearCookieJar('fresh');
  writeFileSync(cookieJarPath('old'), JSON.stringify({
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    cookies: [{ name: 'a', value: 'b', domain: 'example.com', path: '/' }],
  }));
  saveCookieJar('fresh', jarFromCookieHeader('x=1', 'example.com'));
  _resetPurgeGuard();
  purgeExpiredJars();
  assert.throws(() => readFileSync(cookieJarPath('old')), /ENOENT/);
  assert.ok(loadCookieJar('fresh'));
});

test('isSessionExpired respects the session ceiling', () => {
  const jar = { expiresAt: new Date(Date.now() + 1000).toISOString(), cookies: [] };
  assert.ok(!isSessionExpired(jar));
  jar.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.ok(isSessionExpired(jar));
});
