/**
 * Motion timeline for the feature tour: turns storyboard beats plus the rects
 * measured during capture into one pose per video frame. Poses are plain JSON
 * that the stage templates (video/stage.mjs) apply with `window.pose(p)`, so
 * every frame is a sharp browser render at the output resolution instead of an
 * ffmpeg resample of a still.
 *
 * Consecutive identical poses are merged into one entry with a frame count, so
 * static holds cost a single render and encode as a perfectly still image
 * (which is what keeps text crisp after YouTube re-encodes it).
 *
 * Pure functions only; tests/video-timeline.test.mjs covers them.
 */
import { FPS, holdSeconds } from './storyboard.mjs';

/** Product window inside the 1920x1080 stage (CSS px), see video/stage.mjs. */
export const VIEW = { w: 1236, h: 772 };
/** Viewport the product screenshots are captured at (CSS px). */
export const SHOT = { w: 1280, h: 800 };
const K = VIEW.w / SHOT.w;

export const TIMING = {
  dip: 0.4, // fade from / to paper at the start and end of every unit
  rise: 0.8, // title-card entrance (runs alongside the dip-in)
  swap: 0.55, // crossfade between two steps of the same chapter
  settle: 0.6, // look at the whole screen before zooming in
  zoomIn: 1.0,
  zoomOut: 0.75,
  travel: 0.85, // cursor glides to the next click target
  press: 0.4, // click ripple
  cursorFade: 0.45,
  stamp: 0.35,
  minHold: 2.5,
};
/** Extra seconds per step for the motion, on top of the reading time. */
export const MOTION_PAD = 1.5;
/** Never zoom past this: the 3x captures stay at or above 1:1 pixels up to ~1.55x. */
export const MAX_ZOOM = 1.7;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, u) => a + (b - a) * u;
export const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2);
const r = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

const WIDE = { s: 1, x: 0, y: 0 };

/**
 * Camera that frames `rect` (screenshot CSS px) inside the product window.
 * `s` scales the screenshot, `x`/`y` translate it (window CSS px). The
 * screenshot always covers the window, so no empty edge ever shows.
 */
export function cameraFor(rect) {
  if (!rect) return WIDE;
  const rw = rect.width * K;
  const rh = rect.height * K;
  const s = clamp(Math.min((VIEW.w * 0.86) / rw, (VIEW.h * 0.82) / rh, MAX_ZOOM), 1, MAX_ZOOM);
  if (s < 1.08) return WIDE;
  const cx = (rect.x + rect.width / 2) * K;
  const cy = (rect.y + rect.height / 2) * K;
  return {
    s,
    x: clamp(VIEW.w / 2 - cx * s, VIEW.w - SHOT.w * K * s, 0),
    y: clamp(VIEW.h / 2 - cy * s, VIEW.h - SHOT.h * K * s, 0),
  };
}

/**
 * Interpolate two cameras so the zoom feels constant-speed (log scale) and the
 * framed point moves in a straight line. Because 1/s is convex in u, the
 * visible area stays inside the screenshot whenever both ends do.
 */
export function mixCamera(a, b, u) {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const s = Math.exp(lerp(Math.log(a.s), Math.log(b.s), u));
  const ca = { x: (VIEW.w / 2 - a.x) / a.s, y: (VIEW.h / 2 - a.y) / a.s };
  const cb = { x: (VIEW.w / 2 - b.x) / b.s, y: (VIEW.h / 2 - b.y) / b.s };
  const cx = lerp(ca.x, cb.x, u);
  const cy = lerp(ca.y, cb.y, u);
  return { s, x: VIEW.w / 2 - cx * s, y: VIEW.h / 2 - cy * s };
}

/** Screenshot point (CSS px) → window point under camera `cam`. */
export function project(point, cam) {
  return { x: point.x * K * cam.s + cam.x, y: point.y * K * cam.s + cam.y };
}

const center = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const inShot = (rect) => rect && rect.width > 0 && rect.height > 0
  && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= SHOT.w && rect.y + rect.height <= SHOT.h;

/** Merge per-frame poses into [{ pose, frames }] runs. */
function runs(poses) {
  const out = [];
  let last = '';
  for (const pose of poses) {
    const key = JSON.stringify(pose);
    if (key === last) out[out.length - 1].frames += 1;
    else out.push({ pose, frames: 1 });
    last = key;
  }
  return out;
}

const frames = (seconds) => Math.round(seconds * FPS);

/**
 * A static card (intro, chapter title, call to action): dip in from paper while
 * the content rises into place, hold, dip out (unless it ends the video).
 */
export function cardTimeline(seconds, { dipOut = true } = {}) {
  const total = frames(seconds);
  const poses = [];
  for (let f = 0; f < total; f += 1) {
    const t = f / FPS;
    const tail = seconds - t - 1 / FPS;
    let dip = clamp(1 - t / TIMING.dip, 0, 1);
    if (dipOut) dip = Math.max(dip, clamp(1 - tail / TIMING.dip, 0, 1));
    poses.push({ dip: r(ease(dip)), rise: r(ease(clamp(t / TIMING.rise, 0, 1))) });
  }
  return runs(poses);
}

/** Seconds a step stays on screen, including its motion. */
export const beatSeconds = (beat) => holdSeconds(beat) + MOTION_PAD;

/**
 * Plan one chapter's steps. Each step: enter (dip from paper for the first,
 * otherwise a crossfade inside the same window), look at the whole screen,
 * zoom into its focus area, hold, then zoom back out while the cursor travels
 * to whatever is clicked to reach the next step, and click it.
 *
 * `beats`: [{ id, hold?, title, body, focus: rect|null, click: rect|null }]
 * where `click` is measured on the *previous* step's screenshot.
 */
export function planScene(beats) {
  const T = TIMING;
  let t = 0;
  return beats.map((beat, i) => {
    const next = beats[i + 1];
    const start = t;
    const duration = beatSeconds(beat);
    const enter = i === 0 ? T.dip : T.swap;
    const cam = cameraFor(beat.focus);
    const zoomed = cam !== WIDE;
    const click = next && inShot(next.click) ? center(next.click) : null;
    const exit = !next ? T.dip : click ? T.travel + T.press : zoomed ? T.zoomOut : 0;
    const zoomAt = start + enter + T.settle;
    const exitAt = start + duration - exit;
    if (exitAt - (zoomed ? zoomAt + T.zoomIn : start + enter) < T.minHold) {
      throw new Error(`Step "${beat.id}" is too short for its motion; give it a longer hold.`);
    }
    t += duration;
    return { index: i, beat, start, end: t, cam, zoomed, click, zoomAt, exitAt, last: !next };
  });
}

/** Frames for one chapter's steps (the window + caption scene). */
export function sceneTimeline(beats) {
  const T = TIMING;
  const plan = planScene(beats);
  const total = plan[plan.length - 1].end;
  const rest = { x: VIEW.w * 0.82, y: VIEW.h * 0.9 };
  const poses = [];
  let cursor = { ...rest };

  for (let f = 0, n = frames(total); f < n; f += 1) {
    const t = f / FPS;
    const step = plan.find((p) => t < p.end) ?? plan[plan.length - 1];
    const prev = plan[step.index - 1];

    // Camera for the current step: wide → (zoom in) → focus → (zoom out) → wide.
    const camAt = (p, time) => {
      if (!p.zoomed) return WIDE;
      if (time < p.zoomAt) return WIDE;
      const zin = ease(clamp((time - p.zoomAt) / T.zoomIn, 0, 1));
      if (time < p.exitAt || p.last) return mixCamera(WIDE, p.cam, zin);
      const out = p.click ? T.travel : T.zoomOut;
      return mixCamera(p.cam, WIDE, ease(clamp((time - p.exitAt) / out, 0, 1)));
    };
    const cam = camAt(step, t);

    // Crossfade from the previous step (its last pose is wide) into this one.
    const swap = prev ? clamp((t - step.start) / T.swap, 0, 1) : 1;
    const mix = ease(swap);
    const shots = [];
    if (prev && swap < 1) shots.push({ i: prev.index, o: 1, ...roundCam(WIDE) });
    shots.push({ i: step.index, o: r(prev ? mix : 1), ...roundCam(cam) });
    const caps = [];
    if (prev && swap < 1) caps.push({ i: prev.index, o: r(1 - mix), dy: r(-14 * mix, 2) });
    caps.push({ i: step.index, o: r(prev ? mix : 1), dy: r(prev ? 14 * (1 - mix) : 0, 2) });

    // Dip from / to paper at the edges of the scene.
    let dip = step.index === 0 ? clamp(1 - (t - step.start) / T.dip, 0, 1) : 0;
    if (step.last) dip = Math.max(dip, clamp(1 - (total - t - 1 / FPS) / T.dip, 0, 1));

    // Cursor: glides to the click target while the camera eases out, presses,
    // rides the crossfade into the next step, then fades away.
    let cur = null;
    if (step.click && t >= step.exitAt) {
      const u = clamp((t - step.exitAt) / T.travel, 0, 1);
      const target = project(step.click, cam);
      const pos = { x: lerp(cursor.x, target.x, ease(u)), y: lerp(cursor.y, target.y, ease(u)) };
      const p = clamp((t - step.exitAt - T.travel) / T.press, 0, 1);
      cur = { ...pos, o: r(clamp(u * 3, 0, 1)), p: r(p > 0 ? Math.sin(p * Math.PI) : 0), ring: r(p) };
      if (u >= 1) cursor = target;
    } else if (prev?.click) {
      const since = t - step.start;
      const o = clamp(1 - (since - T.swap) / T.cursorFade, 0, 1);
      if (o > 0) cur = { ...prev.clickAt, o: r(o), p: 0 };
    }
    if (step.click && t >= step.exitAt + T.travel) step.clickAt = { x: r(cursor.x, 2), y: r(cursor.y, 2) };
    if (cur) {
      cur.x = r(cur.x, 2);
      cur.y = r(cur.y, 2);
      if (cur.ring >= 1) delete cur.ring;
    }

    // Rubber stamp (as in the launch video) lands once the step is in focus.
    if (step.beat.stamp) {
      const at = step.zoomed ? step.zoomAt + T.zoomIn + 0.15 : step.start + T.swap + T.settle;
      const u = clamp((t - at) / T.stamp, 0, 1);
      if (u > 0) shots[shots.length - 1].st = r(u);
    }

    poses.push({ dip: r(ease(dip)), shots, caps, ...(cur ? { cur } : {}) });
  }
  return { runs: runs(poses), plan };
}

function roundCam(cam) {
  return { s: r(cam.s, 4), x: r(cam.x, 2), y: r(cam.y, 2) };
}

/** Total frames in a list of runs. */
export const frameCount = (list) => list.reduce((sum, run) => sum + run.frames, 0);
