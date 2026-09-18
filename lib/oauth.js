// lib/oauth.js
// OAuth helpers. The interactive flow (chrome.identity) lives in the service
// worker; the pure mapping below is kept here so it's unit-testable.

/**
 * Map a LinkedIn OpenID Connect `userinfo` payload to our profile fields.
 * LinkedIn's `locale` may be a string ("en-US") or an object
 * ({ country: "US", language: "en" }) — handle both.
 *
 * @param {object} userinfo
 * @returns {{full_name:string, email:string, locale:string, picture:string}}
 */
export function mapLinkedInProfileToFields(userinfo = {}) {
  const fullName = String(
    userinfo.name || [userinfo.given_name, userinfo.family_name].filter(Boolean).join(' ')
  ).trim();

  let locale = '';
  if (typeof userinfo.locale === 'string') {
    locale = userinfo.locale;
  } else if (userinfo.locale && typeof userinfo.locale === 'object') {
    locale = [userinfo.locale.language, userinfo.locale.country].filter(Boolean).join('-');
  }

  return {
    full_name: fullName,
    email: String(userinfo.email || '').trim(),
    locale,
    picture: String(userinfo.picture || '').trim(),
  };
}

export const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
export const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
export const LINKEDIN_SCOPES = 'openid profile email';

/**
 * Build the LinkedIn OIDC authorization URL.
 * @param {{clientId:string, redirectUri:string, state:string}} params
 */
export function buildLinkedInAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES,
  });
  return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
}

// ── Google OIDC (BYO-OAuth profile bootstrap) ────────────────────────────────
//
// Same BYO-app pattern as LinkedIn above: the user registers their own Google
// Cloud OAuth client, pastes the Client ID/Secret locally, and this drives an
// identical authorization-code exchange via chrome.identity.launchWebAuthFlow.
// No shared credentials, nothing leaves the device except the direct call to
// Google's own endpoints.
//
// Client type matters: launchWebAuthFlow redirects through
// `https://<extension-id>.chromiumapp.org/`, which only a **Web application**
// OAuth client accepts as an authorized redirect URI — a Desktop/Chrome-app
// client will hit redirect_uri_mismatch. The Settings UI tells users this.

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
export const GOOGLE_SCOPES = 'openid profile email';

/**
 * Build the Google OIDC authorization URL.
 * @param {{clientId:string, redirectUri:string, state:string}} params
 */
export function buildGoogleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: GOOGLE_SCOPES,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Map a Google `userinfo` (OIDC) payload to our profile fields. Shape is
 * https://www.googleapis.com/oauth2/v3/userinfo — flat name/email/picture,
 * no locale-object variant like LinkedIn.
 * @param {object} userinfo
 * @returns {{full_name:string, email:string, locale:string, picture:string}}
 */
export function mapGoogleProfileToFields(userinfo = {}) {
  const fullName = String(
    userinfo.name || [userinfo.given_name, userinfo.family_name].filter(Boolean).join(' ')
  ).trim();
  return {
    full_name: fullName,
    email: String(userinfo.email || '').trim(),
    locale: String(userinfo.locale || '').trim(),
    picture: String(userinfo.picture || '').trim(),
  };
}
