import test from 'node:test';
import assert from 'node:assert/strict';

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
