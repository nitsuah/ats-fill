import test from 'node:test';
import assert from 'node:assert/strict';

// Stored credentials and settings, using obviously fake values.
const CREDENTIALS = {
  gemini_api_key: 'test-gemini-key-0001',
  linkedin_client_secret: 'test-linkedin-secret-0002',
};
const PLAIN_SETTINGS = {
  gemini_model: 'gemini-2.5-flash',
  work_authorization: 'US Citizen',
  privacy_consent: true,
};
const EXT_ID = 'test-extension-id';
const POPUP = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup/popup.html`, origin: `chrome-extension://${EXT_ID}` };
const CONTENT = { id: EXT_ID, url: 'https://jobs.example.com/apply', origin: 'https://jobs.example.com', tab: { id: 7 }, frameId: 0 };
const ONLY_EXTENSION_PAGES = /only accepted from extension pages/;

let storageState = {};

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

// Importing the service worker registers the message listener, as Chrome does.
const { getState } = await import('../background/modules/handlers/state.js');
await import('../background/service-worker.js');

function seed() {
  storageState = {
    settings: { ...CREDENTIALS, ...PLAIN_SETTINGS },
    resume: { structured: { name: 'Ada Lovelace', email: 'ada@example.com' } },
  };
}

function send(msg, sender) {
  return new Promise((resolve) => {
    messageListener(msg, sender, resolve);
  });
}

test('background state helper still reads stored credentials', async () => {
  seed();
  const state = await getState();
  assert.equal(state.settings.gemini_api_key, CREDENTIALS.gemini_api_key);
  assert.equal(state.hasApiKey, true);
});

test('GET_STATE from a content script is refused and returns no settings', async () => {
  seed();
  const response = await send({ type: 'GET_STATE' }, CONTENT);
  assert.equal(response.success, false);
  assert.match(response.error, ONLY_EXTENSION_PAGES);
  assert.equal(response.settings, undefined);
  assert.equal(JSON.stringify(response).includes(CREDENTIALS.gemini_api_key), false);
});

test('GET_STATE from a sender that reports no origin or URL is refused, even with a tab', async () => {
  seed();
  const response = await send({ type: 'GET_STATE' }, { id: EXT_ID, tab: { id: 9 } });
  assert.equal(response.success, false);
  assert.match(response.error, ONLY_EXTENSION_PAGES);
});

test('the reported origin decides: a web origin is refused even if a URL under the extension is reported', async () => {
  seed();
  const response = await send(
    { type: 'GET_STATE' },
    { id: EXT_ID, origin: 'https://jobs.example.com', url: POPUP.url }
  );
  assert.equal(response.success, false);
  assert.match(response.error, ONLY_EXTENSION_PAGES);
});

test('GET_STATE from the extension popup returns the settings the form edits', async () => {
  seed();
  const state = await send({ type: 'GET_STATE' }, POPUP);
  assert.equal(state.apiKey, CREDENTIALS.gemini_api_key);
  assert.equal(state.settings.gemini_api_key, CREDENTIALS.gemini_api_key);
  assert.equal(state.settings.linkedin_client_secret, CREDENTIALS.linkedin_client_secret);
});

test('SAVE_SETTINGS_ONLY from a content script is refused and the stored settings are unchanged', async () => {
  seed();
  const before = JSON.stringify(storageState.settings);
  const response = await send({ type: 'SAVE_SETTINGS_ONLY', payload: { settings: { gemini_api_key: 'test-replacement-key' } } }, CONTENT);
  assert.equal(response.success, false);
  assert.match(response.error, ONLY_EXTENSION_PAGES);
  assert.equal(JSON.stringify(storageState.settings), before);
});

test('SAVE_SETTINGS_ONLY from the popup is accepted', async () => {
  seed();
  const response = await send({ type: 'SAVE_SETTINGS_ONLY', payload: { settings: { work_authorization: 'Canadian' } } }, POPUP);
  assert.equal(response.success, true);
  assert.equal(storageState.settings.work_authorization, 'Canadian');
});

test('RESET_ALL_DATA from a content script is refused and storage is kept', async () => {
  seed();
  const response = await send({ type: 'RESET_ALL_DATA' }, CONTENT);
  assert.equal(response.success, false);
  assert.match(response.error, ONLY_EXTENSION_PAGES);
  assert.equal(storageState.settings.gemini_api_key, CREDENTIALS.gemini_api_key);
});

test('other restricted types (summary, interview, OAuth connect, setup save) are refused from a content script', async () => {
  seed();
  for (const type of ['SUMMARIZE_JD', 'GENERATE_INTERVIEW_QUESTIONS', 'GENERATE_INTERVIEW_ANSWER', 'LINKEDIN_CONNECT', 'GOOGLE_CONNECT', 'SAVE_SETUP']) {
    const response = await send({ type, payload: {} }, CONTENT);
    assert.equal(response.success, false, `${type} must be refused`);
    assert.match(response.error, ONLY_EXTENSION_PAGES, `${type} must be refused by the sender check`);
  }
});

test('messages the content script needs during fill are not refused by the sender check', async () => {
  seed();
  const fieldMap = await send({ type: 'GET_FIELD_MAP' }, CONTENT);
  assert.doesNotMatch(String(fieldMap.error || ''), ONLY_EXTENSION_PAGES);

  const answers = await send({ type: 'GENERATE_ANSWERS', payload: { jd: '', customQuestions: [] } }, CONTENT);
  assert.doesNotMatch(String(answers.error || ''), ONLY_EXTENSION_PAGES);
});
