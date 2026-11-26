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
  handleGetLearnedDefaults,
  handleUpdateLearnedDefault,
  handleIgnoreLearnedDefault,
  handleDeleteLearnedDefault,
  handleDeleteIgnoredLearnedDefault,
} = await import('../background/modules/handlers/learned.js');

const GOOD_Q = 'Favorite text editor';
const GOOD_A = 'Vim';
const KEY = 'favorite text editor';

beforeEach(() => {
  storageState = {};
});

test('update stores the trimmed answer under the trimmed question', async () => {
  const res = await handleUpdateLearnedDefault({ question: `  ${GOOD_Q}  `, answer: `  ${GOOD_A} ` });
  assert.deepEqual(res, { success: true });
  assert.deepEqual(storageState.learnedDefaults, { [GOOD_Q]: GOOD_A });
});

test('update rejects an ineligible pair', async () => {
  await assert.rejects(
    () => handleUpdateLearnedDefault({ question: 'First name', answer: 'Bob' }),
    /That remembered answer is not eligible to be stored\./
  );
});

test('update rejects a question that is on the ignored list', async () => {
  storageState.ignoredLearnedDefaults = { [KEY]: { question: GOOD_Q, answer: GOOD_A, ignored_at: null } };
  await assert.rejects(
    () => handleUpdateLearnedDefault({ question: GOOD_Q, answer: 'Emacs' }),
    /currently ignored/
  );
});

test('ignore moves a stored entry into the ignored map', async () => {
  storageState.learnedDefaults = { [GOOD_Q]: GOOD_A };
  const res = await handleIgnoreLearnedDefault({ question: GOOD_Q });
  assert.deepEqual(res, { success: true });
  assert.deepEqual(storageState.learnedDefaults, {});
  const record = storageState.ignoredLearnedDefaults[KEY];
  assert.equal(record.question, GOOD_Q);
  assert.equal(record.answer, GOOD_A);
  assert.equal(new Date(record.ignored_at).toISOString(), record.ignored_at);
});

test('ignore validates its input', async () => {
  await assert.rejects(() => handleIgnoreLearnedDefault({ question: '' }), /Memory question is required\./);
  await assert.rejects(
    () => handleIgnoreLearnedDefault({ question: 'Unknown question' }),
    /Could not find that memory entry to ignore\./
  );
});

test('delete removes only the named key and tolerates a missing key', async () => {
  storageState.learnedDefaults = { [GOOD_Q]: GOOD_A, 'Favorite pet': 'Dog' };
  await handleDeleteLearnedDefault({ question: GOOD_Q });
  assert.deepEqual(storageState.learnedDefaults, { 'Favorite pet': 'Dog' });
  assert.deepEqual(await handleDeleteLearnedDefault({ question: 'Not there' }), { success: true });
  assert.deepEqual(storageState.learnedDefaults, { 'Favorite pet': 'Dog' });
});

test('deleting an ignore record restores the archived answer', async () => {
  storageState.ignoredLearnedDefaults = {
    [KEY]: { question: GOOD_Q, answer: GOOD_A, ignored_at: '2026-01-01T00:00:00.000Z' },
  };
  const res = await handleDeleteIgnoredLearnedDefault({ question: GOOD_Q });
  assert.deepEqual(res, { success: true });
  assert.deepEqual(storageState.ignoredLearnedDefaults, {});
  assert.deepEqual(storageState.learnedDefaults, { [GOOD_Q]: GOOD_A });
});

test('deleting an ignore record with an empty question writes nothing', async () => {
  assert.deepEqual(await handleDeleteIgnoredLearnedDefault({ question: '' }), { success: true });
  assert.deepEqual(storageState, {});
});

test('get returns items, pending and ignored shaped as arrays and writes sanitised maps back', async () => {
  storageState.learnedDefaults = { [GOOD_Q]: GOOD_A, 'First name': 'Bob' };
  storageState.pendingLearnedDefaults = { 'Favorite pet': 'Dog' };
  storageState.ignoredLearnedDefaults = {
    'favorite color': { question: 'Favorite color', answer: 'Blue', ignored_at: '2026-01-01T00:00:00.000Z' },
  };
  const res = await handleGetLearnedDefaults();
  assert.equal(res.success, true);
  assert.deepEqual(res.items, [{ question: GOOD_Q, answer: GOOD_A }]);
  assert.deepEqual(res.pendingItems, [{ question: 'Favorite pet', answer: 'Dog' }]);
  assert.deepEqual(res.ignoredItems, [
    { question: 'Favorite color', answer: 'Blue', ignored_at: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.deepEqual(storageState.learnedDefaults, { [GOOD_Q]: GOOD_A });
  assert.deepEqual(Object.keys(storageState.ignoredLearnedDefaults), ['favorite color']);
});
