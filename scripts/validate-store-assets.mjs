#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = path.resolve(process.argv[2] || 'store-assets');
const expected = [
  'screenshot-01-main.jpg',
  'screenshot-02-tracker.jpg',
  'screenshot-03-job-search.jpg',
  'screenshot-04-interview-prep.jpg',
  'screenshot-05-analytics.jpg',
  'small-promo.jpg',
  'marquee-promo.jpg',
  'store-icon-128.png',
];
const dimensions = {
  'screenshot-01-main.jpg': [1280, 800],
  'screenshot-02-tracker.jpg': [1280, 800],
  'screenshot-03-job-search.jpg': [1280, 800],
  'screenshot-04-interview-prep.jpg': [1280, 800],
  'screenshot-05-analytics.jpg': [1280, 800],
  'small-promo.jpg': [440, 280],
  'marquee-promo.jpg': [1400, 560],
  'store-icon-128.png': [128, 128],
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

// Store icon: an RGBA PNG whose 16px border is transparent (96x96 artwork).
// Row 0's first pixel has no left/up neighbours, so every PNG filter type
// leaves it raw: its alpha is byte 4 of the inflated stream (after the filter
// byte), which is enough to catch a full-bleed icon.
function pngInfo(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return { width, height, colorType, cornerAlpha: colorType === 6 ? raw[4] : 255 };
}

const missing = [];
const invalid = [];
for (const filename of expected) {
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) { missing.push(filename); continue; }
  try {
    const [width, height] = dimensions[filename];
    if (filename.endsWith('.png')) {
      const info = pngInfo(fs.readFileSync(filePath));
      if (info.width !== width || info.height !== height || info.colorType !== 6 || info.cornerAlpha !== 0) {
        invalid.push(filename + ': got ' + info.width + 'x' + info.height + ', color type ' + info.colorType + ', corner alpha ' + info.cornerAlpha + '; expected ' + width + 'x' + height + ' RGBA with transparent padding');
      }
      continue;
    }
    const info = jpegSize(fs.readFileSync(filePath));
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
