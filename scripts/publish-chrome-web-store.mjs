import fs from "node:fs";

// `--check-token` only proves the OAuth credentials still work (the weekly
// cws-token-check workflow); it uploads and publishes nothing.
const checkTokenOnly = process.argv[2] === "--check-token";

const required = checkTokenOnly
  ? ["CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN"]
  : ["CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN", "CWS_PUBLISHER_ID", "CWS_EXTENSION_ID"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const packagePath = process.argv[2];
if (!checkTokenOnly && (!packagePath || !fs.existsSync(packagePath))) {
  throw new Error(`Package not found: ${packagePath ?? "(missing argument)"}`);
}

// What to do when Google rejects the refresh token. The common cause is an
// OAuth consent screen left in "Testing", where refresh tokens expire after
// 7 days; a token minted with the OAuth Playground's default client (not
// "Use your own OAuth credentials") fails the same way.
const INVALID_GRANT_HELP = [
  "The Chrome Web Store refresh token was rejected (invalid_grant). To fix:",
  "  1. Google Cloud console → Google Auth Platform → Audience: set Publishing status to \"In production\".",
  "     In \"Testing\", refresh tokens expire after 7 days, so a new token would fail again next week.",
  "  2. OAuth 2.0 Playground → gear icon → tick \"Use your own OAuth credentials\" and enter the same",
  "     client ID/secret as CWS_CLIENT_ID/CWS_CLIENT_SECRET, authorize scope",
  "     https://www.googleapis.com/auth/chromewebstore with the store owner's account, exchange the code.",
  "  3. Save the refresh token to the `production` environment secret CWS_REFRESH_TOKEN",
  "     (gh secret set CWS_REFRESH_TOKEN --env production --repo nitsuah/ats-fill), then re-run.",
  "  See docs/release/chrome-web-store.md.",
].join("\n");

const publisher = process.env.CWS_PUBLISHER_ID;
const extension = process.env.CWS_EXTENSION_ID;
const base = `https://chromewebstore.googleapis.com/v2/publishers/${publisher}/items/${extension}`;
const uploadUrl = `https://chromewebstore.googleapis.com/upload/v2/publishers/${publisher}/items/${extension}:upload`;
const tokenUri = "https://oauth2.googleapis.com/token";

async function jsonOrText(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

async function getAccessToken() {
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CWS_CLIENT_ID,
      client_secret: process.env.CWS_CLIENT_SECRET,
      refresh_token: process.env.CWS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const body = await jsonOrText(response);
  if (!response.ok || !body.access_token) {
    const help = body.error === "invalid_grant" ? `\n${INVALID_GRANT_HELP}` : "";
    throw new Error(`OAuth token refresh failed (${response.status}): ${JSON.stringify(body)}${help}`);
  }
  return body.access_token;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await jsonOrText(response);
  if (!response.ok) throw new Error(`Chrome Web Store API failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

const token = await getAccessToken();
if (checkTokenOnly) {
  console.log("Chrome Web Store OAuth credentials are valid.");
  process.exit(0);
}
const headers = { Authorization: `Bearer ${token}` };

const upload = await request(uploadUrl, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/zip" },
  body: fs.readFileSync(packagePath),
});
console.log(`Upload response: ${JSON.stringify(upload)}`);

// The upload response reports its state as `uploadState`; fetchStatus reports
// the same information as `lastAsyncUploadState`. Track one `state` value
// across both so polling actually observes progress instead of always
// re-reading the (absent) `uploadState` field from fetchStatus responses.
let state = upload.uploadState;
let status = upload;
for (let attempt = 1; state === "IN_PROGRESS" && attempt <= 12; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  status = await request(`${base}:fetchStatus`, { headers });
  state = status.lastAsyncUploadState;
  console.log(`Upload status attempt ${attempt}: ${JSON.stringify(status)}`);
}

if (state === "IN_PROGRESS") {
  throw new Error("Chrome Web Store upload is still in progress after 2 minutes.");
}
if (state && state !== "SUCCEEDED") {
  const detail = status.itemError ?? status.itemErrors ?? status.error ?? status;
  throw new Error(`Chrome Web Store upload did not succeed: ${JSON.stringify(detail)}`);
}

const published = await request(`${base}:publish`, {
  method: "POST",
  headers,
});
console.log(`Publish response: ${JSON.stringify(published)}`);

if (["REJECTED", "CANCELLED"].includes(published.state)) {
  throw new Error(`Chrome Web Store publish returned an unsuccessful state: ${JSON.stringify(published)}`);
}
