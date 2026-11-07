import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const CONTENT_JS = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');

function keys(href) {
  const sandbox = {
    document: { referrer: '', addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], readyState: 'complete', documentElement: {}, body: null },
    location: new URL(href), URL, URLSearchParams, console, setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.MutationObserver = class { observe() {} disconnect() {} };
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.chrome = { runtime: { onMessage: { addListener() {} }, sendMessage: () => Promise.resolve({}) } };
  vm.createContext(sandbox);
  vm.runInContext(`${CONTENT_JS}\n;globalThis.__k = { page: getDraftPageKey(), legacy: getLegacyDraftPageKey(), found: findDraftForPage({ 'https://jobs.example/apply': { fields: { a: 1 } } }) !== undefined };`, sandbox);
  return sandbox.__k;
}

test('draft key: different application ids on one path do not collide', () => {
  assert.notEqual(keys('https://jobs.example/apply?gh_jid=1').page, keys('https://jobs.example/apply?gh_jid=2').page);
});

test('draft key: param order, tracking params and hash are ignored', () => {
  const a = keys('https://jobs.example/apply?b=2&a=1&utm_source=x&gclid=9#top').page;
  const b = keys('https://jobs.example/apply?a=1&b=2&utm_campaign=y').page;
  assert.equal(a, b);
});

test('draft key: no query keeps the old-format key', () => {
  const k = keys('https://jobs.example/apply/');
  assert.equal(k.page, 'https://jobs.example/apply');
  assert.equal(k.legacy, k.page);
});

test('draft key: legacy key stays the query-less path for migration reads', () => {
  assert.equal(keys('https://jobs.example/apply?id=1').legacy, 'https://jobs.example/apply');
});

test('draft key: per-visit session params do not change the key', () => {
  assert.equal(
    keys('https://jobs.example/apply?id=1&sessionId=abc&token=t1').page,
    keys('https://jobs.example/apply?id=1&sessionId=zzz&token=t2').page,
  );
});

test('legacy query-less draft is shown without a query but not with a real query param', () => {
  assert.equal(keys('https://jobs.example/apply?utm_source=x').found, true);
  assert.equal(keys('https://jobs.example/apply?id=2').found, false);
});

test('draft-key code is identical in content.js and form-filler.js', () => {
  const FILLER_JS = readFileSync(new URL('../content/form-filler.js', import.meta.url), 'utf8');
  const grab = (src, re) => { const m = src.match(re); assert.ok(m, `missing ${re}`); return m[0]; };
  const parts = [
    /const DRAFT_TRACKING_PARAMS = [^\n]*\n/,
    /function getLegacyDraftPageKey\(\) \{[\s\S]*?\n\}\n/,
    /function findDraftForPage\(drafts\) \{[\s\S]*?\n\}\n/,
    /function getDraftPageKey\(\) \{[\s\S]*?\n\}\n/,
  ];
  for (const re of parts) assert.equal(grab(CONTENT_JS, re), grab(FILLER_JS, re));
});
