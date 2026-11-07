import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Load the shipped classic content script and drive its real message listener.
const CONTENT_JS = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');
const EXPECTED = 'https://jobs.example/apply?id=1';

function load({ frameUrl = EXPECTED, referrer = EXPECTED, top = true } = {}) {
  const url = new URL(frameUrl);
  let listener;
  const sandbox = {
    document: { referrer, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], readyState: 'complete', documentElement: {}, body: null },
    location: url, URL, URLSearchParams, console, setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.MutationObserver = class { observe() {} disconnect() {} };
  sandbox.self = sandbox;
  sandbox.top = top ? sandbox : {};
  sandbox.chrome = {
    runtime: { id: 'ext-id', onMessage: { addListener(fn) { listener = fn; } }, sendMessage: () => Promise.resolve({}) },
  };
  vm.createContext(sandbox);
  vm.runInContext(CONTENT_JS, sandbox);
  const injected = [];
  sandbox.getFillableInputs = () => [{}];
  sandbox.loadFieldMap = async () => ({});
  sandbox.fillForm = (answers) => { injected.push(answers); return { filled: 1, unresolved: [] }; };
  return { sandbox, injected, send(msg, sender) {
    return new Promise((resolve) => {
      const kept = listener(msg, sender, resolve);
      if (!kept) resolve('declined');
    });
  } };
}

const msg = (extra = {}) => ({ type: 'INJECT_ANSWERS', payload: { name: 'x' }, expectedUrl: EXPECTED, ...extra });

test('inject: extension sender on the expected document fills', async () => {
  const f = load();
  const res = await f.send(msg(), { id: 'ext-id' });
  assert.equal(res.success, true);
  assert.equal(f.injected.length, 1);
});

test('inject: sender from another extension or page is declined', async () => {
  const f = load();
  assert.equal(await f.send(msg(), { id: 'other' }), 'declined');
  assert.equal(await f.send(msg(), {}), 'declined');
  assert.equal(f.injected.length, 0);
});

test('inject: missing or mismatched expected URL is declined', async () => {
  const f = load();
  assert.equal(await f.send(msg({ expectedUrl: undefined }), { id: 'ext-id' }), 'declined');
  assert.equal(await f.send(msg({ expectedUrl: 'https://jobs.example/apply?id=2' }), { id: 'ext-id' }), 'declined');
  assert.equal(f.injected.length, 0);
});

test('inject: cross-origin non-ATS child frame is declined', async () => {
  const f = load({ frameUrl: 'https://other.example/form', top: false });
  assert.equal(await f.send(msg(), { id: 'ext-id' }), 'declined');
  assert.equal(f.injected.length, 0);
});

test('inject: same-origin child frame with matching referrer fills', async () => {
  const f = load({ frameUrl: 'https://jobs.example/embedded', top: false });
  const res = await f.send(msg(), { id: 'ext-id' });
  assert.equal(res.success, true);
});
