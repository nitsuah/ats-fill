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
 * Audio: the narration clips each unit cues (scripts/voice/narrate.mjs) are
 * laid onto one track per output and loudness-normalised for YouTube; an
 * optional --music bed is ducked under the voice.
 *
 * Usage: node scripts/build-feature-video.mjs [--music track.mp3] [--frames dir] [--voice dir] [--out dir]
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
const VOICE_DIR = path.resolve(arg('voice', 'video-build/voice'));
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

/**
 * One audio track for a run of units: every narration cue at its place, then
 * EBU R128 loudness normalisation (-16 LUFS, -1.5 dBTP; YouTube plays back at
 * -14). With --music, the bed loops underneath and ducks while the voice talks.
 */
function audioTrack(units, total, out) {
  const cues = [];
  let offset = 0;
  for (const unit of units) {
    for (const c of unit.voice ?? []) cues.push({ file: path.join(VOICE_DIR, c.file), at: offset + c.at });
    offset += unit.frames / FPS;
  }
  if (!cues.length && !MUSIC) return null;
  for (const c of cues) if (!fs.existsSync(c.file)) throw new Error(`Missing narration clip ${c.file}; run scripts/voice/narrate.mjs first.`);

  const inputs = cues.flatMap((c) => ['-i', c.file]);
  const end = total.toFixed(3);
  const filters = cues.map((c, i) => {
    const ms = Math.round(c.at * 1000);
    return `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[c${i}]`;
  });
  let voice = null;
  if (cues.length) {
    filters.push(`${cues.map((_, i) => `[c${i}]`).join('')}amix=inputs=${cues.length}:normalize=0,apad,atrim=0:${end},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[voice]`);
    voice = '[voice]';
  }
  if (MUSIC) {
    inputs.push('-stream_loop', '-1', '-i', MUSIC);
    const m = cues.length;
    filters.push(`[${m}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${end},afade=t=in:d=1,afade=t=out:st=${Math.max(0, total - 2.5).toFixed(3)}:d=2.5,volume=${voice ? 0.35 : 0.7}[bed]`);
    if (voice) {
      filters.push('[voice]asplit[v1][v2]', '[bed][v2]sidechaincompress=threshold=0.03:ratio=8:attack=30:release=500[duck]', '[v1][duck]amix=inputs=2:normalize=0[mix]');
      voice = '[mix]';
    } else {
      voice = '[bed]';
    }
  }
  ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', voice, '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-t', end, out]);
  return out;
}

/** Join encoded units back to back (stream copy) and lay the audio under them. */
function join(units, out) {
  const list = `${out}.ffconcat`;
  fs.writeFileSync(list, `ffconcat version 1.0\n${units.map((u) => `file '${encoded.get(u.id).replace(/\\/g, '/')}'`).join('\n')}\n`);
  const total = units.reduce((sum, u) => sum + u.frames, 0) / FPS;
  const audio = audioTrack(units, total, `${out}.m4a`);
  const video = audio ? `${out}.video.mp4` : out;
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', video]);
  if (audio) {
    ffmpeg(['-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', '-t', total.toFixed(3), out]);
    fs.rmSync(video);
    fs.rmSync(audio);
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

// ── Web cut for the landing page (site/assets via scripts/publish-feature-tour.mjs) ──
// 1080p, narrated, small enough to commit; captions and chapters as WebVTT.
const WEB = path.join(OUT, 'web');
fs.mkdirSync(WEB, { recursive: true });
const vttTime = (s) => {
  const ms = Math.round(s * 1000);
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const ss = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${String(ms % 1000).padStart(3, '0')}`;
};
const vtt = (cues) => `WEBVTT\n\n${cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}`).join('\n\n')}\n`;

// Captions: each narration line split into sentence-sized cues, timed by length.
const voiceManifest = path.join(VOICE_DIR, 'manifest.json');
const lineText = fs.existsSync(voiceManifest)
  ? new Map(Object.values(JSON.parse(fs.readFileSync(voiceManifest, 'utf8')).clips).map((c) => [c.file, c]))
  : new Map();
const captions = [];
let offset = 0;
for (const unit of manifest.units) {
  for (const c of unit.voice ?? []) {
    const line = lineText.get(c.file);
    if (!line) continue;
    const chunks = (line.caption ?? line.text).match(/[^.!?]+[.!?]*/g).flatMap((s) => (s.length > 90 ? s.split(/(?<=,) /) : [s])).map((s) => s.trim()).filter(Boolean);
    const chars = chunks.reduce((sum, s) => sum + s.length, 0);
    let t = offset + c.at;
    for (const text of chunks) {
      const d = (line.seconds * text.length) / chars;
      captions.push({ start: t, end: t + d, text });
      t += d;
    }
  }
  offset += unit.frames / FPS;
}
// Always written (empty for a silent render) so no stale captions survive and
// publishing never finds the file missing.
fs.writeFileSync(path.join(WEB, 'feature-tour.en.vtt'), captions.length ? vtt(captions) : 'WEBVTT\n');
fs.writeFileSync(path.join(WEB, 'feature-tour.chapters.vtt'), vtt(chapterStarts.map((c, i) => ({
  start: c.at, end: i + 1 < chapterStarts.length ? chapterStarts[i + 1].at : total, text: c.title,
}))));

ffmpeg(['-i', path.join(FRAMES, manifest.poster), '-vf', 'scale=1920:1080:flags=lanczos', '-q:v', '3', path.join(WEB, 'feature-tour.jpg')]);
ffmpeg([
  '-i', tourFile,
  '-vf', 'scale=1920:1080:flags=lanczos+accurate_rnd:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-tune', 'stillimage', '-profile:v', 'high', '-g', String(FPS * 2),
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path.join(WEB, 'feature-tour.mp4'),
]);
const webMB = fs.statSync(path.join(WEB, 'feature-tour.mp4')).size / 1e6;
console.log(`web    web/feature-tour.mp4  1920x1080  ${webMB.toFixed(1)} MB`);
// GitHub warns above 50 MB per file and rejects 100 MB.
if (webMB > 50) throw new Error(`web/feature-tour.mp4 is ${webMB.toFixed(1)} MB; raise its CRF so it stays under GitHub's 50 MB warning.`);

fs.writeFileSync(path.join(OUT, 'youtube.md'), `# YouTube upload copy

Upload \`ats-fill-feature-tour.mp4\` (${width}x${height}, ${FPS} fps). A 2160p upload is
transcoded by YouTube with its higher-bitrate VP9/AV1 ladder, which keeps UI
text sharp even for viewers watching at 1080p. The 4K renditions can take a
while to appear after the upload finishes processing.

Subtitles: upload \`web/feature-tour.en.vtt\` (English) under Subtitles, so the
narration is captioned without YouTube's auto-generated track.

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
