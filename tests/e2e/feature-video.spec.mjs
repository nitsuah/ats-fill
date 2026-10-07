/**
 * Feature-tour frame capture for the YouTube walkthrough (see video/README.md).
 *
 * Drives the real extension through every beat in video/storyboard.mjs,
 * capturing each screen at 3x along with the rects the camera zooms to and
 * the cursor clicks, then renders every distinct video frame at 3840x2160
 * (video/timeline.mjs plans the motion) into video-build/frames/<unit>/ with a
 * manifest.json. scripts/build-feature-video.mjs encodes them.
 *
 * Opt-in: skipped unless ATS_FILL_VIDEO=1, so `npm run test:e2e` stays fast.
 * All data is the fictional demo fixture; the form-fill chapter runs the real
 * fill against the fictional ATS page used by fake-ats-flow.spec.mjs.
 */
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtensionContext } from './helpers/extension-context.mjs';
import { seedDemoState, DEMO_STATE, DEMO_JOBS } from './helpers/demo-state.mjs';
import { installDemoFixtures } from './helpers/demo-fixtures.mjs';
import {
  SEGMENTS, INTRO, OUTRO, STORE_URL, REPO_URL, SITE_URL, FPS, SCALE, TITLE_HOLD, holdSeconds,
} from '../../video/storyboard.mjs';
import { sceneFrame, titleFrame, introFrame, outroFrame } from '../../video/stage.mjs';
import { cardTimeline, sceneTimeline, SHOT } from '../../video/timeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist');
const FIXTURE_PATH = path.join(__dirname, 'fixtures/fake-ats.html');
// Served from a Greenhouse board path (like the fictional demo-state jobs) so
// the content script's real host match and ATS detection run on the fixture.
const ATS_URL = 'https://boards.greenhouse.io/northstarlabs/jobs/4410388';
const OUT_DIR = path.resolve('video-build/frames');
const VIEWPORT = { width: SHOT.w, height: SHOT.h };
// 3x capture (3840x2400): the window is 2472px wide in the 4K frame, so the
// camera can zoom ~1.55x into a step before any pixel is upscaled. Grayscale
// text antialiasing avoids colour fringes that chroma subsampling smears.
const HIDPI = { deviceScaleFactor: 3, viewport: VIEWPORT, args: ['--disable-lcd-text'] };
const BEATS = new Map(SEGMENTS.flatMap((s) => s.beats).map((b) => [b.id, b]));
const STABLE_STYLE = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

// The fill chapter's answers, matching the fictional ATS form's fields.
const FILL_ANSWERS = {
  first_name: 'Jordan',
  last_name: 'Morgan',
  full_name: 'Jordan Morgan',
  email: 'jordan.morgan@example.test',
  phone: '(555) 010-0142',
  location: 'Arlington, VA',
  linkedin: 'https://www.linkedin.com/in/jordan-morgan-demo',
  current_title: 'Systems Engineer',
  current_company: 'Northstar Labs',
  years_of_experience: '10',
  work_authorization: 'Yes',
  desired_salary_min: '165000',
  why_role: 'The role combines cloud reliability, automation, and developer tooling with a product-focused engineering team.',
};

test.skip(!process.env.ATS_FILL_VIDEO, 'Set ATS_FILL_VIDEO=1 to render feature-tour frames');

let demo;
let live;
let stageBrowser;
let stage;
let cdp;
const shots = new Map();
const clicks = new Map();
const stageErrors = [];

async function stabilize(page) {
  await page.addStyleTag({ content: STABLE_STYLE });
  await page.evaluate(() => document.fonts.ready);
}

async function openPopup({ colorScheme = 'light' } = {}) {
  const page = await demo.context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
  await page.goto(`chrome-extension://${demo.extensionId}/popup/popup.html?standalone=1`);
  await seedDemoState(page);
  await page.reload();
  await expect(page.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });
  await stabilize(page);
  return page;
}

async function openScreen(page, buttonId, screenId) {
  await page.locator(`#${buttonId}`).click();
  await expect(page.locator(`#${screenId}`)).toBeVisible({ timeout: 10000 });
}

/** Open any collapsed <details> around or inside `selector` and scroll it to the top. */
async function reveal(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`reveal: ${sel} not found`);
    for (let node = el; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS') node.open = true;
    }
    el.querySelectorAll('details').forEach((d) => { d.open = true; });
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, selector);
}

/** Visible part of the first match, in screenshot CSS px, or null. */
async function rectOf(target) {
  const box = await target.first().boundingBox();
  if (!box) return null;
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const width = Math.min(SHOT.w, box.x + box.width) - x;
  const height = Math.min(SHOT.h, box.y + box.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

async function shoot(id, page, url) {
  const png = await page.screenshot({ type: 'png' });
  const selector = BEATS.get(id)?.focus;
  const focus = selector ? await rectOf(page.locator(selector)) : null;
  if (selector && !focus) throw new Error(`Focus "${selector}" for "${id}" is not on screen`);
  shots.set(id, { shot: `data:image/png;base64,${png.toString('base64')}`, url, focus });
}

/** Record where the cursor clicks (on the current screen) to reach step `nextId`. */
async function aim(nextId, target) {
  const box = await target.first().boundingBox();
  clicks.set(nextId, box && { x: box.x, y: box.y, width: box.width, height: box.height });
}

/** Render each distinct pose once; the manifest says how many frames it holds. */
async function renderRuns(dir, html, runs, offset = 0) {
  stageErrors.length = 0;
  await stage.setContent(html, { waitUntil: 'load' });
  if (stageErrors.length) throw new Error(`Stage template for ${dir} failed: ${stageErrors.join('; ')}`);
  await stage.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map((img) => img.decode())]));
  fs.mkdirSync(path.join(OUT_DIR, dir), { recursive: true });
  const entries = [];
  for (const [n, run] of runs.entries()) {
    await stage.evaluate((p) => {
      window.pose(p);
      return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    }, run.pose);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    const file = path.join(dir, `${String(offset + n).padStart(5, '0')}.png`);
    fs.writeFileSync(path.join(OUT_DIR, file), Buffer.from(data, 'base64'));
    entries.push({ file, frames: run.frames });
  }
  return entries;
}

test.beforeAll(async () => {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  demo = await launchExtensionContext(EXTENSION_PATH, 'playwright-video-demo', HIDPI);
  await installDemoFixtures(demo.context);
  live = await launchExtensionContext(EXTENSION_PATH, 'playwright-video-live', HIDPI);
  stageBrowser = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'] });
  stage = await stageBrowser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE });
  stage.on('pageerror', (err) => stageErrors.push(err.message));
  cdp = await stage.context().newCDPSession(stage);
});

test.afterAll(async () => {
  await demo?.context.close();
  await live?.context.close();
  await stageBrowser?.close();
});

test('feature tour frames', async () => {
  test.setTimeout(60 * 60_000);
  const popupUrl = (screen) => `ats-fill · ${screen}`;

  // ── Profile ──
  let page = await openPopup();
  await shoot('intro-shot', page, '');
  await openScreen(page, 'header-profile-btn', 'setup-screen');
  await reveal(page, '#profile-resume-section');
  await shoot('profile-resume', page, popupUrl('Profile'));
  await reveal(page, '#profile-memory-section');
  await expect(page.locator('#learned-defaults-list .memory-bubble').first()).toBeVisible();
  await shoot('profile-memory', page, popupUrl('Profile · Memory'));
  await page.close();

  // ── Form fill (real fill against the fictional ATS page) ──
  const html = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const ats = await live.context.newPage();
  await ats.route(ATS_URL, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await ats.goto(ATS_URL);
  await expect(ats.locator('#application-form')).toBeVisible();
  await stabilize(ats);
  const atsLabel = ATS_URL.replace('https://', '');
  await shoot('fill-ats-page', ats, atsLabel);

  const popup = await live.context.newPage();
  await popup.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await popup.goto(`chrome-extension://${live.extensionId}/popup/popup.html?standalone=1`);
  await popup.evaluate(async (state) => {
    await chrome.storage.local.clear();
    const { lastFillReport: _report, ...rest } = state;
    await chrome.storage.local.set({ ...rest, lastAnswers: state.fillAnswers });
  }, { ...DEMO_STATE, fillAnswers: FILL_ANSWERS });
  await ats.bringToFront();
  await popup.reload();
  await expect(popup.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });
  await stabilize(popup);
  await shoot('fill-dashboard', popup, popupUrl('Home'));

  await aim('fill-preview', popup.locator('#preview-btn'));
  await popup.locator('#preview-btn').click();
  await expect(popup.locator('#preview-screen')).toBeVisible({ timeout: 10000 });
  await expect(popup.locator('#preview-content')).toContainText('Jordan Morgan');
  await shoot('fill-preview', popup, popupUrl('Preview answers'));

  await aim('fill-filled', popup.locator('#inject-from-preview-btn'));
  await popup.locator('#inject-from-preview-btn').click();
  await expect(ats.locator('#why-role')).toHaveValue(/cloud reliability/);
  await ats.evaluate(() => document.querySelector('#application-form').scrollIntoView({ block: 'start', behavior: 'instant' }));
  await shoot('fill-filled', ats, atsLabel);
  await popup.close();
  await ats.close();

  // ── Job search ──
  page = await openPopup();
  await openScreen(page, 'header-job-search-btn', 'job-search-screen');
  await expect(page.locator('.job-source-chip').first()).toBeVisible();
  await page.locator('#job-search-input').fill('platform engineer');
  await shoot('search-sources', page, popupUrl('Job search'));
  await aim('search-results', page.locator('#job-search-submit-btn'));
  await page.locator('#job-search-submit-btn').click();
  await expect(page.locator('.job-search-result')).toHaveCount(DEMO_JOBS.length);
  await shoot('search-results', page, popupUrl('Job search'));
  await aim('search-filters', page.locator('#job-filters-toggle'));
  await page.locator('#job-filters-toggle').click();
  await expect(page.locator('#job-search-subbar')).toBeVisible();
  await page.locator('#pay-hide-unknown').check();
  await shoot('search-filters', page, popupUrl('Job search · Filters'));
  await aim('search-custom-sources', page.locator('#header-ai-btn'));
  await openScreen(page, 'header-ai-btn', 'ai-screen');
  await reveal(page, '#job-sources-section');
  await shoot('search-custom-sources', page, popupUrl('Settings · Job sources'));
  await page.close();

  // ── Pipeline ──
  page = await openPopup();
  await openScreen(page, 'header-tracker-btn', 'tracker-screen');
  await expect(page.locator('.tracker-card').first()).toBeVisible();
  await shoot('pipeline-board', page, popupUrl('Pipeline'));
  const card = page.locator('.tracker-card:not(.expanded) .tracker-card-toggle').first();
  await aim('pipeline-card', card);
  await card.click();
  await expect(page.locator('.tracker-card.expanded').first()).toBeVisible();
  await page.evaluate(() => document.querySelector('.tracker-card.expanded').scrollIntoView({ block: 'start', behavior: 'instant' }));
  await shoot('pipeline-card', page, popupUrl('Pipeline'));
  await aim('pipeline-add', page.locator('#add-application-btn'));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.locator('#add-application-btn').click();
  await expect(page.locator('#tracker-add-card')).toBeVisible();
  await page.locator('#new-application-company').fill('Lumen Grid');
  await page.locator('#new-application-title').fill('Senior Infrastructure Engineer');
  await page.locator('#new-application-location').fill('Remote · US');
  await page.locator('#new-application-salary-range').fill('$170,000 – $200,000');
  await page.locator('#new-application-description').fill('Lumen Grid is hiring a senior infrastructure engineer to scale the platform behind real-time energy-grid forecasting: Kubernetes, Terraform, and observability for 40 services.');
  await reveal(page, '#tracker-add-card');
  await shoot('pipeline-add', page, popupUrl('Pipeline · Add job'));
  await page.close();

  page = await openPopup({ colorScheme: 'dark' });
  await openScreen(page, 'header-tracker-btn', 'tracker-screen');
  await expect(page.locator('.tracker-card').first()).toBeVisible();
  await shoot('pipeline-dark', page, popupUrl('Pipeline'));
  await page.close();

  // ── Interview prep ──
  page = await openPopup();
  await openScreen(page, 'header-interview-prep-btn', 'interview-prep-screen');
  await expect(page.locator('.interview-prep-question-card').first()).toBeVisible();
  await shoot('prep-questions', page, popupUrl('Interview prep'));
  const answer = page.locator('.interview-prep-answer-input').nth(1);
  await aim('prep-answer', answer);
  await answer.fill('Situation: our deploy pipeline failed one release in five.\nTask: I owned getting it under 1%.\nAction: added canary stages, automated rollback and a flaky-test quarantine.\nResult: failures dropped to 0.4% within a quarter, and on-call pages halved.');
  await page.evaluate(() => document.querySelectorAll('.interview-prep-question-card')[1].scrollIntoView({ block: 'center', behavior: 'instant' }));
  await shoot('prep-answer', page, popupUrl('Interview prep'));
  await page.close();

  // ── Analytics ──
  page = await openPopup();
  await openScreen(page, 'header-analytics-btn', 'analytics-screen');
  await expect(page.locator('.analytics-stat').first()).toBeVisible();
  await shoot('analytics-overview', page, popupUrl('Analytics'));
  await page.evaluate(() => {
    const sections = document.querySelectorAll('#analytics-body > *');
    sections[Math.min(2, sections.length - 1)]?.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  await shoot('analytics-detail', page, popupUrl('Analytics'));
  await page.close();

  // ── Privacy ──
  page = await openPopup();
  await openScreen(page, 'header-ai-btn', 'ai-screen');
  await reveal(page, '#profile-api-section');
  await shoot('privacy-byok', page, popupUrl('Settings · AI'));
  await aim('privacy-controls', page.locator('#header-help-btn'));
  await openScreen(page, 'header-help-btn', 'help-screen');
  await reveal(page, '#help-data-controls-section');
  await shoot('privacy-controls', page, popupUrl('Help & privacy'));
  await page.close();

  // ── Render frames ──
  // Units are encoded separately and joined on full-paper frames, so the
  // shorts and the combined cut reuse the same encodes (see the build script).
  const chapters = SEGMENTS.map((seg) => seg.title);
  const units = [];
  const started = Date.now();
  const unit = async (id, kind, parts, extra = {}) => {
    const entries = [];
    for (const [html, runs] of parts) entries.push(...await renderRuns(id, html, runs, entries.length));
    const frames = entries.reduce((sum, e) => sum + e.frames, 0);
    units.push({ id, kind, frames, entries, ...extra });
    console.log(`frames  ${id}: ${entries.length} renders, ${(frames / FPS).toFixed(1)}s (${Math.round((Date.now() - started) / 1000)}s elapsed)`);
  };

  await unit('intro', 'intro', [
    [introFrame({ ...INTRO, shot: shots.get('intro-shot').shot }), cardTimeline(holdSeconds(INTRO))],
  ], { title: 'Intro' });
  for (const [i, segment] of SEGMENTS.entries()) {
    const beats = segment.beats.map((beat) => {
      const captured = shots.get(beat.id);
      if (!captured) throw new Error(`No capture for storyboard beat "${beat.id}"`);
      return { ...beat, ...captured, click: clicks.get(beat.id) ?? null };
    });
    await unit(`${String(i + 1).padStart(2, '0')}-${segment.slug}`, 'chapter', [
      [titleFrame({ chapter: i + 1, chapters, title: segment.title, summary: segment.summary }), cardTimeline(TITLE_HOLD)],
      [sceneFrame({ chapter: i + 1, chapterCount: SEGMENTS.length, chapterTitle: segment.title, beats }), sceneTimeline(beats).runs],
    ], { title: segment.title, slug: segment.slug, summary: segment.summary });
  }
  await unit('outro', 'outro', [
    [outroFrame({ ...OUTRO, storeUrl: STORE_URL, repoUrl: REPO_URL, siteUrl: SITE_URL }), cardTimeline(holdSeconds(OUTRO), { dipOut: false })],
  ]);

  // Thumbnail source: the intro's long hold, once everything has risen in.
  const poster = units[0].entries.reduce((best, e) => (e.frames > best.frames ? e : best)).file;
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
    fps: FPS, width: 1920 * SCALE, height: 1080 * SCALE, poster, units,
  }, null, 2));
});
