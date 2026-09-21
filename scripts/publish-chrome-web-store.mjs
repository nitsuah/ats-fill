import fs from "node:fs";

const required = [
  "CWS_CLIENT_ID",
  "CWS_CLIENT_SECRET",
  "CWS_REFRESH_TOKEN",
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

const publisher = process.env.CWS_PUBLISHER_ID;
const extension = process.env.CWS_EXTENSION_ID;
const base = `https://chromewebstore.googleapis.com/v2/publishers/${publisher}/items/${extension}`;
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
    throw new Error(`OAuth token refresh failed (${response.status}): ${JSON.stringify(body)}`);
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
