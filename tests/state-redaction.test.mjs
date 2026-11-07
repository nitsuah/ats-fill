import test from 'node:test';
import assert from 'node:assert/strict';

// Stored credentials: every field name the settings form writes that holds a
// key, app key, OAuth client secret or token. Values are obviously fake.
const CREDENTIALS = {
  gemini_api_key: 'test-gemini-key-0001',
  adzuna_app_key: 'test-adzuna-key-0002',
  usajobs_api_key: 'test-usajobs-key-0003',
  reed_api_key: 'test-reed-key-0004',
  jooble_api_key: 'test-jooble-key-0005',
  linkedin_client_secret: 'test-linkedin-secret-0006',
  google_client_secret: 'test-google-secret-0007',
  custom_token: 'test-custom-token-0008',
};
const PLAIN_SETTINGS = {
  gemini_model: 'gemini-2.5-flash',
  linkedin_client_id: 'test-linkedin-client-id',
  work_authorization: 'US Citizen',
  privacy_consent: true,
};
const EXT_ID = 'test-extension-id';

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

function seedSettings() {
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

function assertNoCredentials(state) {
  for (const name of Object.keys(CREDENTIALS)) {
    assert.ok(!(name in state.settings), `${name} must not be present in the settings copy`);
  }
  const serialized = JSON.stringify(state);
  for (const value of Object.values(CREDENTIALS)) {
    assert.ok(!serialized.includes(value), 'no stored credential value may appear in the state copy');
  }
  assert.ok(!('apiKey' in state), 'the raw apiKey property must be dropped');
}

test('background state helper still reads stored credentials', async () => {
  seedSettings();
  const state = await getState();
  assert.equal(state.settings.gemini_api_key, CREDENTIALS.gemini_api_key);
  assert.equal(state.settings.linkedin_client_secret, CREDENTIALS.linkedin_client_secret);
  assert.equal(state.apiKey, CREDENTIALS.gemini_api_key);
  assert.equal(state.hasApiKey, true);
});

test('GET_STATE sent by a content script has no credential-named fields', async () => {
  seedSettings();
  const state = await send(
    { type: 'GET_STATE' },
    { id: EXT_ID, url: 'https://jobs.example.com/apply', tab: { id: 7 }, frameId: 3 }
  );
  assertNoCredentials(state);
  assert.equal(state.hasApiKey, true, 'the boolean signal that a key is configured is kept');
  assert.equal(state.settings.gemini_model, PLAIN_SETTINGS.gemini_model);
  assert.equal(state.settings.work_authorization, PLAIN_SETTINGS.work_authorization);
  assert.equal(state.profile.full_name, 'Ada Lovelace');
});

test('GET_STATE from a sender without a page URL is still redacted when it carries a tab', async () => {
  seedSettings();
  const state = await send({ type: 'GET_STATE' }, { id: EXT_ID, tab: { id: 9 } });
  assertNoCredentials(state);
});

test('GET_STATE from the extension popup keeps the settings values the form edits', async () => {
  seedSettings();
  const state = await send(
    { type: 'GET_STATE' },
    { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup/popup.html` }
  );
  assert.equal(state.apiKey, CREDENTIALS.gemini_api_key);
  assert.equal(state.settings.gemini_api_key, CREDENTIALS.gemini_api_key);
  assert.equal(state.settings.linkedin_client_secret, CREDENTIALS.linkedin_client_secret);
});
