#!/usr/bin/env node
/**
 * Encode the feature-tour video from frames rendered by
 * tests/e2e/feature-video.spec.mjs (see video/README.md).
 *
 * The spec renders every distinct frame at 3840x2160 and writes
 * frames/manifest.json: units (intro, one per chapter, outro), each a list of
 * { file, frames } runs. Each unit starts and ends on plain paper, so this
 * script encodes every unit once and joins them without re-encoding:
 *
 *   shorts/NN-<slug>.mp4      one short per feature: chapter unit → CTA unit
 *   ats-fill-feature-tour.mp4 combined cut: intro → every chapter → one CTA
 *   youtube.md                title, description with chapter timestamps, tags
 *   thumbnail.jpg             1280x720 YouTube thumbnail from the intro frame
 *
 * Usage: node scripts/build-feature-video.mjs [--music track.mp3] [--frames dir] [--out dir]
 * Needs ffmpeg on PATH (or FFMPEG=/path/to/ffmpeg); the `video` Docker target has it.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { STORE_URL, REPO_URL, SITE_URL } from '../video/storyboard.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const FRAMES = path.resolve(arg('frames', 'video-build/frames'));
const OUT = path.resolve(arg('out', 'video-build/out'));
const MUSIC = arg('music', null);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

function ffmpeg(params) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...params], { stdio: 'inherit' });
}

function probe(file, entries) {
  const ffprobe = process.env.FFPROBE || FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  return execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim();
}

const manifestFile = path.join(FRAMES, 'manifest.json');
if (!fs.existsSync(manifestFile)) throw new Error(`Missing ${manifestFile}; run the feature-video capture first.`);
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const { fps: FPS, width, height } = manifest;

// Upload-grade H.264, as YouTube recommends for 2160p: high profile, 4:2:0,
// BT.709 (PNG frames are RGB; without explicit matrix and tags the colours
// shift once YouTube transcodes), closed 1s GOPs. `stillimage` tuning keeps
// fine text edges, and the static holds cost almost nothing at a low CRF.
// Threads and lookahead are capped: x264's defaults peak around 4 GB per 4K
// encode, which runs a default Docker Desktop VM out of memory (~1.9 GB capped).
const ENCODE = [
  '-vf', `scale=${width}:${height}:flags=lanczos+accurate_rnd:out_color_matrix=bt709:out_range=tv,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'stillimage',
  '-threads', '8', '-x264-params', 'rc-lookahead=20',
  '-profile:v', 'high', '-level:v', '5.1', '-g', String(FPS), '-keyint_min', String(FPS), '-sc_threshold', '0',
  '-flags', '+cgop', '-bf', '2',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-fps_mode', 'cfr', '-r', String(FPS),
];

/** Encode one unit's runs (one still per run, held for its frame count). */
function encodeUnit(unit) {
  const out = path.join(OUT, 'units', `${unit.id}.mp4`);
  const list = path.join(OUT, 'units', `${unit.id}.ffconcat`);
  const lines = ['ffconcat version 1.0'];
  for (const e of unit.entries) {
    lines.push(`file '${path.join(FRAMES, e.file).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`, `duration ${(e.frames / FPS).toFixed(6)}`);
  }
  // The concat demuxer ignores the last duration unless the file is repeated.
  lines.push(lines[lines.length - 2]);
  fs.writeFileSync(list, `${lines.join('\n')}\n`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, ...ENCODE, '-frames:v', String(unit.frames), '-an', out]);
  const frames = Number(probe(out, 'stream=nb_read_packets'));
  if (frames !== unit.frames) throw new Error(`${unit.id}: encoded ${frames} frames, manifest has ${unit.frames}`);
  return out;
}

/** Join encoded units back to back (stream copy) and add optional music. */
function join(units, out) {
  const list = `${out}.ffconcat`;
  fs.writeFileSync(list, `ffconcat version 1.0\n${units.map((u) => `file '${encoded.get(u.id).replace(/\\/g, '/')}'`).join('\n')}\n`);
  const total = units.reduce((sum, u) => sum + u.frames, 0) / FPS;
  const video = MUSIC ? `${out}.video.mp4` : out;
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', video]);
  if (MUSIC) {
    ffmpeg([
      '-i', video, '-stream_loop', '-1', '-i', MUSIC,
      '-filter_complex', `[1:a]atrim=0:${total.toFixed(3)},afade=t=in:d=1,afade=t=out:st=${Math.max(0, total - 2.5).toFixed(3)}:d=2.5,volume=0.7[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
      '-movflags', '+faststart', '-t', total.toFixed(3), out,
    ]);
    fs.rmSync(video);
  }
  fs.rmSync(list);
  const actual = Number(probe(out, 'format=duration').split('\n').pop());
  if (Math.abs(actual - total) > 0.1) {
    throw new Error(`${path.basename(out)} is ${actual.toFixed(2)}s but the storyboard needs ${total.toFixed(2)}s; ffmpeg likely dropped input.`);
  }
  return total;
}

const stamp = (s) => {
  const t = Math.floor(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

fs.mkdirSync(path.join(OUT, 'units'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'shorts'), { recursive: true });

const encoded = new Map();
for (const unit of manifest.units) {
  const t0 = Date.now();
  encoded.set(unit.id, encodeUnit(unit));
  console.log(`encode ${unit.id.padEnd(18)} ${stamp(unit.frames / FPS)}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const outro = manifest.units.find((u) => u.kind === 'outro');
const chapterUnits = manifest.units.filter((u) => u.kind === 'chapter');

// Per-feature shorts: each stands alone, so each ends on the call to action.
const shorts = chapterUnits.map((unit) => {
  const file = path.join(OUT, 'shorts', `${unit.id}.mp4`);
  const total = join([unit, outro], file);
  console.log(`short  ${path.relative(OUT, file)}  ${stamp(total)}`);
  return { unit, file, total };
});

// Combined cut: intro, every chapter, one call to action.
const tourFile = path.join(OUT, 'ats-fill-feature-tour.mp4');
const total = join(manifest.units, tourFile);
console.log(`tour   ${path.relative(OUT, tourFile)}  ${stamp(total)}  ${width}x${height}@${FPS}`);

let at = 0;
const chapterStarts = [];
for (const unit of manifest.units) {
  if (unit.title) chapterStarts.push({ title: unit.title, at: Math.floor(at) });
  at += unit.frames / FPS;
}
// YouTube ignores the whole chapter list if any chapter is shorter than 10s.
chapterStarts.forEach((c, i) => {
  const end = i + 1 < chapterStarts.length ? chapterStarts[i + 1].at : total;
  if (end - c.at < 10) throw new Error(`Chapter "${c.title}" is ${end - c.at}s; YouTube needs at least 10s per chapter.`);
});
const chapters = chapterStarts.map((c) => `${stamp(c.at)} ${c.title}`);

ffmpeg(['-i', path.join(FRAMES, manifest.poster), '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '2', path.join(OUT, 'thumbnail.jpg')]);

fs.writeFileSync(path.join(OUT, 'youtube.md'), `# YouTube upload copy

Upload \`ats-fill-feature-tour.mp4\` (${width}x${height}, ${FPS} fps). A 2160p upload is
transcoded by YouTube with its higher-bitrate VP9/AV1 ladder, which keeps UI
text sharp even for viewers watching at 1080p. The 4K renditions can take a
while to appear after the upload finishes processing.

## Title

ats-fill feature tour: fill job applications, track your pipeline, prep interviews (free Chrome extension)

## Description

ats-fill is a free, open-source, local-first Chrome extension for job seekers. Save your profile once, fill Greenhouse, Lever, Ashby and Workday applications in place, review every answer before you submit, and keep every application in a pipeline that lives in your browser. No server, no account, no subscription.

Add to Chrome: ${STORE_URL}
Website: ${SITE_URL}
Source (MIT): ${REPO_URL}

Chapters
${chapters.join('\n')}

All names, companies and applications shown are fictional demo data.

## Tags

job search, job application, autofill, chrome extension, greenhouse, lever, ashby, workday, job tracker, interview prep, resume, career, open source

## Per-feature shorts

${shorts.map((s) => `- \`shorts/${path.basename(s.file)}\` (${stamp(s.total)}): ${s.unit.title}. ${s.unit.summary}`).join('\n')}
`);
console.log(`\nChapters:\n${chapters.join('\n')}\n\nWrote ${path.relative(process.cwd(), OUT)}/youtube.md and thumbnail.jpg`);
