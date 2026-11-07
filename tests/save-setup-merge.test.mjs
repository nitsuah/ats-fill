import test from 'node:test';
import assert from 'node:assert/strict';

let storage = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = typeof keys === 'string' ? [keys] : keys;
        return Object.fromEntries(list.map((k) => [k, storage[k]]));
      },
      async set(values) { Object.assign(storage, values); },
    },
  },
};

const { handleSaveSetup } = await import('../background/modules/handlers/setup.js');

const FEEDS = [{ id: 'custom-a', label: 'A', url: 'https://jobs4tn.gov/rss' }];

test('saving the profile keeps stored custom feeds and the local-network setting', async () => {
  storage = {
    settings: {
      gemini_api_key: 'k', custom_job_sources: FEEDS, allow_local_network_feeds: true,
      privacy_consent: true, privacy_consent_at: '2026-01-01T00:00:00.000Z',
    },
  };
  await handleSaveSetup({
    settings: { gemini_api_key: 'k', gemini_model: 'auto', privacy_consent: true, privacy_consent_at: '2026-01-01T00:00:00.000Z' },
    profile: { full_name: 'Pat Example' },
  });
  assert.deepEqual(storage.settings.custom_job_sources, FEEDS);
  assert.equal(storage.settings.allow_local_network_feeds, true);
  assert.equal(storage.settings.gemini_model, 'auto');
});

test('clearing a form field still clears the stored value', async () => {
  storage = {
    settings: {
      gemini_api_key: 'k', adzuna_app_id: 'old-id', reed_api_key: 'old-reed', custom_job_sources: FEEDS,
      privacy_consent: true,
    },
  };
  await handleSaveSetup({
    settings: { gemini_api_key: 'k', adzuna_app_id: '', privacy_consent: true },
    profile: { full_name: 'Pat Example' },
  });
  assert.equal(storage.settings.adzuna_app_id, '');
  assert.equal(storage.settings.reed_api_key, 'old-reed', 'a key the form does not carry is kept');
  assert.deepEqual(storage.settings.custom_job_sources, FEEDS);
});

test('a form that sends the local-network setting can turn it off', async () => {
  storage = { settings: { allow_local_network_feeds: true, privacy_consent: true } };
  await handleSaveSetup({
    settings: { allow_local_network_feeds: false, privacy_consent: true },
    profile: { full_name: 'Pat Example' },
  });
  assert.equal(storage.settings.allow_local_network_feeds, false);
});
