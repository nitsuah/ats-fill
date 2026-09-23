import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const readmePath = 'README.md';
const readme = fs.readFileSync(readmePath, 'utf8');
const today = new Date().toISOString().slice(0, 10);
const version = manifest.version;

const marker = /^> Last refreshed: .*$/m;
const current = readme.match(marker)?.[0];

if (!current) {
  throw new Error('README screenshot refresh marker not found.');
}

const noteMatch = current.match(/(\([^\n]+\))$/);
const note = noteMatch ? ` ${noteMatch[1]}` : '';
const replacement = `> Last refreshed: ${today} · UI snapshot: v${version}${note}`;

if (current !== replacement) {
  fs.writeFileSync(readmePath, readme.replace(marker, replacement));
  console.log(`Updated README UI snapshot metadata to v${version} (${today}).`);
} else {
  console.log('README UI snapshot metadata is already current.');
}
