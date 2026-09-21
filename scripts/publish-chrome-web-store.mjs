import crypto from "node:crypto";
import fs from "node:fs";

const required = [
  "CWS_SERVICE_ACCOUNT_JSON",
  "CWS_PUBLISHER_ID",
  "CWS_EXTENSION_ID",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const packagePath = process.argv[2];
if (!packagePath || !fs.existsSync(packagePath)) {
  throw new Error(`Package not found: ${packagePath ?? "(missing argument)"}`);
}

let credentials;
try {
  credentials = JSON.parse(process.env.CWS_SERVICE_ACCOUNT_JSON);
} catch (error) {
  throw new Error(`CWS_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`);
}

if (
  credentials?.type !== "service_account" ||
  typeof credentials.client_email !== "string" ||
  typeof credentials.private_key !== "string"
) {
  throw new Error("CWS_SERVICE_ACCOUNT_JSON must be a Google service-account key containing type, client_email, and private_key.");
}

const tokenUri = credentials.token_uri ?? "https://oauth2.googleapis.com/token";
if (!tokenUri.startsWith("https://oauth2.googleapis.com/")) {
  throw new Error("CWS_SERVICE_ACCOUNT_JSON token_uri must use https://oauth2.googleapis.com/.");
}

const publisher = process.env.CWS_PUBLISHER_ID;
const extension = process.env.CWS_EXTENSION_ID;
const base = `https://chromewebstore.googleapis.com/v2/publishers/${publisher}/items/${extension}`;
const scope = "https://www.googleapis.com/auth/chromewebstore";

async function jsonOrText(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}),
  };
  const claims = {
    iss: credentials.client_email,
    scope,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key, "base64url")}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await jsonOrText(response);
  if (!response.ok || !body.access_token) {
    throw new Error(`Service-account token exchange failed (${response.status}): ${JSON.stringify(body)}`);
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
const headers = { Authorization: `Bearer ${token}` };

const upload = await request(`${base}:upload`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/zip" },
  body: fs.readFileSync(packagePath),
});
console.log(`Upload response: ${JSON.stringify(upload)}`);

let status = upload;
for (let attempt = 1; status.uploadState === "UPLOAD_IN_PROGRESS" && attempt <= 12; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  status = await request(`${base}:fetchStatus`, { headers });
  console.log(`Upload status attempt ${attempt}: ${JSON.stringify(status)}`);
}

if (status.uploadState === "UPLOAD_IN_PROGRESS") {
  throw new Error("Chrome Web Store upload is still in progress after 2 minutes.");
}
if (status.uploadState && status.uploadState !== "UPLOAD_SUCCESS") {
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
