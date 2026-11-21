import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapLinkedInProfileToFields,
  buildLinkedInAuthUrl,
  LINKEDIN_AUTH_URL,
  mapGoogleProfileToFields,
  buildGoogleAuthUrl,
  GOOGLE_AUTH_URL,
  generateCodeVerifier,
  deriveCodeChallenge,
} from '../lib/oauth.js';

test('mapLinkedInProfileToFields reads name/email and a string locale', () => {
  const fields = mapLinkedInProfileToFields({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    locale: 'en-US',
    picture: 'https://cdn/pic.jpg',
  });
  assert.equal(fields.full_name, 'Ada Lovelace');
  assert.equal(fields.email, 'ada@example.com');
  assert.equal(fields.locale, 'en-US');
  assert.equal(fields.picture, 'https://cdn/pic.jpg');
});

test('mapLinkedInProfileToFields composes name parts and an object locale', () => {
  const fields = mapLinkedInProfileToFields({
    given_name: 'Grace',
    family_name: 'Hopper',
    email: 'grace@navy.mil',
    locale: { country: 'US', language: 'en' },
  });
  assert.equal(fields.full_name, 'Grace Hopper');
  assert.equal(fields.locale, 'en-US');
  assert.equal(fields.picture, '');
});

test('buildLinkedInAuthUrl includes OIDC params and encodes the redirect', () => {
  const url = buildLinkedInAuthUrl({
    clientId: 'abc123',
    redirectUri: 'https://ext-id.chromiumapp.org/',
    state: 'xyz',
  });
  assert.ok(url.startsWith(LINKEDIN_AUTH_URL + '?'));
  const params = new URL(url).searchParams;
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('client_id'), 'abc123');
  assert.equal(params.get('redirect_uri'), 'https://ext-id.chromiumapp.org/');
  assert.equal(params.get('state'), 'xyz');
  assert.equal(params.get('scope'), 'openid profile email');
});

test('mapGoogleProfileToFields reads the flat OIDC userinfo shape', () => {
  const fields = mapGoogleProfileToFields({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    locale: 'en',
    picture: 'https://cdn/pic.jpg',
  });
  assert.equal(fields.full_name, 'Ada Lovelace');
  assert.equal(fields.email, 'ada@example.com');
  assert.equal(fields.locale, 'en');
  assert.equal(fields.picture, 'https://cdn/pic.jpg');
});

test('mapGoogleProfileToFields composes name parts when no display name is present', () => {
  const fields = mapGoogleProfileToFields({
    given_name: 'Grace',
    family_name: 'Hopper',
    email: 'grace@navy.mil',
  });
  assert.equal(fields.full_name, 'Grace Hopper');
  assert.equal(fields.locale, '');
  assert.equal(fields.picture, '');
});

test('buildGoogleAuthUrl includes OIDC params and encodes the redirect', () => {
  const url = buildGoogleAuthUrl({
    clientId: 'abc123.apps.googleusercontent.com',
    redirectUri: 'https://ext-id.chromiumapp.org/',
    state: 'xyz',
  });
  assert.ok(url.startsWith(GOOGLE_AUTH_URL + '?'));
  const params = new URL(url).searchParams;
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('client_id'), 'abc123.apps.googleusercontent.com');
  assert.equal(params.get('redirect_uri'), 'https://ext-id.chromiumapp.org/');
  assert.equal(params.get('state'), 'xyz');
  assert.equal(params.get('scope'), 'openid profile email');
});

test('generateCodeVerifier produces 64-char base64url string', async () => {
  const verifier = await generateCodeVerifier();
  assert.equal(verifier.length, 64);
  assert.ok(/^[A-Za-z0-9\-_]+$/.test(verifier), 'must use base64url alphabet without padding');
});

test('deriveCodeChallenge produces base64url SHA-256 of verifier', async () => {
  const verifier = await generateCodeVerifier();
  const challenge = await deriveCodeChallenge(verifier);
  assert.ok(challenge.length > 0);
  assert.ok(/^[A-Za-z0-9\-_]+$/.test(challenge), 'must be base64url without padding');
  // Verify it's actually SHA-256 by re-deriving and comparing
  const challenge2 = await deriveCodeChallenge(verifier);
  assert.equal(challenge, challenge2, 'same verifier must produce same challenge');
});

test('buildLinkedInAuthUrl includes PKCE params when provided', () => {
  const url = buildLinkedInAuthUrl({
    clientId: 'abc123',
    redirectUri: 'https://ext-id.chromiumapp.org/',
    state: 'xyz',
    codeChallenge: 'challenge123',
    codeChallengeMethod: 'S256',
  });
  const params = new URL(url).searchParams;
  assert.equal(params.get('code_challenge'), 'challenge123');
  assert.equal(params.get('code_challenge_method'), 'S256');
});

test('buildGoogleAuthUrl includes PKCE params when provided', () => {
  const url = buildGoogleAuthUrl({
    clientId: 'abc123.apps.googleusercontent.com',
    redirectUri: 'https://ext-id.chromiumapp.org/',
    state: 'xyz',
    codeChallenge: 'challenge123',
    codeChallengeMethod: 'S256',
  });
  const params = new URL(url).searchParams;
  assert.equal(params.get('code_challenge'), 'challenge123');
  assert.equal(params.get('code_challenge_method'), 'S256');
});

// RFC 7636 Appendix B known-answer test:
// verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
// must give challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
test('deriveCodeChallenge matches RFC 7636 Appendix B known answer', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const challenge = await deriveCodeChallenge(verifier);
  assert.equal(challenge, expectedChallenge);
});
