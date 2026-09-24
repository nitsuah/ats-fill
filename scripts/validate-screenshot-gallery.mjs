#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const screenshotDir = path.resolve(process.argv[2] || 'screenshots');
const expected = [
  'main-dashboard.png',
  'tracker-workspace.png',
  'profile-memory.png',
  'job-search.png',
  'ai-settings.png',
  'help-privacy.png',
  'interview-prep.png',
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

if (!fs.existsSync(screenshotDir)) {
  throw new Error(`Screenshot directory does not exist: ${screenshotDir}`);
}

const missing = [];
const invalid = [];

for (const filename of expected) {
  const filePath = path.join(screenshotDir, filename);

  if (!fs.existsSync(filePath)) {
    missing.push(filename);
    continue;
  }

  const stats = fs.statSync(filePath);
  const header = fs.readFileSync(filePath).subarray(0, PNG_SIGNATURE.length);

  if (stats.size === 0 || !header.equals(PNG_SIGNATURE)) {
    invalid.push(filename);
  }
}

if (missing.length || invalid.length) {
  if (missing.length) console.error(`Missing screenshots: ${missing.join(', ')}`);
  if (invalid.length) console.error(`Invalid/empty PNGs: ${invalid.join(', ')}`);
  process.exit(1);
}

console.log(`Validated ${expected.length} UI screenshots in ${screenshotDir}`);
