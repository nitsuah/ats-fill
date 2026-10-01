#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

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

// Store icon: 96x96 artwork inside 16px of transparent padding on every side
// (https://developer.chrome.com/docs/webstore/images#icons).
export const ICON_PADDING = 16;

/** Decode an 8-bit, non-interlaced RGBA PNG into raw pixels (4 bytes each). */
export function decodeRgbaPng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const [bitDepth, colorType, , , interlace] = buffer.subarray(24, 29);
  if (colorType !== 6 || bitDepth !== 8 || interlace !== 0) {
    return { width, height, colorType, pixels: null };
  }
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (buffer.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
      row[x] = (src[x] + predictor) & 0xff;
    }
  }
  return { width, height, colorType, pixels };
}

/** Returns a problem description, or null when the icon meets the Store spec. */
export function storeIconProblem(buffer, [width, height] = [128, 128]) {
  const icon = decodeRgbaPng(buffer);
  if (icon.width !== width || icon.height !== height || !icon.pixels) {
    return `got ${icon.width}x${icon.height}, color type ${icon.colorType}; expected ${width}x${height} 8-bit RGBA`;
  }
  let opaque = 0;
  let first = null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inBorder = x < ICON_PADDING || y < ICON_PADDING || x >= width - ICON_PADDING || y >= height - ICON_PADDING;
      if (inBorder && icon.pixels[(y * width + x) * 4 + 3] !== 0) {
        opaque += 1;
        first ??= `(${x},${y})`;
      }
    }
  }
  return opaque ? `${opaque} non-transparent pixel(s) in the ${ICON_PADDING}px padding, first at ${first}` : null;
}

function main() {
  const dir = path.resolve(process.argv[2] || 'store-assets');
  const missing = [];
  const invalid = [];
  for (const filename of expected) {
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) { missing.push(filename); continue; }
    try {
      const [width, height] = dimensions[filename];
      if (filename.endsWith('.png')) {
        const problem = storeIconProblem(fs.readFileSync(filePath), [width, height]);
        if (problem) invalid.push(filename + ': ' + problem);
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
