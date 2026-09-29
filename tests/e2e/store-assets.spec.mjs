/**
 * Chrome Web Store asset capture.
 * Produces five 1280x800 JPEG screenshots plus 440x280 and 1400x560 promo tiles.
 * All data comes from the deterministic fictional Playwright fixture.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { launchExtensionContext } from './helpers/extension-context.mjs';
import { seedDemoState, DEMO_NOW, DEMO_JOBS, DEMO_SEARCH_SOURCES, DEMO_ACTIVE_TAB } from './helpers/demo-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist');
const OUT_DIR = path.resolve('store-assets');
const STORE_VIEWPORT = { width: 1280, height: 800 };
const STABLE_STYLE = [
  '*, *::before, *::after {',
  'animation: none !important;',
  'transition: none !important;',
  'caret-color: transparent !important;',
  '}',
].join('\n');

let context;
let extensionId;

async function openPopup(viewport = STORE_VIEWPORT) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('chrome-extension://' + extensionId + '/popup/popup.html?standalone=1');
  await seedDemoState(page);
  await page.reload();
  await expect(page.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });
  await page.addStyleTag({ content: STABLE_STYLE });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  return page;
}

async function openScreen(page, buttonId, screenId) {
  await page.locator('#' + buttonId).click();
  await expect(page.locator('#' + screenId)).toBeVisible({ timeout: 10000 });
}

async function captureStoreScreenshot(page, filename) {
  await page.screenshot({ path: path.join(OUT_DIR, filename), type: 'jpeg', quality: 92 });
}

function promoMarkup(width, height, title, eyebrow, body, imageData) {
  const wide = width >= 1000;
  const copyWidth = wide ? 440 : 150;
  const imageWidth = wide ? 790 : 250;
  const imageHeight = wide ? 494 : 156;
  const pad = wide ? 70 : 30;
  const top = wide ? 72 : 28;
  const fontTitle = wide ? 54 : 24;
  const fontBody = wide ? 19 : 11;
  const fontEyebrow = wide ? 17 : 11;
  return [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    '*{box-sizing:border-box}html,body{margin:0;width:' + width + 'px;height:' + height + 'px}',
    'body{background:#f4efe6;color:#191816;font-family:Arial,sans-serif;overflow:hidden}',
    '.tile{width:100%;height:100%;padding:' + pad + 'px;position:relative;overflow:hidden;background:radial-gradient(circle at 92% 12%,rgba(196,65,26,.10),transparent 27%),#f4efe6}',
    '.copy{position:absolute;left:' + pad + 'px;top:' + top + 'px;width:' + copyWidth + 'px}',
    '.eyebrow{margin:0 0 14px;color:#c4411a;font-size:' + fontEyebrow + 'px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}',
    'h1{white-space:pre-line;margin:0 0 14px;font-family:Georgia,serif;font-size:' + fontTitle + 'px;line-height:.98;letter-spacing:-.025em}',
    'p{margin:0;color:#5f5a51;font-size:' + fontBody + 'px;line-height:1.4}',
    '.brand{position:absolute;right:' + pad + 'px;top:' + (wide ? 58 : 28) + 'px;font-size:' + (wide ? 20 : 12) + 'px;font-weight:800}',
    '.shot{position:absolute;right:' + (wide ? 55 : 24) + 'px;bottom:' + (wide ? -30 : -6) + 'px;width:' + imageWidth + 'px;height:' + imageHeight + 'px;border:1px solid rgba(25,24,22,.15);border-radius:' + (wide ? 16 : 9) + 'px;box-shadow:0 20px 45px rgba(25,24,22,.18);overflow:hidden;background:#fff}',
    '.shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:top left}',
    '.rule{position:absolute;left:' + pad + 'px;bottom:' + (wide ? 55 : 22) + 'px;width:' + (wide ? 350 : 125) + 'px;height:3px;background:#c4411a}',
    '</style></head><body><div class="tile">',
    '<div class="copy"><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1><p>' + body + '</p></div>',
    '<div class="brand">✓ ats-fill</div><div class="shot"><img src="' + imageData + '" alt=""></div><div class="rule"></div>',
    '</div></body></html>',
  ].join('');
}

async function installFixtures() {
  await context.addInitScript(({ timestamp }) => {
    const OriginalDate = Date;
    class FixedDate extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [timestamp])); }
      static now() { return timestamp; }
    }
    globalThis.Date = FixedDate;
  }, { timestamp: DEMO_NOW });

  await context.addInitScript(({ jobs, sources, activeTab }) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) return;
    const realSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, callback) => {
      if (msg?.type === 'SEARCH_JOBS') {
        const response = { success: true, jobs, sources };
        if (typeof callback === 'function') setTimeout(() => callback(response), 50);
        return Promise.resolve(response);
      }
      return realSend(msg, callback);
    };
    if (chrome.tabs) {
      const fakeTab = { id: 424242, url: activeTab.url, active: true };
      chrome.tabs.query = async () => [fakeTab];
      chrome.tabs.sendMessage = (_tabId, msg, callback) => {
        let response;
        if (msg?.type === 'DETECT_ATS') response = { ats: activeTab.ats };
        else if (msg?.type === 'GET_JOB_INFO') response = { success: true, job: activeTab.job };
        else response = { success: false, error: 'Store fixture: no live job page.' };
        setTimeout(() => callback?.(response), 0);
      };
    }
  }, { jobs: DEMO_JOBS, sources: DEMO_SEARCH_SOURCES, activeTab: DEMO_ACTIVE_TAB });
}

test.beforeAll(async () => {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  ({ context, extensionId } = await launchExtensionContext(EXTENSION_PATH, 'playwright-store-assets'));
  await installFixtures();
});

test.afterAll(async () => { await context?.close(); });

test('Chrome Web Store screenshots and promo tiles', async () => {
  const main = await openPopup();
  await expect(main.locator('#main-screen')).toBeVisible();
  await expect(main.locator('#ats-status')).toHaveText('Greenhouse');
  await captureStoreScreenshot(main, 'screenshot-01-main.jpg');

  const tracker = await openPopup();
  await openScreen(tracker, 'header-tracker-btn', 'tracker-screen');
  await expect(tracker.locator('.tracker-card').first()).toBeVisible();
  await captureStoreScreenshot(tracker, 'screenshot-02-tracker.jpg');

  const search = await openPopup();
  await openScreen(search, 'header-job-search-btn', 'job-search-screen');
  await search.locator('#job-search-input').fill('platform engineer');
  await search.locator('#job-search-submit-btn').click();
  await expect(search.locator('.job-search-result')).toHaveCount(DEMO_JOBS.length);
  await captureStoreScreenshot(search, 'screenshot-03-job-search.jpg');

  const interview = await openPopup();
  await openScreen(interview, 'header-interview-prep-btn', 'interview-prep-screen');
  await expect(interview.locator('.interview-prep-question-card').first()).toBeVisible();
  await captureStoreScreenshot(interview, 'screenshot-04-interview-prep.jpg');

  const analytics = await openPopup();
  await openScreen(analytics, 'header-analytics-btn', 'analytics-screen');
  await expect(analytics.locator('.analytics-stat').first()).toBeVisible();
  await captureStoreScreenshot(analytics, 'screenshot-05-analytics.jpg');

  const dashboard = await main.screenshot({ type: 'png' });
  const imageData = 'data:image/png;base64,' + dashboard.toString('base64');

  const small = await context.newPage();
  await small.setViewportSize({ width: 440, height: 280 });
  await small.setContent(promoMarkup(440, 280, 'Fill the form.\nKeep the receipts.', 'Local-first application assistant', 'Fill Greenhouse, Lever, Ashby and Workday forms from your saved profile. You review every field.', imageData));
  await small.screenshot({ path: path.join(OUT_DIR, 'small-promo.jpg'), type: 'jpeg', quality: 92 });
  await small.close();

  const marquee = await context.newPage();
  await marquee.setViewportSize({ width: 1400, height: 560 });
  await marquee.setContent(promoMarkup(1400, 560, 'The same 20 questions on 47 different forms.', 'ats-fill · local-first application assistant', 'Save your profile once. Fill supported ATS forms locally, track every application, search jobs across multiple boards, and keep the final submit button yours.', imageData));
  await marquee.screenshot({ path: path.join(OUT_DIR, 'marquee-promo.jpg'), type: 'jpeg', quality: 92 });
  await marquee.close();

  await main.close();
  await tracker.close();
  await search.close();
  await interview.close();
  await analytics.close();
});
