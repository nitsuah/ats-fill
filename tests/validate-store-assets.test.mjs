import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodeRgbaPng, storeIconProblem } from '../scripts/validate-store-assets.mjs';

// Minimal RGBA PNG encoder. Each row uses a different filter type so the
// decoder's unfiltering (None/Sub/Up/Average/Paeth) is exercised too.
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePng(width, height, alphaAt) {
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.set([200, 60, 30, alphaAt(x, y)], (y * width + x) * 4);
    }
  }
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x += 1) {
      const cur = pixels[y * stride + x];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
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
      }
      raw[y * (stride + 1) + 1 + x] = (cur - predictor) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inArt = (x, y) => x >= 16 && y >= 16 && x < 112 && y < 112;

test('decodeRgbaPng round-trips every filter type', () => {
  const png = encodePng(128, 128, (x, y) => (x * 7 + y * 3) & 0xff);
  const { pixels } = decodeRgbaPng(png);
  for (const [x, y] of [[0, 0], [5, 1], [64, 2], [127, 3], [90, 4], [33, 127]]) {
    assert.equal(pixels[(y * 128 + x) * 4 + 3], (x * 7 + y * 3) & 0xff, `alpha at ${x},${y}`);
  }
});

test('accepts an icon with a fully transparent 16px border', () => {
  assert.equal(storeIconProblem(encodePng(128, 128, (x, y) => (inArt(x, y) ? 255 : 0))), null);
});

test('rejects a full-bleed icon', () => {
  assert.match(storeIconProblem(encodePng(128, 128, () => 255)), /non-transparent pixel/);
});

test('rejects artwork in the padding even when the corners are transparent', () => {
  const problem = storeIconProblem(encodePng(128, 128, (x, y) => (inArt(x, y) || (x === 8 && y === 64) ? 255 : 0)));
  assert.match(problem, /1 non-transparent pixel\(s\).*\(8,64\)/);
});

test('rejects the wrong size', () => {
  assert.match(storeIconProblem(encodePng(96, 96, () => 0)), /got 96x96/);
});
