import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// manifest.json injects content/content.js as a classic script, so its inline
// frame guard is the shipped one. Load that file itself in a sandbox.
const CONTENT_JS = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');
const GUARD_JS = readFileSync(new URL('../content/fill-url-guard.js', import.meta.url), 'utf8');

function atsList(source) {
  const match = source.match(/\[((?:\s*'[a-z0-9.-]+',?)+\s*)\]\s*\n?\s*\.some|ATS_FRAME_HOSTS = \[([^\]]+)\]/);
  const body = match?.[1] ?? match?.[2];
  assert.ok(body, 'ATS host list not found');
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

function loadGuard({ frameUrl, referrer = '', top = false }) {
  const url = frameUrl === 'about:blank'
    ? { href: 'about:blank', origin: 'null', protocol: 'about:', hostname: '', pathname: 'blank', search: '' }
    : new URL(frameUrl);
  const sandbox = { document: { referrer, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], readyState: 'complete', documentElement: {}, body: null }, location: url, URL, console, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.MutationObserver = class { observe() {} disconnect() {} };
  sandbox.self = sandbox;
  sandbox.top = top ? sandbox : {};
  sandbox.chrome = { runtime: { onMessage: { addListener() {} }, sendMessage: () => Promise.resolve({}) } };
  vm.createContext(sandbox);
  vm.runInContext(`${CONTENT_JS}\n;globalThis.__guard = matchesExpectedFillDocument;`, sandbox);
  return sandbox.__guard;
}

const EXPECTED = 'https://jobs.example/apply?id=1';
const REFERRER = 'https://jobs.example/apply?id=1';
const fills = (frameUrl, referrer = REFERRER) => loadGuard({ frameUrl, referrer })(EXPECTED);

test('shipped guard: same-origin child frame fills', () => {
  assert.equal(fills('https://jobs.example/embedded'), true);
});

test('shipped guard: known ATS subdomain over https fills', () => {
  assert.equal(fills('https://job-boards.greenhouse.io/embed/job_app'), true);
});

test('shipped guard: ATS host over http is refused', () => {
  assert.equal(fills('http://boards.greenhouse.io/embed/job_app'), false);
});

test('shipped guard: lookalike host is refused', () => {
  assert.equal(fills('https://notgreenhouse.io/form'), false);
});

test('shipped guard: about:blank with an empty referrer is refused', () => {
  assert.equal(fills('about:blank', ''), false);
});

test('shipped guard: cross-origin non-ATS host is refused', () => {
  assert.equal(fills('https://other.example/form'), false);
});

test('shipped guard: top frame still needs the exact URL', () => {
  const guard = loadGuard({ frameUrl: EXPECTED, top: true });
  assert.equal(guard(EXPECTED), true);
  assert.equal(guard('https://jobs.example/apply?id=2'), false);
});

test('ATS host list in content.js matches fill-url-guard.js', () => {
  assert.deepEqual(atsList(CONTENT_JS), atsList(GUARD_JS));
});
