/**
 * Screenshot capture spec — generates README gallery images from deterministic
 * fictional demo state so the UI looks meaningfully used without exposing
 * developer data.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtensionContext } from './helpers/extension-context.mjs';
import { seedDemoState } from './helpers/demo-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist');

let context;
let extensionId;

async function openPopup(viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html?standalone=1`);
  await seedDemoState(page);
  await page.reload();
  await expect(page.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });
  return page;
}

// Stub chrome.runtime.sendMessage so the popup initialises without a live
// service worker. These tests exercise popup UI appearance, not messaging.
const SW_STUB = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage = (_msg, callback) => {
      if (typeof callback === 'function') setTimeout(() => callback(null), 0);
    };
  }
};

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtensionContext(EXTENSION_PATH, 'playwright-screenshot-profile'));
  await context.addInitScript(SW_STUB);
});

test.afterAll(async () => {
  await context?.close();
});

test('screenshot: main dashboard', async () => {
  const page = await openPopup({ width: 420, height: 640 });
  await page.screenshot({ path: 'screenshots/main-dashboard.png' });
  await page.close();
});

test('screenshot: tracker workspace', async () => {
  const page = await openPopup({ width: 1100, height: 780 });
  await page.locator('#header-tracker-btn').click();
  await expect(page.locator('#tracker-screen')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/tracker-workspace.png' });
  await page.close();
});

test('screenshot: profile and memory', async () => {
  const page = await openPopup({ width: 1100, height: 860 });
  await page.locator('#header-profile-btn').click();
  await expect(page.locator('#setup-screen')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/profile-memory.png' });
  await page.close();
});

test('screenshot: job search panel', async () => {
  const page = await openPopup({ width: 1100, height: 780 });
  await page.locator('#header-job-search-btn').click();
  await expect(page.locator('#job-search-screen')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/job-search.png' });
  await page.close();
});

test('screenshot: AI settings panel', async () => {
  const page = await openPopup({ width: 1100, height: 780 });
  await page.locator('#header-ai-btn').click();
  await expect(page.locator('#ai-screen')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/ai-settings.png' });
  await page.close();
});

test('screenshot: help and privacy panel', async () => {
  const page = await openPopup({ width: 1100, height: 780 });
  await page.locator('#header-help-btn').click();
  await expect(page.locator('#help-screen')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/help-privacy.png' });
  await page.close();
});

test('screenshot: interview prep', async () => {
  const page = await openPopup({ width: 1100, height: 780 });
  await page.locator('#header-interview-prep-btn').click();
  await expect(page.locator('#interview-prep-screen')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/interview-prep.png' });
  await page.close();
});
