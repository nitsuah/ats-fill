import test from 'node:test';
import assert from 'node:assert/strict';

import { applyProfileOverrides, getProfileFromResume } from '../background/modules/helpers.js';
import { shouldPersistLearnedValue } from '../lib/form-filler.js';
import { matchesExpectedFillDocument } from '../content/fill-url-guard.js';
import { findExtensionId, STORE_EXTENSION_ID } from '../scripts/tracker/cdp.mjs';

test('pronouns_sensitive follows the sensitive opt-in on and off', () => {
  const none = applyProfileOverrides({ name: 'A B' }, { pronouns_sensitive: 'they/them' }, {});
  assert.equal(getProfileFromResume(none, {}).pronouns || '', '');

  const on = applyProfileOverrides({ name: 'A B' }, { pronouns_sensitive: 'they/them', sensitive_optin: true }, {});
  assert.equal(on.pronouns || '', '', 'the sensitive value is not copied into stored pronouns');
  assert.equal(getProfileFromResume(on, {}).pronouns, 'they/them');

  const off = applyProfileOverrides(on, { sensitive_optin: false }, {});
  assert.equal(getProfileFromResume(off, {}).pronouns || '', '');

  const ordinary = applyProfileOverrides({ name: 'A B' }, { pronouns: 'she/her', pronouns_sensitive: 'they/them', sensitive_optin: true }, {});
  assert.equal(getProfileFromResume(ordinary, {}).pronouns, 'she/her');
  const ordinaryOff = applyProfileOverrides(ordinary, { sensitive_optin: false }, {});
  assert.equal(getProfileFromResume(ordinaryOff, {}).pronouns, 'she/her');
});

test('self-identification answers are not kept as learned values', () => {
  for (const label of ['Gender', 'What is your race / ethnicity?', 'Veteran Status', 'Disability Status', 'Are you Hispanic or Latino?', 'Preferred pronouns', 'Military spouse?', 'Have you served in the military?', 'Military status']) {
    assert.equal(shouldPersistLearnedValue(label, 'Some answer'), false, label);
  }
  assert.equal(shouldPersistLearnedValue('Preferred framework', 'TypeScript'), true);
  assert.equal(shouldPersistLearnedValue('Preferred military branch for clearance', 'Navy'), true);
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

function fakeCdp(namesById) {
  const ids = Object.keys(namesById);
  const targetInfos = ids.map((id) => ({ type: 'service_worker', targetId: id, url: `chrome-extension://${id}/background/service-worker.js` }));
  const sessions = new Map();
  return {
    async send(method, params) {
      if (method === 'Target.getTargets') return { targetInfos };
      if (method === 'Target.attachToTarget') { sessions.set(`s-${params.targetId}`, params.targetId); return { sessionId: `s-${params.targetId}` }; }
      if (method === 'Runtime.evaluate') return { result: { value: namesById[sessions.get(arguments[2])] } };
      return {};
    },
  };
}

test('findExtensionId accepts exactly one manifest-name match', async () => {
  const a = 'a'.repeat(32);
  const b = 'b'.repeat(32);
  assert.equal(await findExtensionId(fakeCdp({ [a]: 'ats-fill', [b]: 'Other' }), {}), a, '1 match');
  await assert.rejects(findExtensionId(fakeCdp({ [a]: 'Other', [b]: 'Another' }), {}), /Could not identify/, '0 matches');
  await assert.rejects(findExtensionId(fakeCdp({ [a]: 'ats-fill', [b]: 'ats-fill' }), {}), /Could not identify/, '2 matches');
  await assert.rejects(findExtensionId(fakeCdp({}), {}), /Could not identify/);
  assert.equal(await findExtensionId(fakeCdp({ [STORE_EXTENSION_ID]: 'x' }), {}), STORE_EXTENSION_ID);
  assert.equal(await findExtensionId(fakeCdp({ [a]: 'x' }), { ATS_FILL_EXTENSION_ID: b }), b);
});
