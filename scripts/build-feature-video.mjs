#!/usr/bin/env node
/**
 * Assemble the feature-tour video from frames rendered by
 * tests/e2e/feature-video.spec.mjs (see video/README.md).
 *
 * Outputs (video-build/out/):
 *   shorts/NN-<slug>.mp4      one short per feature: title card → steps → CTA
 *   ats-fill-feature-tour.mp4 combined cut: intro → each feature's title and
 *                             steps → one CTA (the per-short CTA slides are
 *                             dropped so the call to action appears once)
 *   youtube.md                title, description with chapter timestamps, tags
 *   thumbnail.jpg             1280x720 YouTube thumbnail from the intro frame
 *
 * Usage: node scripts/build-feature-video.mjs [--music track.mp3] [--frames dir] [--out dir]
 * Needs ffmpeg on PATH (or FFMPEG=/path/to/ffmpeg); the `video` Docker target has it.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEGMENTS, INTRO, OUTRO, FPS, CROSSFADE, TITLE_HOLD, STORE_URL, REPO_URL, SITE_URL, holdSeconds,
} from '../video/storyboard.mjs';

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

/** Frame file → clip with a slow 3% push-in. Reused across cuts and across runs while the frame is unchanged. */
const clipCache = new Map();
function clip(id, seconds) {
  const key = `${id}@${seconds}`;
  if (clipCache.has(key)) return clipCache.get(key);
  const png = path.join(FRAMES, `${id}.png`);
  if (!fs.existsSync(png)) throw new Error(`Missing frame ${png}; run the feature-video capture first.`);
  const out = path.join(OUT, 'clips', `${id}-${seconds}s.mp4`);
  const frames = Math.round(seconds * FPS);
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(png).mtimeMs) {
    // zoompan steps in whole pixels; render it at 2x and downscale so the push-in doesn't shimmer.
    ffmpeg([
      '-loop', '1', '-framerate', String(FPS), '-t', String(seconds), '-i', png,
      '-vf', [
        'scale=3840:2160:flags=lanczos',
        `zoompan=z='1+0.03*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=3840x2160:fps=${FPS}`,
        'scale=1920:1080:flags=lanczos',
        'format=yuv420p',
      ].join(','),
      '-frames:v', String(frames),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-r', String(FPS), out,
    ]);
  }
  const entry = { file: out, seconds };
  clipCache.set(key, entry);
  return entry;
}

const ENCODE = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
// Transitions dip through the paper background (#f4efe6 → BT.709 TV range Y 219, U 124, V 131)
// instead of crossfading, so two busy layouts never double-expose. xfade's P
// runs 1 → 0: the first half fades A out to paper, the second fades B in.
const PAPER = "if(eq(PLANE,0),219,if(eq(PLANE,1),124,131))";
const DIP = `transition=custom:expr='if(gt(P,0.5),A*(2*P-1)+${PAPER}*(2-2*P),B*(1-2*P)+${PAPER}*(2*P))'`;

// Each xfade input holds a 1080p decoder; past ~10 inputs ffmpeg runs out of
// memory in a default Docker VM and silently truncates the output.
const MAX_INPUTS = 8;

function probeSeconds(file) {
  const ffprobe = process.env.FFPROBE || FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  return Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
}

/** Crossfade up to MAX_INPUTS clips into one video-only file. */
function crossfade(clips, out) {
  const filters = [];
  let elapsed = clips[0].seconds;
  let last = '0:v';
  for (let i = 1; i < clips.length; i += 1) {
    const offset = elapsed - CROSSFADE;
    filters.push(`[${last}][${i}:v]xfade=${DIP}:duration=${CROSSFADE}:offset=${offset.toFixed(3)}[v${i}]`);
    last = `v${i}`;
    elapsed = offset + clips[i].seconds;
  }
  ffmpeg([
    ...clips.flatMap((c) => ['-i', c.file]),
    ...(filters.length ? ['-filter_complex', filters.join(';'), '-map', `[${last}]`] : ['-map', '0:v']),
    ...ENCODE, '-t', elapsed.toFixed(3), out,
  ]);
  return { file: out, seconds: elapsed };
}

/** Crossfade any number of clips (in chunks), add optional music; returns when each clip starts fading in. */
function join(clips, out) {
  // Chunking doesn't move anything: every boundary, inside a chunk or between
  // chunks, overlaps by exactly one CROSSFADE.
  const starts = [];
  let elapsed = 0;
  clips.forEach((c, i) => {
    const start = i ? elapsed - CROSSFADE : 0;
    starts.push(start);
    elapsed = start + c.seconds;
  });

  const tmp = `${out}.parts`;
  fs.mkdirSync(tmp, { recursive: true });
  let level = clips;
  for (let round = 0; level.length > 1; round += 1) {
    const next = [];
    for (let i = 0; i < level.length; i += MAX_INPUTS) {
      next.push(crossfade(level.slice(i, i + MAX_INPUTS), path.join(tmp, `r${round}-${i}.mp4`)));
    }
    level = next;
  }
  const video = level[0].file;

  if (MUSIC) {
    ffmpeg([
      '-i', video, '-stream_loop', '-1', '-i', MUSIC,
      '-filter_complex', `[1:a]atrim=0:${elapsed.toFixed(3)},afade=t=in:d=1,afade=t=out:st=${Math.max(0, elapsed - 2.5).toFixed(3)}:d=2.5,volume=0.7[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-t', elapsed.toFixed(3), out,
    ]);
  } else {
    ffmpeg(['-i', video, '-c', 'copy', '-movflags', '+faststart', out]);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  const actual = probeSeconds(out);
  if (Math.abs(actual - elapsed) > 0.25) {
    throw new Error(`${path.basename(out)} is ${actual.toFixed(2)}s but the storyboard needs ${elapsed.toFixed(2)}s; ffmpeg likely dropped input.`);
  }
  return { starts, total: elapsed };
}

const stamp = (s) => {
  const t = Math.floor(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

fs.mkdirSync(path.join(OUT, 'clips'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'shorts'), { recursive: true });

const intro = () => clip('intro', holdSeconds(INTRO));
const outro = () => clip('outro', holdSeconds(OUTRO));
const title = (s) => clip(`title-${s.slug}`, TITLE_HOLD);
const beats = (s) => s.beats.map((b) => clip(b.id, holdSeconds(b)));

// Per-feature shorts: each stands alone, so each ends on the call to action.
const shorts = [];
for (const [i, segment] of SEGMENTS.entries()) {
  const file = path.join(OUT, 'shorts', `${String(i + 1).padStart(2, '0')}-${segment.slug}.mp4`);
  const { total } = join([title(segment), ...beats(segment), outro()], file);
  shorts.push({ segment, file, total });
  console.log(`short  ${path.relative(OUT, file)}  ${stamp(total)}`);
}

// Combined cut: the shorts back to back, minus every per-short CTA, with one
// intro up front and a single CTA at the end.
const sequence = [{ chapter: 'Intro', clip: intro() }];
for (const segment of SEGMENTS) {
  sequence.push({ chapter: segment.title, clip: title(segment) });
  for (const c of beats(segment)) sequence.push({ clip: c });
}
sequence.push({ clip: outro() });
const tourFile = path.join(OUT, 'ats-fill-feature-tour.mp4');
const { starts, total } = join(sequence.map((s) => s.clip), tourFile);
console.log(`tour   ${path.relative(OUT, tourFile)}  ${stamp(total)}`);

const chapterStarts = sequence
  .map((s, i) => (s.chapter ? { title: s.chapter, at: Math.floor(i === 0 ? 0 : starts[i] + CROSSFADE) } : null))
  .filter(Boolean);
// YouTube ignores the whole chapter list if any chapter is shorter than 10s.
chapterStarts.forEach((c, i) => {
  const end = i + 1 < chapterStarts.length ? chapterStarts[i + 1].at : total;
  if (end - c.at < 10) throw new Error(`Chapter "${c.title}" is ${end - c.at}s; YouTube needs at least 10s per chapter.`);
});
const chapters = chapterStarts.map((c) => `${stamp(c.at)} ${c.title}`);

ffmpeg(['-i', path.join(FRAMES, 'intro.png'), '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '3', path.join(OUT, 'thumbnail.jpg')]);

fs.writeFileSync(path.join(OUT, 'youtube.md'), `# YouTube upload copy

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

${shorts.map((s) => `- \`shorts/${path.basename(s.file)}\` (${stamp(s.total)}): ${s.segment.title}. ${s.segment.summary}`).join('\n')}
`);
console.log(`\nChapters:\n${chapters.join('\n')}\n\nWrote ${path.relative(process.cwd(), OUT)}/youtube.md and thumbnail.jpg`);
