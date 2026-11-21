/**
 * background/modules/handlers/oauth.js - LinkedIn / Google OAuth profile bootstrap
 * Extracted from service-worker.js
 */

import {
  mapLinkedInProfileToFields,
  buildLinkedInAuthUrl,
  LINKEDIN_TOKEN_URL,
  LINKEDIN_USERINFO_URL,
  mapGoogleProfileToFields,
  buildGoogleAuthUrl,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  generateCodeVerifier,
  deriveCodeChallenge,
} from '../../../lib/oauth.js';
import { decryptSecret } from '../../../lib/secret-box.js';

function getOauthRedirectUri() {
  try {
    return chrome.identity?.getRedirectURL ? chrome.identity.getRedirectURL() : '';
  } catch {
    return '';
  }
}

/**
 * Prune OAuth state records older than 10 minutes from chrome.storage.session.
 */
async function pruneOldOAuthStates() {
  const data = await chrome.storage.session.get(null);
  const now = Date.now();
  const tenMin = 10 * 60 * 1000;
  const keysToDelete = [];
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('oauth_state:') && value && typeof value.createdAt === 'number') {
      if (now - value.createdAt > tenMin) {
        keysToDelete.push(key);
      }
    }
  }
  if (keysToDelete.length > 0) {
    await chrome.storage.session.remove(keysToDelete);
  }
}

/**
 * Store a single-use OAuth state in chrome.storage.session.
 * @param {string} provider - 'linkedin' or 'google'
 * @param {string} state - The state value
 * @param {string} codeVerifier - PKCE code verifier
 * @returns {Promise<void>}
 */
async function storeOAuthState(provider, state, codeVerifier) {
  const key = `oauth_state:${state}`;
  await chrome.storage.session.set({ [key]: { provider, state, codeVerifier, createdAt: Date.now() } });
  await pruneOldOAuthStates();
}

/**
 * Retrieve and delete a single-use OAuth state from chrome.storage.session by state value.
 * @param {string} state - The state value returned from the OAuth callback
 * @returns {Promise<{state:string, codeVerifier:string, provider:string}|null>}
 */
async function consumeOAuthState(state) {
  const key = `oauth_state:${state}`;
  const data = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return data[key] || null;
}

/**
 * Verify that the consumed OAuth state record's provider matches the expected one.
 * Throws if no record found or provider mismatch (single-use: record deleted after read).
 */
async function verifyConsumedOAuthState(returnedState, expectedProvider) {
  if (!returnedState) throw new Error('OAuth state expired — please try again.');
  const stored = await consumeOAuthState(returnedState);
  if (!stored) throw new Error('OAuth state expired — please try again.');
  if (stored.provider !== expectedProvider) {
    throw new Error('OAuth state provider mismatch — possible overlapping sign-in.');
  }
  return stored;
}

export async function handleGetOauthInfo() {
  const data = await chrome.storage.local.get('settings');
  const settings = data.settings || {};
  return {
    success: true,
    redirectUri: getOauthRedirectUri(),
    linkedinConfigured: !!(settings.linkedin_client_id && settings.linkedin_client_secret),
    googleConfigured: !!(settings.google_client_id && settings.google_client_secret),
  };
}

export async function handleLinkedInConnect() {
  if (!chrome.identity?.launchWebAuthFlow) {
    throw new Error('Browser identity API is unavailable in this context.');
  }
  const data = await chrome.storage.local.get('settings');
  const settings = data.settings || {};
  const clientId = settings.linkedin_client_id;
  const encryptedSecret = settings.linkedin_client_secret;
  const clientSecret = encryptedSecret ? await decryptSecret(encryptedSecret) : '';
  if (!clientId || !clientSecret) {
    throw new Error('Add your LinkedIn app Client ID and Client Secret in the AI panel first.');
  }

  const redirectUri = getOauthRedirectUri();
  const state = crypto.randomUUID();
  // LinkedIn's standard (non-native) OAuth does not accept PKCE parameters, so
  // LinkedIn keeps the client-secret exchange with single-use state only.
  await storeOAuthState('linkedin', state, null);

  const authUrl = buildLinkedInAuthUrl({ clientId, redirectUri, state });

  const redirectResponse = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const responseUrl = new URL(redirectResponse);
  const code = responseUrl.searchParams.get('code');
  const returnedState = responseUrl.searchParams.get('state');
  const oauthError = responseUrl.searchParams.get('error_description') || responseUrl.searchParams.get('error');
  if (oauthError) throw new Error(`LinkedIn sign-in failed: ${oauthError}`);

  const stored = await verifyConsumedOAuthState(returnedState, 'linkedin');
  if (!stored) throw new Error('OAuth session expired — please try again.');
  if (returnedState !== stored.state) throw new Error('OAuth state mismatch — please try again.');
  if (!code) throw new Error('LinkedIn did not return an authorization code.');

  const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`LinkedIn token exchange failed (${tokenRes.status}). Check your Client Secret and redirect URI.`);
  }
  const token = await tokenRes.json();
  if (!token.access_token) throw new Error('LinkedIn did not return an access token.');

  const userRes = await fetch(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) {
    throw new Error(`Could not read LinkedIn profile (${userRes.status}).`);
  }
  const userinfo = await userRes.json();
  return { success: true, profile: mapLinkedInProfileToFields(userinfo) };
}

export async function handleGoogleConnect() {
  if (!chrome.identity?.launchWebAuthFlow) {
    throw new Error('Browser identity API is unavailable in this context.');
  }
  const data = await chrome.storage.local.get('settings');
  const settings = data.settings || {};
  const clientId = settings.google_client_id;
  const encryptedSecret = settings.google_client_secret;
  const clientSecret = encryptedSecret ? await decryptSecret(encryptedSecret) : '';
  if (!clientId || !clientSecret) {
    throw new Error('Add your Google OAuth Client ID and Client Secret in the AI panel first.');
  }

  const redirectUri = getOauthRedirectUri();
  const state = crypto.randomUUID();
  const codeVerifier = await generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);
  await storeOAuthState('google', state, codeVerifier);

  const authUrl = buildGoogleAuthUrl({ clientId, redirectUri, state, codeChallenge, codeChallengeMethod: 'S256' });

  const redirectResponse = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const responseUrl = new URL(redirectResponse);
  const code = responseUrl.searchParams.get('code');
  const returnedState = responseUrl.searchParams.get('state');
  const oauthError = responseUrl.searchParams.get('error_description') || responseUrl.searchParams.get('error');
  if (oauthError) throw new Error(`Google sign-in failed: ${oauthError}`);

  const stored = await verifyConsumedOAuthState(returnedState, 'google');
  if (!stored) throw new Error('OAuth session expired — please try again.');
  if (returnedState !== stored.state) throw new Error('OAuth state mismatch — please try again.');
  if (!code) throw new Error('Google did not return an authorization code.');

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: stored.codeVerifier,
    }).toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed (${tokenRes.status}). Check your Client Secret and redirect URI.`);
  }
  const token = await tokenRes.json();
  if (!token.access_token) throw new Error('Google did not return an access token.');

  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) {
    throw new Error(`Could not read Google profile (${userRes.status}).`);
  }
  const userinfo = await userRes.json();
  return { success: true, profile: mapGoogleProfileToFields(userinfo) };
}
