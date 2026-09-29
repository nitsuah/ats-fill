#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'store-assets');
const expected = [
  'screenshot-01-main.jpg',
  'screenshot-02-tracker.jpg',
  'screenshot-03-job-search.jpg',
  'screenshot-04-interview-prep.jpg',
  'screenshot-05-analytics.jpg',
  'small-promo.jpg',
  'marquee-promo.jpg',
];
const dimensions = {
  'screenshot-01-main.jpg': [1280, 800],
  'screenshot-02-tracker.jpg': [1280, 800],
  'screenshot-03-job-search.jpg': [1280, 800],
  'screenshot-04-interview-prep.jpg': [1280, 800],
  'screenshot-05-analytics.jpg': [1280, 800],
  'small-promo.jpg': [440, 280],
  'marquee-promo.jpg': [1400, 560],
};

function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error('not a JPEG');
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
        components: buffer[offset + 7],
      };
    }
    offset += length;
  }
  throw new Error('JPEG SOF marker not found');
}

const missing = [];
const invalid = [];
for (const filename of expected) {
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) { missing.push(filename); continue; }
  try {
    const info = jpegSize(fs.readFileSync(filePath));
    const [width, height] = dimensions[filename];
    if (info.width !== width || info.height !== height || info.components !== 3) {
      invalid.push(filename + ': got ' + info.width + 'x' + info.height + ', ' + info.components + ' components; expected ' + width + 'x' + height + ', 3 components');
    }
  } catch (error) {
    invalid.push(filename + ': ' + error.message);
  }
}
if (missing.length || invalid.length) {
  if (missing.length) console.error('Missing store assets: ' + missing.join(', '));
  if (invalid.length) console.error(invalid.join('\n'));
  process.exit(1);
}
console.log('Validated ' + expected.length + ' Chrome Web Store assets in ' + dir);
