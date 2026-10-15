// ats-fill journey fixture: the real built extension (dist/) loaded in Chromium,
// seeded with the fictional demo state the screenshot suite already uses
// (tests/e2e/helpers/demo-state.mjs: Jordan Morgan, invented companies,
// example.test addresses). Nothing touches a real profile or the network:
// SEARCH_JOBS and the active-tab lookups are answered from demo fixtures and
// time is frozen at the demo's "now".
//
// Chrome MV3 extensions need a headed browser, so the journeys run under
// xvfb-run (see package.json "test:journeys").
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtensionContext } from '../e2e/helpers/extension-context.mjs';
import { seedDemoState, DEMO_NOW, DEMO_JOBS, DEMO_SEARCH_SOURCES, DEMO_ACTIVE_TAB } from '../e2e/helpers/demo-state.mjs';
import { expect } from './journey.mjs';

export { test, expect, step, slug } from './journey.mjs';
export { DEMO_NOW, DEMO_JOBS, DEMO_SEARCH_SOURCES, DEMO_ACTIVE_TAB };
export { seedDemoState };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_PATH = path.join(__dirname, '../../dist');

export const WIDE = { width: 1280, height: 800 };
export const PHONE = { width: 390, height: 844 };

const STABLE_STYLE = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
  html, body { scroll-behavior: auto !important; }
`;

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
      else resp = { success: false, error: 'Journey fixture: no live job page.' };
      setTimeout(() => callback?.(resp), 0);
    };
  }
}

/**
 * Registers beforeAll/afterAll on `test` that launch the extension, and returns
 * helpers bound to that context. Call once at the top level of a spec file.
 * `pageFixtures: false` skips the demo job-search / active-tab fakes (the
 * fake-ATS journey drives a real page instead).
 */
export function useExtension(test, { profile = 'journeys', pageFixtures = true } = {}) {
  const state = { context: null, extensionId: null };

  test.beforeAll(async () => {
    ({ context: state.context, extensionId: state.extensionId } = await launchExtensionContext(EXTENSION_PATH, `playwright-${profile}`));
    // Freeze application time so relative dates cannot drift. Forward every
    // constructor argument: new Date(y, m, d) must not collapse to new Date(y).
    await state.context.addInitScript(({ timestamp }) => {
      const OriginalDate = Date;
      globalThis.Date = class FixedDate extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : [timestamp])); }
        static now() { return timestamp; }
      };
    }, { timestamp: DEMO_NOW });
    if (pageFixtures) {
      await state.context.addInitScript(installPageFixtures, { jobs: DEMO_JOBS, sources: DEMO_SEARCH_SOURCES, activeTab: DEMO_ACTIVE_TAB });
    }
  });

  test.afterAll(async () => {
    await state.context?.close();
  });

  /** Open the popup standalone (a full tab) on freshly seeded demo state. */
  async function openPopup(viewport = WIDE, { standalone = true, colorScheme = 'light' } = {}) {
    const page = await state.context.newPage();
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
    await page.goto(`chrome-extension://${state.extensionId}/popup/popup.html${standalone ? '?standalone=1' : ''}`);
    await seedDemoState(page);
    await page.reload();
    await expect(page.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });
    await settle(page);
    return page;
  }

  return { state, openPopup };
}

/** Fonts in, animations off, scrolled to the top. */
export async function settle(page) {
  await page.addStyleTag({ content: STABLE_STYLE });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}

export async function openScreen(page, buttonId, screenId) {
  await page.locator(`#${buttonId}`).click();
  await expect(page.locator(`#${screenId}`)).toBeVisible({ timeout: 10000 });
  await settle(page);
}
