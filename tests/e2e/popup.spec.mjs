import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';

import { installChromeMock } from './chrome-mock.js';
import { launchExtensionContext } from './helpers/extension-context.mjs';

const EXTENSION_PATH = path.resolve(import.meta.dirname, '../../dist');

test('popup renders shell and primary workspace actions', async ({ page }) => {
  await page.addInitScript(installChromeMock);
  const popupUrl = pathToFileURL(path.resolve(process.cwd(), 'popup/popup.html')).toString();
  await page.goto(popupUrl);

  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#header-job-search-btn')).toBeVisible();
  await expect(page.locator('#header-tracker-btn')).toBeVisible();
  await expect(page.locator('#header-ai-btn')).toBeVisible();
  await expect(page.locator('#header-help-btn')).toBeVisible();
});

test('setup profile workspace remains visible for first-load state', async ({ page }) => {
  await page.addInitScript(installChromeMock);
  const popupUrl = pathToFileURL(path.resolve(process.cwd(), 'popup/popup.html')).toString();
  await page.goto(popupUrl);

  await expect(page.locator('#setup-screen')).toHaveCount(1);
  await expect(page.locator('#profile-resume-section')).toHaveCount(1);
  await expect(page.locator('#profile-privacy-section')).toHaveCount(1);
});

test('long unresolved question labels truncate without overflowing the report card', async () => {
  const LONG = 'Describe a production incident you personally handled end to end, including the customer impact, the root cause you found, the remediation you shipped, and what you would change about the on-call process so it does not happen again in the future.';
  const SHORT = 'Why are you interested in this role?';

  const { context, extensionId } = await launchExtensionContext(EXTENSION_PATH, 'playwright-long-label-profile');
  const page = await context.newPage();
  await page.setViewportSize({ width: 440, height: 900 });

  await page.goto(`chrome-extension://${extensionId}/popup/popup.html?standalone=1`);
  await page.evaluate(async (report) => {
    await chrome.storage.local.set({
      settings: { privacy_consent: true },
      resume: { structured: { name: 'Jordan Morgan' } },
      applications: [{ id: 'app-1', status: 'drafted' }],
      lastTrackedApplicationId: 'app-1',
      lastFillReport: report,
    });
  }, {
    filled: 3,
    preserved: 0,
    unresolved: [
      { label: LONG, reason: 'No saved answer — review before submitting' },
      { label: SHORT, reason: 'No saved answer — review before submitting' },
    ],
  });
  await page.reload();

  const buttons = page.locator('#fill-report-unresolved .review-jump-btn');
  await expect(buttons).toHaveCount(2);

  const longBtn = buttons.nth(0);
  const shortBtn = buttons.nth(1);

  // Accessible name stays the full question even though it is visually clipped.
  await expect(longBtn).toHaveAccessibleName(LONG);
  await expect(longBtn).toHaveAttribute('title', LONG);
  await expect(shortBtn).toHaveAttribute('title', SHORT);

  const metrics = await page.evaluate(() => {
    const [long, short] = document.querySelectorAll('#fill-report-unresolved .review-jump-btn');
    const card = document.querySelector('#fill-report-card');
    return {
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      cardRight: Math.round(card.getBoundingClientRect().right),
      longClips: long.scrollWidth > long.clientWidth,
      shortClips: short.scrollWidth > short.clientWidth,
      longFocusable: (long.focus(), document.activeElement === long),
    };
  });

  expect(metrics.docScroll).toBeLessThanOrEqual(metrics.docClient);
  expect(metrics.cardRight).toBeLessThanOrEqual(metrics.docClient);
  expect(metrics.longClips).toBe(true);
  expect(metrics.shortClips).toBe(false);
  expect(metrics.longFocusable).toBe(true);

  await context.close();
});
