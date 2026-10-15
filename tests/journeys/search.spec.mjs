import { test, expect, step, useExtension, openScreen, DEMO_JOBS, WIDE } from './ats-fill.mjs';

test.describe.configure({ mode: 'serial' });
const ext = useExtension(test, { profile: 'search' });

test('job seeker searches the free boards and narrows to remote roles', {
  tag: ['@feature:16-built-in-job-sources', '@feature:per-source-filter-chips', '@feature:remote-type-and-location-filters', '@feature:pay-filter-with-hide-unknown-toggle'],
}, async () => {
  const page = await ext.openPopup(WIDE);

  await step(page, 'search for platform engineer', async () => {
    await openScreen(page, 'header-job-search-btn', 'job-search-screen');
    await expect(page.locator('.job-source-chip').first()).toBeVisible();
    await page.locator('#job-search-input').fill('platform engineer');
    await page.locator('#job-search-submit-btn').click();
    await expect(page.locator('.job-search-result')).toHaveCount(DEMO_JOBS.length);
    await expect(page.getByText('Kestrel Cloud').first()).toBeVisible();
  }, { docs: '16-built-in-job-sources' });

  await step(page, 'open the filters panel', async () => {
    await page.locator('#job-filters-toggle').click();
    await expect(page.locator('#job-search-subbar')).toBeVisible();
    await expect(page.locator('#pay-hide-unknown')).toBeVisible();
  }, { docs: 'remote-type-and-location-filters' });

  await step(page, 'show remote roles only', async () => {
    await page.locator('#filter-remote').selectOption('remote');
    await expect(page.locator('.job-search-result')).toHaveCount(DEMO_JOBS.filter((j) => j.remote).length);
  });
  await page.close();
});

test('job seeker finds the optional sources in Settings', {
  tag: ['@feature:custom-rss-job-sources', '@feature:google-oauth-import'],
}, async () => {
  const page = await ext.openPopup(WIDE);

  await step(page, 'open Settings and the custom sources card', async () => {
    await openScreen(page, 'header-ai-btn', 'ai-screen');
    const card = page.locator('#custom-sources-section');
    await card.evaluate((el) => { el.open = true; });
    await card.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await expect(card.locator('input, textarea').first()).toBeVisible();
  }, { docs: 'custom-rss-job-sources' });

  await step(page, 'open the Google import card', async () => {
    const card = page.locator('#google-oauth-section');
    await card.evaluate((el) => { el.open = true; });
    await card.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await expect(page.locator('#connect-google-btn')).toBeVisible();
  }, { docs: 'google-oauth-import' });
  await page.close();
});
