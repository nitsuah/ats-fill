import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtensionContext } from './helpers/extension-context.mjs';
import { DEMO_STATE } from './helpers/demo-state.mjs';

// An ATS application form embedded in a company career page (#268; fix in #154).
// The host page and the iframe both run the content script, and exactly one of
// them may answer detection, fill and tracker logging. Both fixtures are served
// from routes, never the network.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '../../dist');
const HOST_HTML = fs.readFileSync(path.join(__dirname, 'fixtures/embedded-ats-host.html'), 'utf8');
const FORM_HTML = fs.readFileSync(path.join(__dirname, 'fixtures/embedded-greenhouse-form.html'), 'utf8');

const HOST_URL = 'https://northstar.example.test/jobs/senior-systems-engineer';
const CASES = [
  {
    name: 'cross-origin iframe (Greenhouse-hosted embed)',
    // The tracker records the career page, not the embed's one-time token URL.
    trackedUrl: HOST_URL,
    frameSrc: 'https://job-boards.greenhouse.io/embed/job_app?for=northstar&token=4242',
  },
  {
    name: 'same-origin iframe (form served by the career site)',
    // `job-boards.greenhouse.io` in the query makes the host page recognise the embed.
    frameSrc: '/jobs/embedded-greenhouse-form?board=job-boards.greenhouse.io',
  },
];

test.describe.configure({ mode: 'serial' });

let context;
let extensionId;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtensionContext(EXTENSION_PATH, 'playwright-embedded-ats'));
});

test.afterAll(async () => {
  await context?.close();
});

for (const { name, frameSrc, trackedUrl } of CASES) {
  test(`${name}: popup names the ATS, Fill fills the iframe, tracker logs one entry`, async () => {
    const hostPage = await context.newPage();
    await hostPage.route('https://northstar.example.test/**', (route) => {
      const { pathname } = new URL(route.request().url());
      const body = pathname.startsWith('/jobs/embedded-greenhouse-form')
        ? FORM_HTML
        : HOST_HTML.replace('__FRAME_SRC__', frameSrc);
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await hostPage.route('https://job-boards.greenhouse.io/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: FORM_HTML }));

    await hostPage.goto(HOST_URL);
    await expect(hostPage.locator('h1')).toHaveText('Senior Systems Engineer');
    const frame = hostPage.frameLocator('#application-frame');
    await expect(frame.locator('#first_name')).toBeVisible();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?standalone=1`);
    await popup.evaluate(async (state) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        ...state,
        applications: [],
        lastAnswers: {
          first_name: 'Jordan',
          last_name: 'Morgan',
          full_name: 'Jordan Morgan',
          email: 'jordan.morgan@example.test',
          phone: '(555) 010-0142',
          linkedin: 'https://www.linkedin.com/in/jordan-morgan-demo',
        },
      });
    }, DEMO_STATE);
    // The popup asks the active tab, so put the career page in front and reload
    // the popup behind it: the readiness card is computed on load.
    await hostPage.bringToFront();
    await popup.reload();
    await expect(popup.locator('.screen:not(.hidden)')).toBeVisible({ timeout: 30000 });

    // Readiness card: the ATS comes from the iframe, not "No job page".
    await expect(popup.locator('#ats-status')).toHaveText(/Greenhouse/, { timeout: 15000 });
    await expect(popup.locator('#ats-status')).not.toHaveText('No job page');

    // The Fill button's message. The action popup gets the tab URL from activeTab,
    // which a test cannot grant, so send FILL_FORM directly with the same binding
    // the popup builds: the top-level URL plus the page's https ATS iframe srcs.
    const frameSrcs = await hostPage.evaluate(() => Array.from(document.querySelectorAll('iframe[src]'))
      .map((el) => el.src).filter((src) => /^https:\/\/[^/]*greenhouse\.io\//.test(src)));
    await hostPage.bringToFront();
    const fillResult = await popup.evaluate(async ({ url, frameSrcs }) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, { type: 'FILL_FORM', expectedUrl: url, frameSrcs });
    }, { url: HOST_URL, frameSrcs });
    expect(fillResult?.success, JSON.stringify(fillResult)).toBe(true);

    await expect(frame.locator('#first_name')).toHaveValue('Jordan');
    await expect(frame.locator('#last_name')).toHaveValue('Morgan');
    await expect(frame.locator('#email')).toHaveValue('jordan.morgan@example.test');
    await expect(frame.locator('#phone')).toHaveValue('(555) 010-0142');
    await expect(frame.locator('#linkedin_profile')).toHaveValue('https://www.linkedin.com/in/jordan-morgan-demo');

    // Exactly one tracker entry, with both company and title.
    await expect.poll(async () => popup.evaluate(async () =>
      ((await chrome.storage.local.get('applications')).applications || []).length), { timeout: 10000 }).toBe(1);
    const [entry] = await popup.evaluate(async () => (await chrome.storage.local.get('applications')).applications);
    expect(entry.title).toBe('Senior Systems Engineer');
    expect(entry.company).toBe('Northstar Labs');
    if (trackedUrl) expect(entry.url).toBe(trackedUrl);

    await popup.close();
    await hostPage.close();
  });
}
