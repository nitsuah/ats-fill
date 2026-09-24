import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtensionContext } from './helpers/extension-context.mjs';
import { DEMO_STATE } from './helpers/demo-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist');
const FIXTURE_PATH = path.join(__dirname, 'fixtures/fake-ats.html');
const DEMO_URL = 'https://northstar.example.test/jobs/senior-systems-engineer';

let context;
let extensionId;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtensionContext(EXTENSION_PATH, 'playwright-fake-ats'));
});

test.afterAll(async () => {
  await context?.close();
});

test('fictional ATS flow fills the real page without submission', async () => {
  const atsPage = await context.newPage();
  const html = fs.readFileSync(FIXTURE_PATH, 'utf8');

  await atsPage.route('https://northstar.example.test/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: html,
    });
  });

  await atsPage.goto(DEMO_URL);
  await expect(atsPage.locator('#application-form')).toBeVisible();
  await expect(atsPage.locator('h1')).toHaveText('Senior Systems Engineer');

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?standalone=1`);

  await popup.evaluate(async (state) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      ...state,
      lastAnswers: {
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
      },
    });
  }, DEMO_STATE);
  await popup.reload();

  await expect(popup.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });

  // Keep the ATS tab active while driving the extension UI. The extension
  // popup can still be automated because it is a normal extension page in the
  // Playwright context.
  await atsPage.bringToFront();

  await popup.locator('#preview-btn').click();
  await expect(popup.locator('#preview-screen')).toBeVisible({ timeout: 10000 });
  await expect(popup.locator('#preview-content')).toContainText('Jordan Morgan');

  let navigations = 0;
  const originalUrl = atsPage.url();
  await atsPage.evaluate(() => {
    window.__atsFillSubmitEvents = 0;
    document.addEventListener('submit', () => {
      window.__atsFillSubmitEvents += 1;
    }, true);
  });
  const onFrameNavigated = frame => {
    if (frame === atsPage.mainFrame()) navigations += 1;
  };
  atsPage.on('framenavigated', onFrameNavigated);

  await popup.locator('#inject-from-preview-btn').click();

  await expect(atsPage.locator('#first-name')).toHaveValue('Jordan');
  await expect(atsPage.locator('#last-name')).toHaveValue('Morgan');
  await expect(atsPage.locator('#email')).toHaveValue('jordan.morgan@example.test');
  await expect(atsPage.locator('#phone')).toHaveValue('(555) 010-0142');
  await expect(atsPage.locator('#current-title')).toHaveValue('Systems Engineer');
  await expect(atsPage.locator('#current-company')).toHaveValue('Northstar Labs');
  await expect(atsPage.locator('#years')).toHaveValue('10');
  await expect(atsPage.locator('#authorization')).toHaveValue('Yes');
  await expect(atsPage.locator('#salary-min')).toHaveValue('165000');
  await expect(atsPage.locator('#why-role')).toHaveValue(/cloud reliability/);

  const submitEvents = await atsPage.evaluate(() => window.__atsFillSubmitEvents);
  expect(submitEvents).toBe(0);
  expect(navigations).toBe(0);
  expect(atsPage.url()).toBe(originalUrl);

  // Product behavior is deliberately fill-and-review only. The fixture also
  // omits a submit control, but submission is independently observed above.
  await expect(atsPage.locator('form button[type="submit"]')).toHaveCount(0);
  atsPage.off('framenavigated', onFrameNavigated);

  await popup.close();
  await atsPage.close();
});
