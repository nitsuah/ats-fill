// Journey helpers. Ported to ESM from nitsuah/.github journeys/templates/journey.js
// (this repo is "type": "module").
//
//   import { test, expect, step } from './journey.mjs';
//   test('job seeker reviews the pipeline', { tag: ['@feature:job-workspace-view'] }, async () => {
//     await step(page, 'open the pipeline', async () => { ... }, { docs: 'job-workspace-view' });
//   });
//
// Every step() is a test.step, so a failure names the step (the reporter
// fingerprints on it), and ends with a visual baseline (toHaveScreenshot)
// unless { screenshot: false }.
import { test, expect } from '@playwright/test';

export { test, expect };

export const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * One user-visible step of a journey.
 * opts.screenshot  false to skip the visual baseline for this step
 * opts.target      a Locator to snapshot instead of the whole viewport
 * opts.mask        Locators to paint over (live numbers, timestamps)
 * opts.docs        a feature id: with DOCS_SCREENSHOTS=<dir> set, also save
 *                  <dir>/<id>.png, so the journeys double as the visual-docs
 *                  screenshots (screenshots/<feature-id>.png)
 */
export async function step(page, title, fn, opts = {}) {
  return test.step(title, async () => {
    await fn();
    const target = opts.target || page;
    if (opts.screenshot !== false) {
      await expect(target).toHaveScreenshot(`${slug(title)}.png`, { mask: opts.mask });
    }
    if (opts.docs && process.env.DOCS_SCREENSHOTS) {
      await target.screenshot({ path: `${process.env.DOCS_SCREENSHOTS}/${opts.docs}.png`, animations: 'disabled' });
    }
  });
}
