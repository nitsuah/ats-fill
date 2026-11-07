import test from 'node:test';
import assert from 'node:assert/strict';

import { applyProfileOverrides } from '../background/modules/helpers.js';
import { shouldPersistLearnedValue } from '../lib/form-filler.js';
import { matchesExpectedFillDocument } from '../content/fill-url-guard.js';
import { findExtensionId, STORE_EXTENSION_ID } from '../scripts/tracker/cdp.mjs';

test('pronouns_sensitive only reaches pronouns with the sensitive opt-in', () => {
  const withoutOptIn = applyProfileOverrides({ name: 'A B' }, { pronouns_sensitive: 'they/them' }, {});
  assert.equal(withoutOptIn.pronouns || '', '');
  const optedIn = applyProfileOverrides({ name: 'A B' }, { pronouns_sensitive: 'they/them', sensitive_optin: true }, {});
  assert.equal(optedIn.pronouns, 'they/them');
});

test('self-identification answers are not kept as learned values', () => {
  for (const label of ['Gender', 'What is your race / ethnicity?', 'Veteran Status', 'Disability Status', 'Are you Hispanic or Latino?', 'Preferred pronouns']) {
    assert.equal(shouldPersistLearnedValue(label, 'Some answer'), false, label);
  }
  assert.equal(shouldPersistLearnedValue('Preferred framework', 'TypeScript'), true);
});

function frame(href, referrer) {
  const url = new URL(href);
  globalThis.window = { top: {}, location: url };
  globalThis.document = { referrer };
}

test('child frames fill only when same-origin with the page or on a known ATS host', () => {
  const msg = { expectedUrl: 'https://jobs.example/apply?id=1' };
  frame('https://jobs.example/embedded', 'https://jobs.example/apply?id=1');
  assert.equal(matchesExpectedFillDocument(msg), true);
  frame('https://job-boards.greenhouse.io/embed/job_app', 'https://jobs.example/apply?id=1');
  assert.equal(matchesExpectedFillDocument(msg), true);
  frame('https://other.example/form', 'https://jobs.example/apply?id=1');
  assert.equal(matchesExpectedFillDocument(msg), false);
  frame('https://notgreenhouse.io/form', 'https://jobs.example/apply?id=1');
  assert.equal(matchesExpectedFillDocument(msg), false);
});

function fakeCdp(name, ids) {
  const targetInfos = ids.map((id) => ({ type: 'service_worker', targetId: id, url: `chrome-extension://${id}/background/service-worker.js` }));
  return {
    async send(method) {
      if (method === 'Target.getTargets') return { targetInfos };
      if (method === 'Target.attachToTarget') return { sessionId: 's1' };
      if (method === 'Runtime.evaluate') return { result: { value: name } };
      return {};
    },
  };
}

test('findExtensionId requires a matching manifest name for a sole unknown candidate', async () => {
  const id = 'a'.repeat(32);
  assert.equal(await findExtensionId(fakeCdp('ats-fill', [id]), {}), id);
  await assert.rejects(findExtensionId(fakeCdp('Other Extension', [id]), {}), /Could not identify/);
  await assert.rejects(findExtensionId(fakeCdp('ats-fill', []), {}), /Could not identify/);
  assert.equal(await findExtensionId(fakeCdp('x', [STORE_EXTENSION_ID]), {}), STORE_EXTENSION_ID);
  assert.equal(await findExtensionId(fakeCdp('x', [id]), { ATS_FILL_EXTENSION_ID: 'b'.repeat(32) }), 'b'.repeat(32));
});
