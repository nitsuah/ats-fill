#!/usr/bin/env node
/**
 * Copy the feature tour's web cut into the landing page: the 1080p narrated
 * video, its poster, captions and chapters (all written by
 * scripts/build-feature-video.mjs to video-build/out/web/) go to site/assets/,
 * which GitHub Pages publishes. Commit the result.
 *
 * Usage: node scripts/publish-feature-tour.mjs [--from video-build/out/web]
 */
import fs from 'node:fs';
import path from 'node:path';

const i = process.argv.indexOf('--from');
const FROM = path.resolve(i >= 0 ? process.argv[i + 1] : 'video-build/out/web');
const TO = path.resolve('site/assets');
const FILES = ['feature-tour.mp4', 'feature-tour.jpg', 'feature-tour.en.vtt', 'feature-tour.chapters.vtt'];

for (const file of FILES) {
  const src = path.join(FROM, file);
  if (!fs.existsSync(src)) throw new Error(`Missing ${src}; render the video first (see video/README.md).`);
}
for (const file of FILES) {
  fs.copyFileSync(path.join(FROM, file), path.join(TO, file));
  console.log(`site/assets/${file}  ${(fs.statSync(path.join(TO, file)).size / 1e6).toFixed(1)} MB`);
}
