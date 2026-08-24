import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const OC_HOME = mkdtempSync(join(tmpdir(), 'oc-cli-auth-'));
process.env.OC_HOME = OC_HOME;

const bin = new URL('../src/cli.js', import.meta.url).pathname;
const loginHtml = readFileSync(new URL('./pages/login.html', import.meta.url), 'utf8');
const dashHtml = `<html><head><title>Dashboard</title></head><body>
  <h1>Welcome back</h1>
  ${'<p>Secret project notes for the signed-in user.</p>'.repeat(20)}
</body></html>`;

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];

function childEnv(envExtra = {}) {
  const env = { ...process.env, OC_HOME, ...envExtra };
  for (const k of PROXY_ENV_KEYS) {
    if (!(k in envExtra)) delete env[k];
  }
  return env;
}

// Sync run for cases that never touch the network (login, logout, expired jar).
function oc(args, envExtra = {}) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: childEnv(envExtra) });
}

// Async run for cases that fetch through an in-process mock proxy: spawnSync
// would block the event loop the proxy server runs on and deadlock the test.
function ocAsync(args, envExtra = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { env: childEnv(envExtra) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('login saves a sidecar jar and logout removes it', () => {
  let r = oc(['login', '--cookie', 'sid=abc', '--domain', 'example.com', '--session', 'work']);
  assert.equal(r.status, 0, r.stderr);
  const jarPath = join(OC_HOME, 'sessions', 'work.cookies.json');
  const saved = JSON.parse(readFileSync(jarPath, 'utf8'));
  assert.equal(saved.cookies[0].value, 'abc');

  r = oc(['logout', 'work']);
  assert.equal(r.status, 0, r.stderr);
  assert.throws(() => readFileSync(jarPath), /ENOENT/);
});

test('open with an expired jar reports session expired and clears it', () => {
  const sessionsDir = join(OC_HOME, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  const jarPath = join(sessionsDir, 'expired.cookies.json');
  writeFileSync(jarPath, JSON.stringify({
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    cookies: [{ name: 'sid', value: 'old', domain: 'example.com', path: '/' }],
  }));
  const r = oc(['open', 'example.com', '--session', 'expired']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /session expired or cookies are no longer valid/);
  assert.equal(r.stdout.trim(), '');
  assert.throws(() => readFileSync(jarPath), /ENOENT/);
});

test('login requires --domain', () => {
  const r = oc(['login', '--cookie', 'sid=abc']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--domain is required/);
});

test('a session name that is a path is refused before any file is written', () => {
  for (const bad of ['../../.ssh/id_rsa', '/tmp/leak', 'a/b']) {
    const r = oc(['login', '--cookie', 'sid=abc', '--domain', 'example.com', '--session', bad]);
    assert.notEqual(r.status, 0, `expected failure for ${bad}`);
    assert.match(r.stderr, /invalid session name/);
  }
});

test('open sends the jar cookies and renders authenticated content', async () => {
  const proxy = http.createServer((req, res) => {
    const cookie = req.headers.cookie || '';
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(cookie.includes('sid=secret') ? dashHtml : loginHtml);
  });
  const port = await listen(proxy);
  const proxyUrl = `http://127.0.0.1:${port}`;
  try {
    let r = oc(['login', '--cookie', 'sid=secret', '--domain', '1.1.1.1', '--session', 'authed']);
    assert.equal(r.status, 0, r.stderr);

    r = await ocAsync(['open', 'http://1.1.1.1/dashboard', '--session', 'authed'], { HTTP_PROXY: proxyUrl });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Welcome back/);
    assert.doesNotMatch(r.stderr, /requires login|session expired/);
  } finally {
    proxy.close();
  }
});

test('open without cookies detects a login page and fails loud', async () => {
  const proxy = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(loginHtml);
  });
  const port = await listen(proxy);
  try {
    const r = await ocAsync(['open', 'http://1.1.1.1/login', '--session', 'anon'], {
      HTTP_PROXY: `http://127.0.0.1:${port}`,
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /requires login/);
    assert.equal(r.stdout.trim(), '');
  } finally {
    proxy.close();
  }
});

test('json auth failure does not overwrite saved page state', async () => {
  const sessionsDir = join(OC_HOME, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  const sessionPath = join(sessionsDir, 'keep.json');
  writeFileSync(sessionPath, JSON.stringify({
    url: 'http://1.1.1.1/dashboard',
    title: 'Dashboard',
    savedAt: new Date().toISOString(),
    blocks: [{ type: 'heading', text: 'Welcome back', n: 1, level: 1 }],
    cursor: null,
    history: ['http://1.1.1.1/dashboard'],
  }));

  const proxy = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(loginHtml);
  });
  const port = await listen(proxy);
  try {
    const r = await ocAsync(['open', 'http://1.1.1.1/login', '--json', '--session', 'keep'], {
      HTTP_PROXY: `http://127.0.0.1:${port}`,
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /requires login/);
    const saved = JSON.parse(readFileSync(sessionPath, 'utf8'));
    assert.equal(saved.title, 'Dashboard');
    assert.ok(existsSync(sessionPath));
  } finally {
    proxy.close();
  }
});
