/**
 * Characterization tests for the background service worker's message router
 * and storage-backed state sync, written BEFORE extracting that logic out of
 * background/service-worker.js. These pin down current behavior (including a
 * couple of pre-existing bugs) so the extraction into background/message-router.js
 * and background/modules/handlers/*.js can be verified as behavior-preserving.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const EXT_ID = 'test-extension-id';

let storageState = {};

function resetStorage(seed = {}) {
  storageState = structuredClone(seed);
}

const storageLocal = {
  async get(keys) {
    if (typeof keys === 'string') return { [keys]: storageState[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, storageState[k]]));
    return { ...storageState };
  },
  async set(values) {
    Object.assign(storageState, values);
  },
  async remove(keys) {
    for (const k of Array.isArray(keys) ? keys : [keys]) delete storageState[k];
  },
  async clear() {
    storageState = {};
  },
};

let messageListener;

globalThis.chrome = {
  runtime: {
    id: EXT_ID,
    onMessage: {
      addListener(fn) {
        messageListener = fn;
      },
    },
    getURL: (path) => `chrome-extension://${EXT_ID}/${path}`,
  },
  tabs: {
    query: async () => [],
  },
  storage: { local: storageLocal },
  identity: {
    launchWebAuthFlow: async () => {
      throw new Error('launchWebAuthFlow should not be reached in these tests');
    },
  },
};

// Importing the service worker registers its onMessage listener as a
// top-level side effect, exactly as Chrome would load it.
await import('../background/service-worker.js');

test('service worker registers a message listener on import', () => {
  assert.equal(typeof messageListener, 'function');
});

/** Sends a message through the captured listener like Chrome would. */
function send(msg, sender = { id: EXT_ID }) {
  return new Promise((resolve) => {
    messageListener(msg, sender, resolve);
  });
}

test.beforeEach(() => resetStorage());

// ── Message routing ───────────────────────────────────────────────────────

test('rejects messages from a sender that is not this extension', async () => {
  let responded;
  const keepOpen = messageListener({ type: 'GET_STATE' }, { id: 'some-other-extension' }, (r) => {
    responded = r;
  });
  assert.equal(keepOpen, false);
  assert.deepEqual(responded, { success: false, error: 'Unauthorized message sender.' });
});

test('rejects malformed messages (missing/invalid type)', async () => {
  let responded;
  const keepOpen = messageListener({ foo: 'bar' }, { id: EXT_ID }, (r) => {
    responded = r;
  });
  assert.equal(keepOpen, false);
  assert.deepEqual(responded, { success: false, error: 'Invalid message.' });
});

test('unknown message types resolve to an error, not a throw', async () => {
  const result = await send({ type: 'NOT_A_REAL_MESSAGE' });
  assert.equal(result.success, false);
  assert.match(result.error, /Unknown message type/);
});

test('ATS_DETECTED is acknowledged with no side effects', async () => {
  const result = await send({ type: 'ATS_DETECTED' });
  assert.deepEqual(result, { success: true });
});

// ── State sync ────────────────────────────────────────────────────────────

test('GET_STATE returns defaults against empty storage', async () => {
  const state = await send({ type: 'GET_STATE' });
  assert.equal(state.hasApiKey, false);
  assert.equal(state.hasResume, false);
  assert.equal(state.resumeAttachment, null);
  assert.deepEqual(state.applications, []);
  assert.equal(state.lastAnswers, null);
  assert.equal(state.lastTrackedApplicationId, null);
  assert.equal(state.currentAts, null);
  assert.deepEqual(state.profileCompleteness, { completed: 0, total: 8 });
});

test('GET_STATE reflects resume/settings/applications written to storage', async () => {
  resetStorage({
    settings: { gemini_api_key: 'key-123', work_authorization: 'US Citizen' },
    resume: { structured: { name: 'Ada Lovelace', email: 'ada@example.com' } },
    applications: [{ id: 'a1', status: 'applied' }],
  });
  const state = await send({ type: 'GET_STATE' });
  assert.equal(state.hasApiKey, true);
  assert.equal(state.hasResume, true);
  assert.equal(state.profile.full_name, 'Ada Lovelace');
  assert.equal(state.profile.email, 'ada@example.com');
  assert.equal(state.applications.length, 1);
});

test('SAVE_SETTINGS_ONLY merges into existing settings and preserves privacy_consent', async () => {
  resetStorage({ settings: { privacy_consent: true, privacy_consent_at: '2026-01-01T00:00:00.000Z' } });
  const result = await send({ type: 'SAVE_SETTINGS_ONLY', payload: { settings: { gemini_api_key: 'new-key' } } });
  assert.deepEqual(result, { success: true });
  const saved = (await storageLocal.get('settings')).settings;
  assert.equal(saved.gemini_api_key, 'new-key');
  assert.equal(saved.privacy_consent, true);
  assert.equal(saved.privacy_consent_at, '2026-01-01T00:00:00.000Z');
});

// ── Resume attachment ─────────────────────────────────────────────────────

test('GET_RESUME_ATTACHMENT errors when nothing has been saved yet', async () => {
  const result = await send({ type: 'GET_RESUME_ATTACHMENT' });
  assert.equal(result.success, false);
  assert.match(result.error, /No saved resume attachment/);
});

test('GET_RESUME_ATTACHMENT builds a preview attachment from a stored excerpt', async () => {
  resetStorage({ resume: { excerpt: 'Candidate summary text.' } });
  const result = await send({ type: 'GET_RESUME_ATTACHMENT' });
  assert.equal(result.success, true);
  assert.equal(result.attachment.name, 'resume-preview.txt');
  assert.equal(result.attachment.downloadMode, 'text');
  assert.equal(result.attachment.preview, 'Candidate summary text.');
});

test('REMOVE_RESUME_ATTACHMENT clears the excerpt/attachment but keeps structured data', async () => {
  resetStorage({ resume: { excerpt: 'x', attachment: { name: 'r.txt' }, structured: { name: 'Ada' } } });
  const result = await send({ type: 'REMOVE_RESUME_ATTACHMENT' });
  assert.deepEqual(result, { success: true });
  const resume = (await storageLocal.get('resume')).resume;
  assert.equal(resume.excerpt, null);
  assert.equal(resume.attachment, null);
  assert.equal(resume.attachmentRemoved, true);
  assert.equal(resume.structured.name, 'Ada');
});

// ── Answers ────────────────────────────────────────────────────────────────

test('GENERATE_ANSWERS errors when no profile has been set up', async () => {
  const result = await send({ type: 'GENERATE_ANSWERS', payload: {} });
  assert.equal(result.success, false);
  assert.match(result.error, /Profile not set up yet/);
});

test('GENERATE_ANSWERS fills deterministic answers without AI when no API key is configured', async () => {
  resetStorage({
    resume: { structured: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-1234' } },
    settings: {},
  });
  const result = await send({ type: 'GENERATE_ANSWERS', payload: { jd: 'Some JD text' } });
  assert.equal(result.success, true);
  assert.equal(result.usedAi, false);
  assert.equal(result.warning, null);
  assert.equal(result.answers.full_name, 'Ada Lovelace');
  assert.equal(result.answers.email, 'ada@example.com');
  const persisted = (await storageLocal.get('lastAnswers')).lastAnswers;
  assert.equal(persisted.email, 'ada@example.com');
});

test('GENERATE_ANSWERS: a custom question matching the work-authorization pattern ' +
  'hits the pre-existing undefined `wantsBinaryAnswer` reference (known bug, preserved as-is)', async () => {
  resetStorage({
    resume: { structured: { name: 'Ada Lovelace' } },
    settings: {},
  });
  const result = await send({
    type: 'GENERATE_ANSWERS',
    payload: { customQuestions: ['Are you legally authorized to work in the US?'] },
  });
  assert.equal(result.success, false);
  assert.match(result.error, /wantsBinaryAnswer is not defined/);
});

test('GET_LAST_ANSWERS returns null defaults, then the persisted answers', async () => {
  const empty = await send({ type: 'GET_LAST_ANSWERS' });
  assert.deepEqual(empty, { answers: null, report: null });

  resetStorage({ lastAnswers: { email: 'ada@example.com' }, lastFillReport: { filled: 3 } });
  const result = await send({ type: 'GET_LAST_ANSWERS' });
  assert.deepEqual(result, { answers: { email: 'ada@example.com' }, report: { filled: 3 } });
});

test('SUMMARIZE_JD requires a Gemini API key', async () => {
  const result = await send({ type: 'SUMMARIZE_JD', payload: { text: 'a job' } });
  assert.equal(result.success, false);
  assert.match(result.error, /Add a Gemini API key/);
});

// ── Jobs ─────────────────────────────────────────────────────────────────

test('GET_JOB_SOURCES lists sources without requiring network access', async () => {
  const result = await send({ type: 'GET_JOB_SOURCES' });
  assert.equal(result.success, true);
  assert.ok(Array.isArray(result.sources));
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.every((s) => typeof s.id === 'string'));
});

// ── OAuth ──────────────────────────────────────────────────────────────────

test('GET_OAUTH_INFO reports configuration state', async () => {
  resetStorage({ settings: { linkedin_client_id: 'a', linkedin_client_secret: 'b' } });
  const result = await send({ type: 'GET_OAUTH_INFO' });
  assert.equal(result.success, true);
  assert.equal(result.linkedinConfigured, true);
  assert.equal(result.googleConfigured, false);
});

test('LINKEDIN_CONNECT errors without a configured client id/secret', async () => {
  const result = await send({ type: 'LINKEDIN_CONNECT' });
  assert.equal(result.success, false);
  assert.match(result.error, /LinkedIn app Client ID/);
});

test('GOOGLE_CONNECT errors without a configured client id/secret', async () => {
  const result = await send({ type: 'GOOGLE_CONNECT' });
  assert.equal(result.success, false);
  assert.match(result.error, /Google OAuth Client ID/);
});

// ── Tracker ──────────────────────────────────────────────────────────────

test('LOG_APPLICATION persists an entry and records it as the last tracked application', async () => {
  resetStorage({ applications: [] });
  const result = await send({
    type: 'LOG_APPLICATION',
    payload: { company: 'Acme', title: 'Engineer', url: 'https://example.com/job/1', status: 'applied' },
  });
  assert.equal(result.success, true);
  assert.equal(result.entry.company, 'Acme');
  assert.equal((await storageLocal.get('lastTrackedApplicationId')).lastTrackedApplicationId, result.entry.id);
});

test('PARSE_APPLICATION_DRAFT derives tracker details from free text', async () => {
  const result = await send({ type: 'PARSE_APPLICATION_DRAFT', payload: { text: 'Applied to Acme for Engineer', draft: {} } });
  assert.equal(result.success, true);
  assert.ok(result.details);
});

test('IMPORT_APPLICATIONS_CSV errors on empty input', async () => {
  const result = await send({ type: 'IMPORT_APPLICATIONS_CSV', payload: { text: '' } });
  assert.equal(result.success, false);
  assert.match(result.error, /Choose a CSV file/);
});

test('UPDATE_APPLICATION clears the last fill report once the tracked application reaches a terminal status', async () => {
  resetStorage({
    applications: [{ id: 'a1', status: 'applied', sort_order: 0 }],
    lastTrackedApplicationId: 'a1',
    lastFillReport: { filled: 1 },
  });
  const result = await send({ type: 'UPDATE_APPLICATION', payload: { id: 'a1', patch: { status: 'rejected' } } });
  assert.equal(result.success, true);
  assert.equal((await storageLocal.get('lastFillReport')).lastFillReport, null);
  assert.equal((await storageLocal.get('lastTrackedApplicationId')).lastTrackedApplicationId, null);
});

test('DELETE_APPLICATION removes an entry and errors for an unknown id', async () => {
  resetStorage({ applications: [{ id: 'a1', status: 'applied', sort_order: 0 }] });
  const ok = await send({ type: 'DELETE_APPLICATION', payload: { id: 'a1' } });
  assert.equal(ok.success, true);

  const missing = await send({ type: 'DELETE_APPLICATION', payload: { id: 'does-not-exist' } });
  assert.equal(missing.success, false);
});

test('REORDER_APPLICATIONS updates sort order for the given entries', async () => {
  resetStorage({ applications: [
    { id: 'a1', status: 'applied', sort_order: 0 },
    { id: 'a2', status: 'applied', sort_order: 1 },
  ] });
  const result = await send({
    type: 'REORDER_APPLICATIONS',
    payload: { updates: [{ id: 'a1', status: 'applied', sort_order: 1 }, { id: 'a2', status: 'applied', sort_order: 0 }] },
  });
  assert.equal(result.success, true);
  assert.equal(result.updated, 2);
});

test('MARK_LAST_SUBMITTED errors when there is no recent autofill session', async () => {
  const result = await send({ type: 'MARK_LAST_SUBMITTED' });
  assert.equal(result.success, false);
  assert.match(result.error, /No recent autofill session/);
});

// ── Learned defaults ───────────────────────────────────────────────────────

test('SAVE_LEARNED_DEFAULTS then GET_LEARNED_DEFAULTS round-trips an entry', async () => {
  const saveResult = await send({
    type: 'SAVE_LEARNED_DEFAULTS',
    payload: { entries: { 'What is your favorite color?': 'Blue' } },
  });
  assert.equal(saveResult.success, true);
  assert.equal(saveResult.saved, 1);

  const getResult = await send({ type: 'GET_LEARNED_DEFAULTS' });
  assert.equal(getResult.success, true);
  assert.deepEqual(getResult.items, [{ question: 'What is your favorite color?', answer: 'Blue' }]);
});

test('UPDATE_LEARNED_DEFAULT rejects a value that is not eligible for storage', async () => {
  const result = await send({ type: 'UPDATE_LEARNED_DEFAULT', payload: { question: '', answer: '' } });
  assert.equal(result.success, false);
});

test('IGNORE_LEARNED_DEFAULT moves an entry into the ignored list', async () => {
  resetStorage({ learnedDefaults: { 'What is your favorite color?': 'Blue' } });
  const result = await send({ type: 'IGNORE_LEARNED_DEFAULT', payload: { question: 'What is your favorite color?' } });
  assert.equal(result.success, true);
  const data = await storageLocal.get(['learnedDefaults', 'ignoredLearnedDefaults']);
  assert.deepEqual(data.learnedDefaults, {});
  assert.equal(Object.keys(data.ignoredLearnedDefaults).length, 1);
});

test('DELETE_LEARNED_DEFAULT removes an entry outright', async () => {
  resetStorage({ learnedDefaults: { 'What is your favorite color?': 'Blue' } });
  const result = await send({ type: 'DELETE_LEARNED_DEFAULT', payload: { question: 'What is your favorite color?' } });
  assert.equal(result.success, true);
  assert.deepEqual((await storageLocal.get('learnedDefaults')).learnedDefaults, {});
});

test('DELETE_IGNORED_LEARNED_DEFAULT restores an ignored entry back to learned defaults', async () => {
  resetStorage({
    ignoredLearnedDefaults: {
      'what-is-your-favorite-color': { question: 'What is your favorite color?', answer: 'Blue', ignored_at: '2026-01-01T00:00:00.000Z' },
    },
  });
  const result = await send({ type: 'DELETE_IGNORED_LEARNED_DEFAULT', payload: { question: 'What is your favorite color?' } });
  assert.equal(result.success, true);
  const data = await storageLocal.get(['learnedDefaults', 'ignoredLearnedDefaults']);
  assert.equal(data.learnedDefaults['What is your favorite color?'], 'Blue');
  assert.deepEqual(data.ignoredLearnedDefaults, {});
});

// ── Bulk data operations ────────────────────────────────────────────────────

test('CLEAR_TEMP_DATA removes only the transient keys', async () => {
  resetStorage({
    applicationDrafts: { x: 1 },
    lastAnswers: { a: 1 },
    lastFillReport: { b: 1 },
    lastTrackedApplicationId: 'a1',
    settings: { gemini_api_key: 'keep-me' },
  });
  const result = await send({ type: 'CLEAR_TEMP_DATA' });
  assert.deepEqual(result, { success: true });
  const remaining = await storageLocal.get(null);
  assert.equal(remaining.applicationDrafts, undefined);
  assert.equal(remaining.lastAnswers, undefined);
  assert.equal(remaining.settings.gemini_api_key, 'keep-me');
});

test('RESET_ALL_DATA wipes all storage', async () => {
  resetStorage({ settings: { gemini_api_key: 'x' }, applications: [{ id: 'a1' }] });
  const result = await send({ type: 'RESET_ALL_DATA' });
  assert.deepEqual(result, { success: true });
  assert.deepEqual(storageState, {});
});

test('GET_FIELD_MAP fetches the packaged field map JSON via chrome.runtime.getURL', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ example_field: 'input[name=example]' }) };
  };
  try {
    const result = await send({ type: 'GET_FIELD_MAP' });
    assert.equal(requestedUrl, `chrome-extension://${EXT_ID}/data/field-map.json`);
    assert.deepEqual(result, { example_field: 'input[name=example]' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Interview prep ─────────────────────────────────────────────────────────

test('GET_INTERVIEW_PREP defaults to an empty questions list', async () => {
  const result = await send({ type: 'GET_INTERVIEW_PREP', payload: { applicationId: 'a1' } });
  assert.deepEqual(result, { success: true, data: { questions: [] } });
});

test('SAVE_INTERVIEW_PREP then GET_INTERVIEW_PREP round-trips questions', async () => {
  const save = await send({
    type: 'SAVE_INTERVIEW_PREP',
    payload: { applicationId: 'a1', questions: [{ question: 'Tell me about yourself', type: 'general' }] },
  });
  assert.deepEqual(save, { success: true });

  const get = await send({ type: 'GET_INTERVIEW_PREP', payload: { applicationId: 'a1' } });
  assert.equal(get.success, true);
  assert.equal(get.data.questions.length, 1);
});

test('GENERATE_INTERVIEW_QUESTIONS requires a configured Gemini API key', async () => {
  const result = await send({ type: 'GENERATE_INTERVIEW_QUESTIONS', payload: { job: { title: 'Engineer' } } });
  assert.equal(result.success, false);
  assert.match(result.error, /Gemini API key not configured/);
});

test('GENERATE_INTERVIEW_QUESTIONS: with an API key configured, hits the pre-existing undefined ' +
  '`callGeminiWithRetry` reference (known bug, preserved as-is)', async () => {
  resetStorage({ settings: { gemini_api_key: 'key-123' } });
  const result = await send({ type: 'GENERATE_INTERVIEW_QUESTIONS', payload: { job: { title: 'Engineer' } } });
  assert.equal(result.success, false);
  assert.match(result.error, /callGeminiWithRetry is not defined/);
});

test('GENERATE_INTERVIEW_ANSWER requires a configured Gemini API key', async () => {
  const result = await send({ type: 'GENERATE_INTERVIEW_ANSWER', payload: { question: 'Why this role?' } });
  assert.equal(result.success, false);
  assert.match(result.error, /Gemini API key not configured/);
});

test('GENERATE_INTERVIEW_ANSWER: with an API key configured, hits the same pre-existing ' +
  '`callGeminiWithRetry` reference bug', async () => {
  resetStorage({ settings: { gemini_api_key: 'key-123' } });
  const result = await send({ type: 'GENERATE_INTERVIEW_ANSWER', payload: { question: 'Why this role?' } });
  assert.equal(result.success, false);
  assert.match(result.error, /callGeminiWithRetry is not defined/);
});
