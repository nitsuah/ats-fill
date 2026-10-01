/**
 * Feature-tour frame capture for the YouTube walkthrough (see video/README.md).
 *
 * Drives the real extension through every beat in video/storyboard.mjs and
 * renders one 1920x1080 PNG per beat, chapter title, intro and outro into
 * video-build/frames/. scripts/build-feature-video.mjs turns them into video.
 *
 * Opt-in: skipped unless ATS_FILL_VIDEO=1, so `npm run test:e2e` stays fast.
 * All data is the fictional demo fixture; the form-fill chapter runs the real
 * fill against the fictional ATS page used by fake-ats-flow.spec.mjs.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtensionContext } from './helpers/extension-context.mjs';
import { seedDemoState, DEMO_STATE, DEMO_JOBS } from './helpers/demo-state.mjs';
import { installDemoFixtures } from './helpers/demo-fixtures.mjs';
import { SEGMENTS, INTRO, OUTRO, STORE_URL, REPO_URL, SITE_URL } from '../../video/storyboard.mjs';
import { beatFrame, titleFrame, introFrame, outroFrame } from '../../video/stage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist');
const FIXTURE_PATH = path.join(__dirname, 'fixtures/fake-ats.html');
// Served from a Greenhouse board path (like the fictional demo-state jobs) so
// the content script's real host match and ATS detection run on the fixture.
const ATS_URL = 'https://boards.greenhouse.io/northstarlabs/jobs/4410388';
const OUT_DIR = path.resolve('video-build/frames');
const VIEWPORT = { width: 1280, height: 800 };
// 1.5x capture so popup text stays crisp when framed at 1236px wide in 1080p.
const HIDPI = { deviceScaleFactor: 1.5, viewport: VIEWPORT };
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
let stage;
const shots = new Map();

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

async function shoot(id, page, url) {
  const png = await page.screenshot({ type: 'png' });
  shots.set(id, { shot: `data:image/png;base64,${png.toString('base64')}`, url });
}

async function render(file, html) {
  await stage.setContent(html, { waitUntil: 'load' });
  await stage.evaluate(() => document.fonts.ready);
  await stage.screenshot({ path: path.join(OUT_DIR, file), type: 'png', scale: 'css' });
}

test.beforeAll(async () => {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  demo = await launchExtensionContext(EXTENSION_PATH, 'playwright-video-demo', HIDPI);
  await installDemoFixtures(demo.context);
  live = await launchExtensionContext(EXTENSION_PATH, 'playwright-video-live', HIDPI);
  stage = await demo.context.newPage();
  await stage.setViewportSize({ width: 1920, height: 1080 });
});

test.afterAll(async () => {
  await demo?.context.close();
  await live?.context.close();
});

test('feature tour frames', async () => {
  test.setTimeout(300_000);
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

  await popup.locator('#preview-btn').click();
  await expect(popup.locator('#preview-screen')).toBeVisible({ timeout: 10000 });
  await expect(popup.locator('#preview-content')).toContainText('Jordan Morgan');
  await shoot('fill-preview', popup, popupUrl('Preview answers'));

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
  await page.locator('#job-search-submit-btn').click();
  await expect(page.locator('.job-search-result')).toHaveCount(DEMO_JOBS.length);
  await shoot('search-results', page, popupUrl('Job search'));
  await page.locator('#job-filters-toggle').click();
  await expect(page.locator('#job-search-subbar')).toBeVisible();
  await page.locator('#pay-hide-unknown').check();
  await shoot('search-filters', page, popupUrl('Job search · Filters'));
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
  await card.click();
  await expect(page.locator('.tracker-card.expanded').first()).toBeVisible();
  await page.evaluate(() => document.querySelector('.tracker-card.expanded').scrollIntoView({ block: 'start', behavior: 'instant' }));
  await shoot('pipeline-card', page, popupUrl('Pipeline'));
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
  await openScreen(page, 'header-help-btn', 'help-screen');
  await reveal(page, '#help-data-controls-section');
  await shoot('privacy-controls', page, popupUrl('Help & privacy'));
  await page.close();

  // ── Render frames ──
  const chapters = SEGMENTS.map((s) => s.title);
  await render('intro.png', introFrame({ ...INTRO, shot: shots.get('intro-shot').shot }));
  await render('outro.png', outroFrame({ ...OUTRO, storeUrl: STORE_URL, repoUrl: REPO_URL, siteUrl: SITE_URL }));
  for (const [i, segment] of SEGMENTS.entries()) {
    await render(`title-${segment.slug}.png`, titleFrame({ chapter: i + 1, chapters, title: segment.title, summary: segment.summary }));
    for (const [j, beat] of segment.beats.entries()) {
      const captured = shots.get(beat.id);
      if (!captured) throw new Error(`No capture for storyboard beat "${beat.id}"`);
      await render(`${beat.id}.png`, beatFrame({
        ...captured,
        chapter: i + 1,
        chapterCount: SEGMENTS.length,
        chapterTitle: segment.title,
        step: j + 1,
        stepCount: segment.beats.length,
        title: beat.title,
        body: beat.body,
      }));
    }
  }
});
