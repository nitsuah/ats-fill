import { chromium } from '@playwright/test';
import fs from 'node:fs';

/**
 * Poll context.serviceWorkers() until a worker appears or timeout expires.
 *
 * Why polling instead of waitForEvent('serviceworker'):
 *   The 'serviceworker' CDP event fires during launchPersistentContext (before
 *   user code can call waitForEvent), so event-driven detection always misses it.
 *   Polling serviceWorkers() works because Playwright's internal CDP state syncs
 *   within the first poll interval even if the initial call returns [].
 *
 * Why headless: false:
 *   Chrome MV3 extension service workers require a graphical environment.
 *   In CI this is satisfied by xvfb-run wrapping the test command.
 */
async function waitForServiceWorker(context, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const workers = context.serviceWorkers();
    if (workers.length > 0) return workers[0];
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Extension service worker not found after ${timeout}ms`);
}

/**
 * Launch a persistent Chromium context with the extension loaded and its
 * service worker confirmed running.
 *
 * @param {string} extensionPath - Absolute path to the built extension dist dir.
 * @param {string} [profilePrefix] - Prefix for the temporary user data dir.
 * @param {object} [contextOptions] - Extra launchPersistentContext options
 *   (e.g. deviceScaleFactor for high-DPI video frames). `args` are appended
 *   to the extension flags rather than replacing them.
 * @returns {{ context: import('@playwright/test').BrowserContext, extensionId: string }}
 */
export async function launchExtensionContext(extensionPath, profilePrefix = 'playwright-ext', { args: extraArgs = [], ...contextOptions } = {}) {
  if (!fs.existsSync(extensionPath)) {
    throw new Error(
      `Extension build not found at "${extensionPath}". Run npm run build first.`
    );
  }

  const userDataDir = `/tmp/${profilePrefix}-${Math.random().toString(36).slice(2)}`;
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...contextOptions,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--enable-extensions',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--force-color-profile=srgb',
      ...extraArgs,
    ],
  });

  context.on('serviceworker', sw =>
    sw.on('console', msg => process.stdout.write(`[SW:${msg.type()}] ${msg.text()}\n`))
  );

  let sw;
  try {
    sw = await waitForServiceWorker(context);
  } catch (err) {
    await context.close();
    throw err;
  }

  const extensionId = sw.url().split('/')[2];
  if (!extensionId) {
    await context.close();
    throw new Error(`Service worker found but extensionId could not be parsed from: ${sw.url()}`);
  }

  return { context, extensionId };
}
