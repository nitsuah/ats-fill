#!/usr/bin/env node
/**
 * Generate the feature-tour voiceover: one WAV per narration line
 * (video/narration.mjs) in video-build/voice/, plus manifest.json with each
 * clip's length. Clips are named by a hash of voice + text, so only edited
 * lines are re-synthesised.
 *
 * Needs python3 with kokoro-onnx and the Kokoro model files; the `video`
 * Docker target has them. Skip narration entirely with ATS_FILL_VOICE=0.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrationLines } from '../../video/narration.mjs';

const OUT = path.resolve('video-build/voice');
const manifestFile = path.join(OUT, 'manifest.json');

if (process.env.ATS_FILL_VOICE === '0') {
  fs.rmSync(manifestFile, { force: true });
  console.log('voice  skipped (ATS_FILL_VOICE=0)');
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
const voice = process.env.KOKORO_VOICE || 'af_heart';
const speed = process.env.KOKORO_SPEED || '1.1';
const lines = narrationLines().map((line) => {
  const hash = crypto.createHash('sha1').update(`${voice}|${speed}|${line.text}`).digest('hex').slice(0, 10);
  return { ...line, file: path.join(OUT, `${line.id}-${hash}.wav`) };
});

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tts.py');
const durations = JSON.parse(execFileSync(process.env.PYTHON || 'python3', [script], {
  input: JSON.stringify(lines),
  env: { ...process.env, KOKORO_VOICE: voice, KOKORO_SPEED: speed },
  stdio: ['pipe', 'pipe', 'inherit'],
  maxBuffer: 1 << 20,
}).toString());

const clips = Object.fromEntries(lines.map((line) => [line.id, {
  file: path.basename(line.file),
  seconds: Math.round(durations[line.id] * 1000) / 1000,
  text: line.text,
  caption: line.caption,
}]));
fs.writeFileSync(manifestFile, JSON.stringify({ voice, speed: Number(speed), clips }, null, 2));
// Drop clips for lines that were edited or removed.
const keep = new Set(lines.map((line) => path.basename(line.file)));
for (const file of fs.readdirSync(OUT)) if (file.endsWith('.wav') && !keep.has(file)) fs.rmSync(path.join(OUT, file));
const total = Object.values(clips).reduce((sum, c) => sum + c.seconds, 0);
console.log(`voice  ${lines.length} lines, ${total.toFixed(1)}s of narration (${voice})`);
