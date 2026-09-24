/**
 * Visual regression checks against the committed product gallery.
 *
 * The gallery is generated from the same deterministic fixture state used by
 * screenshots.spec.mjs. Keeping the regression check separate means the
 * gallery refresh workflow can still update intentional UI changes on main,
 * while pull requests get a stable visual guard.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtensionContext } from './helpers/extension-context.mjs';
import { seedDemoState } from './helpers/demo-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist');
const SCREENSHOTS_DIR = path.join(__dirname, '../../screenshots');

const SCREENSHOT_NOW = 1788264000000; // 2026-09-01T12:00:00Z
const PIXEL_CHANNEL_TOLERANCE = 8;
const MAX_DIFF_RATIO = 0.001;

const STABLE_SCREENSHOT_STYLE = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

let context;
let extensionId;

async function openPopup(viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html?standalone=1`);
  await seedDemoState(page);
  await page.reload();
  await expect(page.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({ content: STABLE_SCREENSHOT_STYLE });
  return page;
}

async function expectGalleryMatch(page, baselineName) {
  const baselinePath = path.join(SCREENSHOTS_DIR, baselineName);
  expect(fs.existsSync(baselinePath)).toBe(true);

  const actual = await page.screenshot();
  const baseline = fs.readFileSync(baselinePath);

  const comparison = await page.evaluate(async ({ actualBase64, baselineBase64, tolerance }) => {
    async function decode(base64) {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        data: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
      };
    }

    const [current, expected] = await Promise.all([
      decode(actualBase64),
      decode(baselineBase64),
    ]);

    if (current.width !== expected.width || current.height !== expected.height) {
      return {
        widthMismatch: true,
        differingPixels: current.width * current.height,
        totalPixels: expected.width * expected.height,
      };
    }

    let differingPixels = 0;
    for (let i = 0; i < current.data.length; i += 4) {
      const delta = Math.max(
        Math.abs(current.data[i] - expected.data[i]),
        Math.abs(current.data[i + 1] - expected.data[i + 1]),
        Math.abs(current.data[i + 2] - expected.data[i + 2]),
        Math.abs(current.data[i + 3] - expected.data[i + 3]),
      );
      if (delta > tolerance) differingPixels += 1;
    }

    return {
      widthMismatch: false,
      differingPixels,
      totalPixels: current.width * current.height,
    };
  }, {
    actualBase64: actual.toString('base64'),
    baselineBase64: baseline.toString('base64'),
    tolerance: PIXEL_CHANNEL_TOLERANCE,
  });

  const ratio = comparison.totalPixels
    ? comparison.differingPixels / comparison.totalPixels
    : 1;

  expect(comparison.widthMismatch, `Visual baseline dimensions changed for ${baselineName}`).toBe(false);
  expect(
    ratio,
    `Visual regression for ${baselineName}: ${comparison.differingPixels}/${comparison.totalPixels} pixels differ`,
  ).toBeLessThanOrEqual(MAX_DIFF_RATIO);
}

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtensionContext(EXTENSION_PATH, 'playwright-visual-regression'));

  await context.addInitScript(({ timestamp }) => {
    const OriginalDate = Date;

    class FixedDate extends OriginalDate {
      constructor(...args) {
        super(args.length ? args[0] : timestamp);
      }

      static now() {
        return timestamp;
      }
    }

    globalThis.Date = FixedDate;
  }, { timestamp: SCREENSHOT_NOW });

  await context.addInitScript(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage = (_msg, callback) => {
        if (typeof callback === 'function') setTimeout(() => callback(null), 0);
      };
    }
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('visual regression: main dashboard', async () => {
  const page = await openPopup({ width: 420, height: 640 });
  await expectGalleryMatch(page, 'main-dashboard.png');
  await page.close();
});

test('visual regression: tracker workspace', async () => {
  const page = await openPopup({ width: 1100, height: 780 });
  await page.locator('#header-tracker-btn').click();
  await expect(page.locator('#tracker-screen')).toBeVisible({ timeout: 10000 });
  await expectGalleryMatch(page, 'tracker-workspace.png');
  await page.close();
});
