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

test('inject: a message with no expectedUrl is refused in every frame', async () => {
  const top = load();
  assert.equal(await top.send(msg({ expectedUrl: undefined }), { id: 'ext-id' }), 'declined');
  const child = load({ frameUrl: 'https://jobs.example/embedded', top: false });
  assert.equal(await child.send(msg({ expectedUrl: undefined }), { id: 'ext-id' }), 'declined');
  assert.equal(top.injected.length + child.injected.length, 0);
});

test('inject: DETECT_ATS reports the frame URL used as expectedUrl', async () => {
  const f = load();
  const res = await f.send({ type: 'DETECT_ATS' }, { id: 'ext-id' });
  assert.equal(res.url, EXPECTED);
});

test('inject: expectedUrl that differs from location.href is refused', async () => {
  const f = load();
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

test('sendToActiveTab routes injection to the verified document, once, including after lazy injection', async () => {
  const prior = globalThis.chrome;
  const url = 'https://jobs.example/apply?id=1';
  const sent = [];
  let injected = 0;
  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: {
      async query() { return [{ id: 7, url }]; },
      async get() { return { url }; },
      sendMessage(_tab, message, options, cb) {
        sent.push({ message, documentId: options.documentId });
        if (options.documentId === 'top-doc' && injected === 0) {
          globalThis.chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          cb();
          globalThis.chrome.runtime.lastError = null;
          return;
        }
        cb({ success: true, filled: 0 });
      },
    },
    scripting: {
      async executeScript(opts) {
        if (opts.files) { injected += 1; return []; }
        return [
          { frameId: 0, documentId: 'top-doc', result: { href: url } },
          { frameId: 3, documentId: 'child-doc', result: { href: 'https://jobs.example/embedded' } },
        ];
      },
    },
  };
  try {
    const { sendToActiveTab } = await import('../lib/utils.js');
    const res = await sendToActiveTab({ type: 'INJECT_ANSWERS', payload: { a: 1 } });
    assert.equal(res.success, true);
    assert.equal(injected, 1);
    assert.ok(sent.every((s) => s.message.type === 'INJECT_ANSWERS' && s.message.expectedUrl === url && s.message.payload.a === 1));
    assert.deepEqual(sent.map((s) => s.documentId), ['top-doc', 'top-doc'], 'second frame is never offered the answers');
  } finally {
    if (prior === undefined) delete globalThis.chrome; else globalThis.chrome = prior;
  }
});

test('sendToActiveTab falls back to a URL-bound tab message when frames cannot be enumerated', async () => {
  const prior = globalThis.chrome;
  const url = 'https://jobs.example/apply?id=1';
  const sent = [];
  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: {
      async query() { return [{ id: 7, url }]; },
      async get() { return { url }; },
      sendMessage(_tab, message, cb) { sent.push(message); cb({ success: true, filled: 2 }); },
    },
    scripting: { async executeScript() { throw new Error('Cannot access contents of the page.'); } },
  };
  try {
    const { sendToActiveTab } = await import('../lib/utils.js');
    const res = await sendToActiveTab({ type: 'INJECT_ANSWERS', payload: { a: 1 } });
    assert.equal(res.filled, 2);
    assert.equal(sent[0].expectedUrl, url);
  } finally {
    if (prior === undefined) delete globalThis.chrome; else globalThis.chrome = prior;
  }
});

test('sendToActiveTab sends injection to the tab when the popup cannot read its URL', async () => {
  const prior = globalThis.chrome;
  const sent = [];
  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: {
      async query() { return [{ id: 7 }]; },
      sendMessage(_tab, message, cb) { sent.push(message); cb({ success: true, filled: 1 }); },
    },
  };
  try {
    const { sendToActiveTab } = await import('../lib/utils.js');
    const res = await sendToActiveTab({ type: 'INJECT_ANSWERS', payload: { a: 1 } });
    assert.equal(res.filled, 1);
    assert.equal(sent.length, 1);
  } finally {
    if (prior === undefined) delete globalThis.chrome; else globalThis.chrome = prior;
  }
});
