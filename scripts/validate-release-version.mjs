import fs from "node:fs";

const tag = process.argv[2];
if (!tag || !/^v\\d+\\.\\d+\\.\\d+$/.test(tag)) {
  throw new Error('Expected release tag in the form vX.Y.Z.');
}
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const expected = tag.slice(1);
if (manifest.version !== expected) {
  throw new Error(`Release tag ${tag} does not match manifest version ${manifest.version}.`);
}
console.log(`Release version OK: ${tag}`);
