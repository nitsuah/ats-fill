import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { matchesExpectedFillDocument } from '../content/fill-url-guard.js';

globalThis.window = { location: { href: 'https://jobs.example/application?id=1' } };
globalThis.window.top = globalThis.window;
globalThis.document = { referrer: '' };

test('fill receiver requires the exact selected URL in the top-level document', () => {
  assert.equal(matchesExpectedFillDocument({ type: 'FILL_FORM', expectedUrl: 'https://jobs.example/application?id=1' }), true);
  assert.equal(matchesExpectedFillDocument({ type: 'FILL_FORM', expectedUrl: 'https://jobs.example/application?id=2' }), false);
  assert.equal(matchesExpectedFillDocument({ type: 'FILL_FORM', expectedUrl: 'javascript:alert(1)' }), false);
  assert.equal(matchesExpectedFillDocument({ type: 'FILL_FORM', expectedUrl: 'not a URL' }), false);
});

test('fill receiver checks full referrers and accepts browsers that reduce cross-origin referrers to origin', () => {
  const top = globalThis.window;
  globalThis.window = { top, location: { href: 'https://forms.example/embedded' } };
  globalThis.document = { referrer: 'https://jobs.example/application?id=1' };
  assert.equal(matchesExpectedFillDocument({ type: 'FILL_FORM', expectedUrl: 'https://jobs.example/application?id=1' }), true);
  globalThis.document.referrer = 'https://jobs.example/application?id=2';
  assert.equal(matchesExpectedFillDocument({ type: 'FILL_FORM', expectedUrl: 'https://jobs.example/application?id=1' }), false);
  globalThis.document.referrer = 'https://jobs.example/';
  assert.equal(matchesExpectedFillDocument({ type: 'FILL_FORM', expectedUrl: 'https://jobs.example/application?id=1' }), true);
  globalThis.document.referrer = 'https://attacker.example/';
  assert.equal(matchesExpectedFillDocument({ type: 'FILL_FORM', expectedUrl: 'https://jobs.example/application?id=1' }), false);
  globalThis.document.referrer = 'https://jobs.example/application?id=1';
  assert.equal(matchesExpectedFillDocument({ type: 'FILL_FORM', expectedUrl: 'https://jobs.example/application?id=1#step-2' }), false);
  globalThis.window = top;
});

test('production content script enforces the URL guard before filling and revalidates after async work', () => {
  const source = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');
  assert.ok(source.includes('if (!matchesExpectedFillDocument(msg.expectedUrl)) return false;'));
  assert.ok(source.includes('return handleFillForm(msg.expectedUrl);'));
  assert.ok(source.includes('async function handleFillForm(expectedUrl)'));
  assert.ok(source.includes('if (!matchesExpectedFillDocument(expectedUrl)) throw new Error'));
});

test('fill delivery enumerates frame documents and targets the selected documentId', () => {
  const source = readFileSync(new URL('../lib/utils.js', import.meta.url), 'utf8');
  assert.ok(source.includes('target: { tabId, allFrames: true }'));
  assert.ok(source.includes('chrome.tabs.sendMessage(tabId, msg, { documentId }'));
  assert.ok(source.includes('if (href !== expected.href) throw new Error'));
});

test('sender binds fill delivery to the verified frame documentId', async () => {
  const priorChrome = globalThis.chrome;
  const expectedUrl = 'https://jobs.example/application?id=1';
  const targetedDocuments = [];
  let lastError = null;
  let urlReads = 0;
  globalThis.chrome = {
    runtime: { get lastError() { return lastError; } },
    tabs: {
      async get() { urlReads += 1; return { url: expectedUrl }; },
      sendMessage(_tabId, _message, options, callback) {
        targetedDocuments.push(options.documentId);
        if (options.documentId === 'top-doc') {
          lastError = { message: 'The message port closed before a response was received.' };
          callback(undefined);
          lastError = null;
          return;
        }
        callback({ success: true, filled: 3 });
      },
    },
    scripting: {
      async executeScript() {
        return [
          { frameId: 0, documentId: 'top-doc', result: { href: expectedUrl } },
          { frameId: 4, documentId: 'form-doc', result: { href: 'https://forms.example/application' } },
        ];
      },
    },
  };
  try {
    const { sendFillFormToVerifiedTab } = await import('../lib/utils.js');
    const result = await sendFillFormToVerifiedTab(7, expectedUrl);
    assert.deepEqual(targetedDocuments, ['top-doc', 'form-doc']);
    assert.equal(result.success, true);
    assert.equal(result.filled, 3);
    assert.ok(urlReads >= 3, 'the browser-owned tab URL is rechecked before delivery');
  } finally {
    if (priorChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = priorChrome;
  }
});

test('sender aborts if the top-level URL changes before document-targeted delivery', async () => {
  const priorChrome = globalThis.chrome;
  const expectedUrl = 'https://jobs.example/application?id=1';
  let reads = 0;
  let sendCount = 0;
  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: {
      async get() {
        reads += 1;
        return { url: reads === 1 ? expectedUrl : 'https://jobs.example/application?id=2' };
      },
      sendMessage() { sendCount += 1; },
    },
    scripting: {
      async executeScript() {
        return [{ frameId: 0, documentId: 'top-doc', result: { href: expectedUrl } }];
      },
    },
  };
  try {
    const { sendFillFormToVerifiedTab } = await import('../lib/utils.js');
    await assert.rejects(sendFillFormToVerifiedTab(7, expectedUrl), /navigated or changed/);
    assert.equal(sendCount, 0, 'no fill message is sent after navigation');
  } finally {
    if (priorChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = priorChrome;
  }
});

test('sender lazily injects only into the selected document when no receiver exists', async () => {
  const priorChrome = globalThis.chrome;
  const expectedUrl = 'https://jobs.example/application?id=1';
  const injectionTargets = [];
  let lastError = null;
  let formMessages = 0;
  globalThis.chrome = {
    runtime: { get lastError() { return lastError; } },
    tabs: {
      async get() { return { url: expectedUrl }; },
      sendMessage(_tabId, _message, options, callback) {
        if (options.documentId === 'top-doc') {
          lastError = { message: 'The message port closed before a response was received.' };
          callback(undefined);
          lastError = null;
          return;
        }
        formMessages += 1;
        if (formMessages === 1) {
          lastError = { message: 'Receiving end does not exist.' };
          callback(undefined);
          lastError = null;
          return;
        }
        callback({ success: true, filled: 2 });
      },
    },
    scripting: {
      async executeScript({ target }) {
        if (target.allFrames) {
          return [
            { frameId: 0, documentId: 'top-doc', result: { href: expectedUrl } },
            { frameId: 4, documentId: 'form-doc', result: { href: 'https://forms.example/application' } },
          ];
        }
        injectionTargets.push(...target.documentIds);
        return [];
      },
    },
  };
  try {
    const { sendFillFormToVerifiedTab } = await import('../lib/utils.js');
    const result = await sendFillFormToVerifiedTab(7, expectedUrl);
    assert.deepEqual(injectionTargets, ['form-doc']);
    assert.equal(result.success, true);
    assert.equal(result.filled, 2);
  } finally {
    if (priorChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = priorChrome;
  }
});
