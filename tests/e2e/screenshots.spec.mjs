/**
 * Screenshot capture spec — generates README gallery images from deterministic
 * fictional demo state so the UI looks meaningfully used without exposing
 * developer data.
 *
 * The real service worker serves every message (so the Pipeline, Analytics,
 * Memory, and Interview Prep screens render the seeded data). Only the calls
 * that would touch the network or a live job tab are answered from fixtures:
 * SEARCH_JOBS, and the active-tab ATS / job lookups.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtensionContext } from './helpers/extension-context.mjs';
import {
  seedDemoState,
  DEMO_NOW,
  DEMO_JOBS,
  DEMO_SEARCH_SOURCES,
  DEMO_ACTIVE_TAB,
} from './helpers/demo-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist');

let context;
let extensionId;

const WIDE = { width: 1280, height: 800 };

const STABLE_SCREENSHOT_STYLE = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

async function captureScreenshot(page, file) {
  await page.addStyleTag({ content: STABLE_SCREENSHOT_STYLE });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.screenshot({ path: `screenshots/${file}` });
}

async function openPopup(viewport, { standalone = true, colorScheme = 'light' } = {}) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
  const query = standalone ? '?standalone=1' : '';
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html${query}`);
  await seedDemoState(page);
  await page.reload();
  await expect(page.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });
  return page;
}

async function openScreen(page, buttonId, screenId) {
  await page.locator(`#${buttonId}`).click();
  await expect(page.locator(`#${screenId}`)).toBeVisible({ timeout: 10000 });
}

// Page-side fixtures: pass real messages through to the service worker, answer
// network-bound ones from demo data, and pretend the active tab is a
// Greenhouse application page.
function installPageFixtures({ jobs, sources, activeTab }) {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  const realSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (msg, callback) => {
    if (msg?.type === 'SEARCH_JOBS') {
      const resp = { success: true, jobs, sources };
      if (typeof callback === 'function') setTimeout(() => callback(resp), 50);
      return Promise.resolve(resp);
    }
    return realSend(msg, callback);
  };

  if (chrome.tabs) {
    const fakeTab = { id: 424242, url: activeTab.url, active: true };
    chrome.tabs.query = async () => [fakeTab];
    chrome.tabs.sendMessage = (_tabId, msg, callback) => {
      let resp;
      if (msg?.type === 'DETECT_ATS') resp = { ats: activeTab.ats };
      else if (msg?.type === 'GET_JOB_INFO') resp = { success: true, job: activeTab.job };
      else resp = { success: false, error: 'Screenshot fixture: no live job page.' };
      setTimeout(() => callback?.(resp), 0);
    };
  }
}

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtensionContext(EXTENSION_PATH, 'playwright-screenshot-profile'));

  // Freeze application time so relative dates and "recent" labels cannot drift
  // between gallery refreshes.
  await context.addInitScript(({ timestamp }) => {
    const OriginalDate = Date;

    class FixedDate extends OriginalDate {
      constructor(...args) {
        // Forward every argument: new Date(y, m, d) must not collapse to new Date(y).
        super(...(args.length ? args : [timestamp]));
      }

      static now() {
        return timestamp;
      }
    }

    globalThis.Date = FixedDate;
  }, { timestamp: DEMO_NOW });

  await context.addInitScript(installPageFixtures, {
    jobs: DEMO_JOBS,
    sources: DEMO_SEARCH_SOURCES,
    activeTab: DEMO_ACTIVE_TAB,
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('screenshot: main dashboard', async () => {
  const page = await openPopup(WIDE);
  await expect(page.locator('#main-screen')).toBeVisible();
  await expect(page.locator('#ats-status')).toHaveText('Greenhouse');
  await expect(page.locator('#stat-total')).toHaveText('12');
  await captureScreenshot(page, 'main-dashboard.png');
  await page.close();
});

test('screenshot: toolbar popup', async () => {
  const page = await openPopup({ width: 440, height: 640 }, { standalone: false });
  await expect(page.locator('#main-screen')).toBeVisible();
  await expect(page.locator('#ats-status')).toHaveText('Greenhouse');
  await captureScreenshot(page, 'popup.png');
  await page.close();
});

test('screenshot: tracker workspace', async () => {
  const page = await openPopup(WIDE);
  await openScreen(page, 'header-tracker-btn', 'tracker-screen');
  await expect(page.locator('.tracker-card').first()).toBeVisible();
  await captureScreenshot(page, 'tracker-workspace.png');
  await page.close();
});

test('screenshot: tracker workspace (dark)', async () => {
  const page = await openPopup(WIDE, { colorScheme: 'dark' });
  await openScreen(page, 'header-tracker-btn', 'tracker-screen');
  await expect(page.locator('.tracker-card').first()).toBeVisible();
  await captureScreenshot(page, 'tracker-workspace-dark.png');
  await page.close();
});

test('screenshot: profile and memory', async () => {
  const page = await openPopup({ width: 1280, height: 860 });
  await openScreen(page, 'header-profile-btn', 'setup-screen');
  await page.evaluate(() => {
    document.querySelector('#profile-memory-section details')?.setAttribute('open', '');
  });
  await expect(page.locator('#learned-defaults-list .memory-bubble').first()).toBeVisible();
  await captureScreenshot(page, 'profile-memory.png');
  await page.close();
});

test('screenshot: job search panel', async () => {
  const page = await openPopup(WIDE);
  await openScreen(page, 'header-job-search-btn', 'job-search-screen');
  await expect(page.locator('.job-source-chip').first()).toBeVisible();
  await page.locator('#job-search-input').fill('platform engineer');
  await page.locator('#job-search-submit-btn').click();
  await expect(page.locator('.job-search-result')).toHaveCount(DEMO_JOBS.length);
  await captureScreenshot(page, 'job-search.png');
  await page.close();
});

test('screenshot: analytics', async () => {
  const page = await openPopup(WIDE);
  await openScreen(page, 'header-analytics-btn', 'analytics-screen');
  await expect(page.locator('.analytics-stat').first()).toBeVisible();
  await captureScreenshot(page, 'analytics.png');
  await page.close();
});

test('screenshot: AI settings panel', async () => {
  const page = await openPopup(WIDE);
  await openScreen(page, 'header-ai-btn', 'ai-screen');
  await captureScreenshot(page, 'ai-settings.png');
  await page.close();
});

test('screenshot: help and privacy panel', async () => {
  const page = await openPopup(WIDE);
  await openScreen(page, 'header-help-btn', 'help-screen');
  await captureScreenshot(page, 'help-privacy.png');
  await page.close();
});

test('screenshot: interview prep', async () => {
  const page = await openPopup(WIDE);
  await openScreen(page, 'header-interview-prep-btn', 'interview-prep-screen');
  await expect(page.locator('.interview-prep-question-card').first()).toBeVisible();
  await captureScreenshot(page, 'interview-prep.png');
  await page.close();
});
