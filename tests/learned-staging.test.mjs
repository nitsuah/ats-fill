import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let storageState = {};

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (typeof keys === 'string') return { [keys]: storageState[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, storageState[k]]));
        return { ...storageState };
      },
      async set(values) {
        Object.assign(storageState, values);
      },
    },
  },
};

const {
  handleSaveLearnedDefaults,
  handleApprovePendingLearnedDefault,
  handleDiscardPendingLearnedDefault,
} = await import('../background/modules/handlers/learned.js');

const GOOD_Q = 'Favorite text editor';
const GOOD_A = 'Vim';
const BAD_Q = 'First name';

beforeEach(() => {
  storageState = {};
});

test('saving an eligible entry stages it as pending and does not store it', async () => {
  const res = await handleSaveLearnedDefaults({ entries: { [GOOD_Q]: GOOD_A } });
  assert.deepEqual(res, { success: true, saved: 0, pending: 1 });
  assert.deepEqual(storageState.pendingLearnedDefaults, { [GOOD_Q]: GOOD_A });
  assert.ok(!storageState.learnedDefaults || Object.keys(storageState.learnedDefaults).length === 0);
});

test('an ineligible entry is not staged', async () => {
  const res = await handleSaveLearnedDefaults({ entries: { [BAD_Q]: 'Bob' } });
  assert.equal(res.pending, 0);
  assert.deepEqual(storageState.pendingLearnedDefaults, {});
});

test('an answer equal to the stored one clears the pending suggestion and stages nothing', async () => {
  storageState.learnedDefaults = { [GOOD_Q]: GOOD_A };
  storageState.pendingLearnedDefaults = { [GOOD_Q]: 'Nano' };
  const res = await handleSaveLearnedDefaults({ entries: { [GOOD_Q]: GOOD_A } });
  assert.equal(res.pending, 0);
  assert.deepEqual(storageState.pendingLearnedDefaults, {});
});

test('an ignored prompt is never staged', async () => {
  storageState.ignoredLearnedDefaults = {
    'favorite text editor': { question: GOOD_Q, answer: GOOD_A, ignored_at: '2026-01-01T00:00:00.000Z' },
  };
  const res = await handleSaveLearnedDefaults({ entries: { [GOOD_Q]: 'Helix' } });
  assert.equal(res.pending, 0);
});

test('only the newest 25 pending entries are kept', async () => {
  const entries = {};
  for (let i = 0; i < 30; i++) entries[`Favorite thing number ${i}`] = `answer ${i}`;
  const res = await handleSaveLearnedDefaults({ entries });
  assert.equal(res.pending, 25);
  const keys = Object.keys(storageState.pendingLearnedDefaults);
  assert.equal(keys[0], 'Favorite thing number 5');
  assert.equal(keys.at(-1), 'Favorite thing number 29');
});

test('missing or non-object entries stage nothing without throwing', async () => {
  assert.equal((await handleSaveLearnedDefaults()).pending, 0);
  assert.equal((await handleSaveLearnedDefaults({ entries: 'nope' })).pending, 0);
  assert.equal((await handleSaveLearnedDefaults({ entries: null })).pending, 0);
});

test('approving a pending question stores it and removes it from pending', async () => {
  storageState.pendingLearnedDefaults = { [GOOD_Q]: GOOD_A };
  assert.deepEqual(await handleApprovePendingLearnedDefault({ question: GOOD_Q }), { success: true });
  assert.deepEqual(storageState.learnedDefaults, { [GOOD_Q]: GOOD_A });
  assert.deepEqual(storageState.pendingLearnedDefaults, {});
});

test('approving with an edited answer stores the edited text', async () => {
  storageState.pendingLearnedDefaults = { [GOOD_Q]: GOOD_A };
  await handleApprovePendingLearnedDefault({ question: GOOD_Q, answer: '  TypeScript ' });
  assert.deepEqual(storageState.learnedDefaults, { [GOOD_Q]: 'TypeScript' });
});

test('approving a question that is not pending rejects', async () => {
  await assert.rejects(
    () => handleApprovePendingLearnedDefault({ question: GOOD_Q }),
    /That suggestion is no longer pending\./
  );
});

test('discarding removes only that pending entry and never touches learned defaults', async () => {
  storageState.learnedDefaults = { 'Favorite pet': 'Dog' };
  storageState.pendingLearnedDefaults = { [GOOD_Q]: GOOD_A, 'Favorite shell': 'zsh' };
  assert.deepEqual(await handleDiscardPendingLearnedDefault({ question: GOOD_Q }), { success: true });
  assert.deepEqual(storageState.pendingLearnedDefaults, { 'Favorite shell': 'zsh' });
  assert.deepEqual(storageState.learnedDefaults, { 'Favorite pet': 'Dog' });
  assert.deepEqual(await handleDiscardPendingLearnedDefault({ question: 'Unknown question' }), { success: true });
});
