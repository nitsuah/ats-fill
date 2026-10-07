import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraFor, mixCamera, project, cardTimeline, sceneTimeline, beatSeconds, frameCount, VIEW, SHOT, MAX_ZOOM,
} from '../video/timeline.mjs';
import { SEGMENTS, INTRO, TITLE_HOLD, FPS, holdSeconds } from '../video/storyboard.mjs';

const K = VIEW.w / SHOT.w;
const covers = (cam) => cam.x <= 1e-6 && cam.y <= 1e-6
  && cam.x + SHOT.w * K * cam.s >= VIEW.w - 1e-6 && cam.y + SHOT.h * K * cam.s >= VIEW.h - 1e-6;

test('cameraFor frames the focus rect and never shows past the screenshot edge', () => {
  const rects = [
    { x: 0, y: 0, width: 300, height: 200 },
    { x: 980, y: 600, width: 300, height: 200 },
    { x: 400, y: 300, width: 500, height: 260 },
  ];
  for (const rect of rects) {
    const cam = cameraFor(rect);
    assert.ok(cam.s > 1 && cam.s <= MAX_ZOOM, `zoom ${cam.s}`);
    assert.ok(covers(cam), JSON.stringify(cam));
  }
  assert.deepEqual(cameraFor(null), { s: 1, x: 0, y: 0 });
  // A focus area that already fills the window keeps the wide shot.
  assert.deepEqual(cameraFor({ x: 0, y: 0, width: 1280, height: 800 }), { s: 1, x: 0, y: 0 });
});

test('mixCamera keeps the window covered for every in-between frame', () => {
  const wide = cameraFor(null);
  const cam = cameraFor({ x: 1000, y: 650, width: 260, height: 140 });
  for (let u = 0; u <= 1; u += 0.05) assert.ok(covers(mixCamera(wide, cam, u)), `u=${u}`);
  assert.deepEqual(mixCamera(wide, cam, 1), cam);
});

test('project maps a screenshot point through the camera', () => {
  const cam = { s: 1.5, x: -100, y: -40 };
  assert.deepEqual(project({ x: 100, y: 100 }, cam), { x: 100 * K * 1.5 - 100, y: 100 * K * 1.5 - 40 });
});

test('cardTimeline dips in from paper, holds still, and dips out', () => {
  const runs = cardTimeline(4);
  assert.equal(frameCount(runs), 4 * FPS);
  assert.deepEqual(runs[0].pose, { dip: 1, rise: 0 });
  assert.equal(runs[runs.length - 1].pose.dip, 1);
  const hold = runs.reduce((best, r) => (r.frames > best.frames ? r : best));
  assert.deepEqual(hold.pose, { dip: 0, rise: 1 });
  assert.ok(hold.frames > 2 * FPS, 'the hold is a single still run');
  assert.notEqual(cardTimeline(4, { dipOut: false }).at(-1).pose.dip, 1);
});

test('sceneTimeline: zoom, crossfade and cursor click between steps', () => {
  const beats = [
    { id: 'a', title: 'A', body: 'one two three', focus: { x: 100, y: 100, width: 400, height: 300 }, click: null },
    { id: 'b', title: 'B', body: 'four five six', focus: null, click: { x: 1000, y: 60, width: 80, height: 30 } },
  ];
  const { runs, plan } = sceneTimeline(beats);
  const total = beats.reduce((sum, b) => sum + beatSeconds(b), 0);
  assert.equal(frameCount(runs), Math.round(total * FPS));
  assert.equal(runs[0].pose.dip, 1);
  assert.equal(runs.at(-1).pose.dip, 1);
  assert.ok(runs.some((r) => r.pose.shots[0].s === plan[0].cam.s && r.frames > FPS), 'holds still while zoomed');
  assert.ok(runs.some((r) => r.pose.shots.length === 2), 'crossfades inside the window');
  const press = runs.find((r) => r.pose.cur?.ring > 0);
  assert.ok(press, 'cursor clicks');
  const target = project({ x: 1040, y: 75 }, { s: 1, x: 0, y: 0 });
  assert.ok(Math.abs(press.pose.cur.x - target.x) < 0.01 && Math.abs(press.pose.cur.y - target.y) < 0.01);
  for (const r of runs) for (const s of r.pose.shots) assert.ok(covers(s), JSON.stringify(s));
});

test('sceneTimeline skips a click target that is off screen', () => {
  const beats = [
    { id: 'a', title: 'A', body: 'x', focus: null, click: null },
    { id: 'b', title: 'B', body: 'y', focus: null, click: { x: 10, y: -400, width: 80, height: 30 } },
  ];
  assert.ok(!sceneTimeline(beats).runs.some((r) => r.pose.cur));
});

test('every storyboard chapter fits its motion and runs long enough for a YouTube chapter', () => {
  assert.ok(holdSeconds(INTRO) >= 10);
  for (const segment of SEGMENTS) {
    const beats = segment.beats.map((b) => ({ ...b, focus: b.focus ? { x: 100, y: 100, width: 500, height: 300 } : null, click: null }));
    const seconds = TITLE_HOLD + frameCount(sceneTimeline(beats).runs) / FPS;
    assert.ok(seconds >= 10, `${segment.slug} is ${seconds}s`);
  }
});
