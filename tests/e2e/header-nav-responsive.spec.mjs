/**
 * Regression coverage for the header nav's hamburger collapse. A previous
 * version had a CSS specificity bug: `.header-menu-toggle { display: none }`
 * and `.icon-btn { display: inline-flex }` had equal specificity, so whichever
 * rule happened to sit later in popup.css won regardless of the media query —
 * the hamburger toggle was stuck permanently visible (even at desktop widths)
 * or permanently hidden (even at narrow widths), depending on file order.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtensionContext } from './helpers/extension-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist');

const SW_STUB = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage = (_msg, callback) => {
      if (typeof callback === 'function') setTimeout(() => callback(null), 0);
    };
  }
};

let context;
let extensionId;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtensionContext(EXTENSION_PATH, 'header-nav-responsive'));
  await context.addInitScript(SW_STUB);
});

test.afterAll(async () => {
  await context?.close();
});

test('at narrow widths, the hamburger toggle shows and primary-button labels hide', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 420, height: 640 });
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html?standalone=1`);
  await expect(page.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });

  await expect(page.locator('#header-menu-toggle')).toBeVisible();
  await expect(page.locator('#header-tracker-btn .tracker-btn-label')).toBeHidden();
  // Secondary items stay out of the flow until the menu is opened.
  await expect(page.locator('#header-secondary-nav')).not.toBeVisible();
});

test('opening the hamburger reveals the secondary nav with labels', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 420, height: 640 });
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html?standalone=1`);
  await expect(page.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });

  await page.locator('#header-menu-toggle').click();
  await expect(page.locator('#header-secondary-nav')).toBeVisible();
  await expect(page.locator('#header-ai-btn .tracker-btn-label')).toBeVisible();
});

test('at desktop widths, the hamburger toggle is hidden and all nav items show inline', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 780 });
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html?standalone=1`);
  await expect(page.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });

  await expect(page.locator('#header-menu-toggle')).toBeHidden();
  await expect(page.locator('#header-tracker-btn .tracker-btn-label')).toBeVisible();
  await expect(page.locator('#header-ai-btn .tracker-btn-label')).toBeVisible();
});
