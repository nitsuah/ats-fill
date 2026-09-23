import fs from "node:fs";

const manifestPath = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) throw new Error("manifest.json must use Manifest V3.");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error(`manifest version must be MAJOR.MINOR.PATCH; got "${manifest.version}"`);
}

const requiredPermissionSet = new Set(["storage", "activeTab", "scripting", "identity", "cookies"]);
for (const permission of manifest.permissions || []) {
  if (!requiredPermissionSet.has(permission)) {
    throw new Error(`Unexpected required permission: ${permission}`);
  }
}
if ((manifest.permissions || []).includes("tabs")) {
  throw new Error('The "tabs" permission is broader than necessary; use host permissions or activeTab for tab URL access.');
}

const expectedWebAccessibleMatches = new Set(manifest.content_scripts?.flatMap((script) => script.matches || []) || []);
const webAccessibleMatches = manifest.web_accessible_resources?.flatMap((resource) => resource.matches || []) || [];
if (webAccessibleMatches.includes("<all_urls>")) {
  throw new Error("web_accessible_resources must not expose resources to <all_urls>.");
}
for (const match of webAccessibleMatches) {
  if (!expectedWebAccessibleMatches.has(match)) {
    throw new Error(`web_accessible_resources match is broader than content script access: ${match}`);
  }
}

const extensionCsp = manifest.content_security_policy?.extension_pages;
if (extensionCsp !== "script-src 'self'; object-src 'self';") {
  throw new Error("extension_pages CSP must allow only packaged extension scripts and block plugin objects.");
}

for (const file of [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...(manifest.icons ? Object.values(manifest.icons) : []),
]) {
  if (file && !fs.existsSync(new URL(`../${file}`, import.meta.url))) {
    throw new Error(`manifest references missing file: ${file}`);
  }
}
console.log(`Manifest OK: v${manifest.version}`);
