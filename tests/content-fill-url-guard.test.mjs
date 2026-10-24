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
