import fs from "node:fs";

const manifestPath = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) throw new Error("manifest.json must use Manifest V3.");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error(`manifest version must be MAJOR.MINOR.PATCH; got "${manifest.version}"`);
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
