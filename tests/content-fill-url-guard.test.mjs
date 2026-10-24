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
  assert.match(source, /case 'FILL_FORM':\\s*\\/\\/ Reject stale or unbound fill messages before reading questions or writing fields\\.\\s*if \\(!matchesExpectedFillDocument\\(msg\\.expectedUrl\\)\\) return false;/);
  assert.match(source, /case 'FILL_FORM':\\s*return handleFillForm\\(msg\\.expectedUrl\\);/);
  assert.match(source, /async function handleFillForm\\(expectedUrl\\)/);
  assert.match(source, /if \\(!matchesExpectedFillDocument\\(expectedUrl\\)\\) throw new Error/);
});

test('fill delivery enumerates frame documents and targets the selected documentId', () => {
  const source = readFileSync(new URL('../lib/utils.js', import.meta.url), 'utf8');
  assert.match(source, /target: \\{ tabId, allFrames: true \\}/);
  assert.match(source, /chrome\\.tabs\\.sendMessage\\(tabId, msg, \\{ documentId \\}/);
  assert.match(source, /if \\(href !== expected\\.href\\) throw new Error/);
});
