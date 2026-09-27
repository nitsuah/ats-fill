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
} from '../../../lib/oauth.js';

function getOauthRedirectUri() {
  try {
    return chrome.identity?.getRedirectURL ? chrome.identity.getRedirectURL() : '';
  } catch {
    return '';
  }
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
  const clientSecret = settings.linkedin_client_secret;
  if (!clientId || !clientSecret) {
    throw new Error('Add your LinkedIn app Client ID and Client Secret in the AI panel first.');
  }

  const redirectUri = getOauthRedirectUri();
  const state = crypto.randomUUID();
  const authUrl = buildLinkedInAuthUrl({ clientId, redirectUri, state });

  const redirectResponse = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const responseUrl = new URL(redirectResponse);
  const code = responseUrl.searchParams.get('code');
  const returnedState = responseUrl.searchParams.get('state');
  const oauthError = responseUrl.searchParams.get('error_description') || responseUrl.searchParams.get('error');
  if (oauthError) throw new Error(`LinkedIn sign-in failed: ${oauthError}`);
  if (returnedState !== state) throw new Error('OAuth state mismatch — please try again.');
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
  const clientSecret = settings.google_client_secret;
  if (!clientId || !clientSecret) {
    throw new Error('Add your Google OAuth Client ID and Client Secret in the AI panel first.');
  }

  const redirectUri = getOauthRedirectUri();
  const state = crypto.randomUUID();
  const authUrl = buildGoogleAuthUrl({ clientId, redirectUri, state });

  const redirectResponse = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const responseUrl = new URL(redirectResponse);
  const code = responseUrl.searchParams.get('code');
  const returnedState = responseUrl.searchParams.get('state');
  const oauthError = responseUrl.searchParams.get('error_description') || responseUrl.searchParams.get('error');
  if (oauthError) throw new Error(`Google sign-in failed: ${oauthError}`);
  if (returnedState !== state) throw new Error('OAuth state mismatch — please try again.');
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
