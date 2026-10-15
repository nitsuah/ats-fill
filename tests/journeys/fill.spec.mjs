import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, step, useExtension, seedDemoState, settle } from './ats-fill.mjs';
import { DEMO_STATE } from '../e2e/helpers/demo-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../e2e/fixtures/fake-ats.html');
const DEMO_URL = 'https://northstar.example.test/jobs/senior-systems-engineer';

test.describe.configure({ mode: 'serial' });
// This journey drives a real (fictional) application page, so no tab fakes.
const ext = useExtension(test, { profile: 'fill', pageFixtures: false });

test('job seeker previews and fills a fictional application without submitting', {
  tag: ['@feature:form-fill-automation'],
}, async () => {
  const atsPage = await ext.state.context.newPage();
  await atsPage.setViewportSize({ width: 1280, height: 800 });
  await atsPage.route('https://northstar.example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(FIXTURE, 'utf8') }));
  await atsPage.goto(DEMO_URL);
  await expect(atsPage.locator('#application-form')).toBeVisible();

  const popup = await ext.state.context.newPage();
  await popup.setViewportSize({ width: 1280, height: 800 });
  await popup.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await popup.goto(`chrome-extension://${ext.state.extensionId}/popup/popup.html?standalone=1`);
  await popup.evaluate(async (state) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      ...state,
      lastAnswers: {
        first_name: 'Jordan', last_name: 'Morgan', full_name: 'Jordan Morgan',
        email: 'jordan.morgan@example.test', phone: '(555) 010-0142', location: 'Arlington, VA',
        linkedin: 'https://www.linkedin.com/in/jordan-morgan-demo', current_title: 'Systems Engineer',
        current_company: 'Northstar Labs', years_of_experience: '10', work_authorization: 'Yes',
        desired_salary_min: '165000',
        why_role: 'The role combines cloud reliability, automation, and developer tooling with a product-focused engineering team.',
      },
    });
  }, DEMO_STATE);
  await popup.reload();
  await expect(popup.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });
  await settle(popup);
  await atsPage.bringToFront();

  await step(popup, 'preview what will be filled', async () => {
    await popup.locator('#preview-btn').click();
    await expect(popup.locator('#preview-screen')).toBeVisible({ timeout: 10000 });
    await expect(popup.locator('#preview-content')).toContainText('Jordan Morgan');
    await settle(popup);
  });

  await step(atsPage, 'fill the application form', async () => {
    await popup.locator('#inject-from-preview-btn').click();
    await expect(atsPage.locator('#first-name')).toHaveValue('Jordan');
    await expect(atsPage.locator('#email')).toHaveValue('jordan.morgan@example.test');
    await expect(atsPage.locator('#current-company')).toHaveValue('Northstar Labs');
    await expect(atsPage.locator('#salary-min')).toHaveValue('165000');
    await expect(atsPage.locator('#why-role')).toHaveValue(/cloud reliability/);
    await settle(atsPage);
    // Fill-and-review only: there is no submit control to press.
    await expect(atsPage.locator('form button[type="submit"]')).toHaveCount(0);
  });

  await popup.close();
  await atsPage.close();
});
