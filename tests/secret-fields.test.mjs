/**
 * tests/secret-fields.test.mjs — save rules for the async-loaded OAuth secret inputs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { secretValueToSave, trackSecretLoad, whenSecretsLoaded } from '../popup/ux/secret-fields.js';

const enc = async (v) => ({ enc: v });
const field = (value, loaded) => ({ value, dataset: { loaded } });

test('secret-fields: a filled field is encrypted', async () => {
  assert.deepEqual(await secretValueToSave(field(' s3cret ', 'true'), enc), { enc: 's3cret' });
  assert.deepEqual(await secretValueToSave(field('typed', 'false'), enc), { enc: 'typed' });
});

test('secret-fields: a cleared loaded field saves "" (deliberate clear)', async () => {
  assert.equal(await secretValueToSave(field('', 'true'), enc), '');
});

test('secret-fields: an empty field that never loaded is left out', async () => {
  assert.equal(await secretValueToSave(field('', 'false'), enc), undefined);
});

test('secret-fields: whenSecretsLoaded waits for the tracked load and never rejects', async () => {
  let release;
  const order = [];
  trackSecretLoad(new Promise((r) => { release = r; }).then(() => order.push('loaded')));
  const waiting = whenSecretsLoaded().then(() => order.push('save'));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(order, []);
  release();
  await waiting;
  assert.deepEqual(order, ['loaded', 'save']);

  trackSecretLoad(Promise.reject(new Error('IndexedDB unavailable')));
  await whenSecretsLoaded(); // resolves
});
