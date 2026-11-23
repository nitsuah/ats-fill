import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtensionContext } from './helpers/extension-context.mjs';
import { DEMO_STATE } from './helpers/demo-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist');
const HTML = fs.readFileSync(path.join(__dirname, 'fixtures/auto-submit-ats.html'), 'utf8');
// A recognized ATS host; the fixture is served from the route below, never the network.
const JOB_URL = 'https://job-boards.greenhouse.io/northstar/jobs/4242';

test.describe.configure({ mode: 'serial' });

let context;
let extensionId;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtensionContext(EXTENSION_PATH, 'playwright-auto-submit'));
});

test.afterAll(async () => {
  await context?.close();
});

async function openJob(mutate) {
  const page = await context.newPage();
  await page.route('https://job-boards.greenhouse.io/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: HTML }));
  await page.goto(JOB_URL);
  await expect(page.locator('#application-form')).toBeVisible();
  if (mutate) await page.evaluate(mutate);
  return page;
}

async function seed(popup, fullAuto) {
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?standalone=1`);
  await popup.evaluate(async ({ state, fullAuto: on }) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      ...state,
      settings: { ...(state.settings || {}), full_auto_submit: on },
      lastAnswers: { first_name: 'Jordan', last_name: 'Morgan', full_name: 'Jordan Morgan', email: 'jordan.morgan@example.test', phone: '(555) 010-0142' },
    });
  }, { state: DEMO_STATE, fullAuto });
}

// Send Fill straight to the job tab, the same message the popup's Fill button sends.
async function fill(popup) {
  return popup.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}*` });
    return chrome.tabs.sendMessage(tab.id, { type: 'FILL_FORM', expectedUrl: url });
  }, JOB_URL);
}

test('Full auto counts down, then submits and logs it to the tracker', async () => {
  const popup = await context.newPage();
  await seed(popup, true);
  const page = await openJob();
  await page.bringToFront();
  const result = await fill(popup);
  expect(result.success).toBe(true);
  expect(result.autoSubmit.state).toBe('countdown');

  await expect(page.locator('[data-ats-fill-banner="countdown"]')).toBeVisible();
  expect(await page.evaluate(() => window.__submits)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__submits), { timeout: 15000 }).toBe(1);

  const apps = await popup.evaluate(async () => (await chrome.storage.local.get('applications')).applications);
  const entry = apps.find((app) => app.url === JOB_URL);
  expect(entry.status).toBe('submitted');
  expect(entry.auto_submit.ats).toBe('Greenhouse');
  await page.close();
  await popup.close();
});

test('Cancel stops the countdown and nothing is submitted', async () => {
  const popup = await context.newPage();
  await seed(popup, true);
  const page = await openJob();
  await page.bringToFront();
  await fill(popup);
  await page.locator('[data-ats-fill-banner="countdown"] >> text=Cancel submit').click();
  await expect(page.locator('[data-ats-fill-banner]')).toHaveCount(0);
  await page.waitForTimeout(7000);
  expect(await page.evaluate(() => window.__submits)).toBe(0);
  const apps = await popup.evaluate(async () => (await chrome.storage.local.get('applications')).applications);
  expect(apps.find((app) => app.url === JOB_URL).status).toBe('filled');
  await page.close();
  await popup.close();
});

test('Full auto stops for review when a CAPTCHA is present', async () => {
  const popup = await context.newPage();
  await seed(popup, true);
  const page = await openJob(() => { document.body.insertAdjacentHTML('beforeend', '<div class="g-recaptcha" data-sitekey="x"></div>'); });
  await page.bringToFront();
  const result = await fill(popup);
  expect(result.autoSubmit.state).toBe('blocked');
  await expect(page.locator('[data-ats-fill-banner="blocked"]')).toBeVisible();
  await page.waitForTimeout(7000);
  expect(await page.evaluate(() => window.__submits)).toBe(0);
  await page.close();
  await popup.close();
});

test('with the setting off (default) Fill never submits', async () => {
  const popup = await context.newPage();
  await seed(popup, false);
  const page = await openJob();
  await page.bringToFront();
  const result = await fill(popup);
  expect(result.autoSubmit.state).toBe('off');
  await page.waitForTimeout(7000);
  expect(await page.evaluate(() => window.__submits)).toBe(0);
  await expect(page.locator('[data-ats-fill-banner]')).toHaveCount(0);
  await page.close();
  await popup.close();
});
