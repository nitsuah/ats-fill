import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Regression coverage for a bug where every "Save Profile" click re-stamped
// privacy_consent_at with a fresh timestamp, silently overwriting the user's
// original consent date. readSettingsForm() must only mint a new timestamp
// on a genuine first-time accept, and preserve whatever applyStateToSetupForm
// hydrated onto the checkbox's dataset otherwise.

function setupDom() {
  const dom = new JSDOM(`<input type="checkbox" id="privacy-consent" />`, { url: 'https://example.com/popup' });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom;
}

test('readSettingsForm mints a fresh timestamp on first-time consent', async () => {
  setupDom();
  const { readSettingsForm } = await import('../popup/forms/forms.js?case=first-time');

  const checkbox = document.getElementById('privacy-consent');
  checkbox.checked = true;
  // No dataset.originalConsent set — simulates a never-before-consented user.

  const before = Date.now();
  const settings = readSettingsForm();
  const after = Date.now();

  assert.equal(settings.privacy_consent, true);
  assert.ok(settings.privacy_consent_at, 'expected a timestamp to be stamped');
  const stamped = new Date(settings.privacy_consent_at).getTime();
  assert.ok(stamped >= before && stamped <= after, 'timestamp should be freshly minted now');
});

test('readSettingsForm preserves the original timestamp when re-saving an already-consented profile', async () => {
  setupDom();
  const { readSettingsForm } = await import('../popup/forms/forms.js?case=resave');

  const ORIGINAL_TIMESTAMP = '2026-01-15T10:00:00.000Z';
  const checkbox = document.getElementById('privacy-consent');
  checkbox.checked = true;
  // Mirrors what applyStateToSetupForm() does when hydrating from storage.
  checkbox.dataset.originalConsent = 'true';
  checkbox.dataset.originalConsentAt = ORIGINAL_TIMESTAMP;

  const settings = readSettingsForm();

  assert.equal(settings.privacy_consent, true);
  assert.equal(settings.privacy_consent_at, ORIGINAL_TIMESTAMP, 'saving unrelated profile edits must not touch the recorded consent date');
});

test('readSettingsForm records no timestamp when consent is not checked', async () => {
  setupDom();
  const { readSettingsForm } = await import('../popup/forms/forms.js?case=unchecked');

  const checkbox = document.getElementById('privacy-consent');
  checkbox.checked = false;
  checkbox.dataset.originalConsent = 'true';
  checkbox.dataset.originalConsentAt = '2026-01-15T10:00:00.000Z';

  const settings = readSettingsForm();

  assert.equal(settings.privacy_consent, false);
  assert.equal(settings.privacy_consent_at, null);
});
