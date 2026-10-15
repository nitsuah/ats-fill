import { test, expect, step, useExtension, openScreen, WIDE, PHONE } from './ats-fill.mjs';

test.describe.configure({ mode: 'serial' });
const ext = useExtension(test, { profile: 'workspace' });

test('job seeker opens ats-fill on a Greenhouse page and sees what is ready', {
  tag: ['@feature:form-fill-automation', '@feature:supported-ats-platforms'],
}, async () => {
  const page = await ext.openPopup(WIDE);

  await step(page, 'see the detected ATS, readiness and last fill', async () => {
    await expect(page.locator('#main-screen')).toBeVisible();
    await expect(page.locator('#ats-status')).toHaveText('Greenhouse');
    await expect(page.locator('#stat-pending')).toHaveText('10');
    await expect(page.locator('#stat-applied')).toHaveText('2');
    await expect(page.locator('#stat-total')).toHaveText('12');
    await expect(page.locator('#header-tracker-count')).toHaveText('10 / 12 active');
    await expect(page.getByText('Are you open to relocation to Denver?')).toBeVisible();
  });
  await page.close();
});

test('job seeker reviews the application pipeline', {
  tag: ['@feature:job-workspace-view'],
}, async () => {
  const page = await ext.openPopup(WIDE);

  await step(page, 'open the pipeline and see tracked applications', async () => {
    await openScreen(page, 'header-tracker-btn', 'tracker-screen');
    await expect(page.locator('.tracker-card').first()).toBeVisible();
    await expect(page.getByText('Northstar Labs').first()).toBeVisible();
    await expect(page.getByText('Pine Ridge Analytics').first()).toBeVisible();
  }, { docs: 'job-workspace-view' });
  await page.close();
});

test('job seeker checks which sources and salary bands answer', {
  tag: ['@feature:response-rate-by-source', '@feature:salary-band-effectiveness', '@feature:time-to-first-response-distribution'],
}, async () => {
  const page = await ext.openPopup(WIDE);

  await step(page, 'open analytics and read the response rate', async () => {
    await openScreen(page, 'header-analytics-btn', 'analytics-screen');
    await expect(page.getByText('9 sent · 5 responses · 55.6% response rate')).toBeVisible();
    await expect(page.getByText('Response rate by source')).toBeVisible();
    await expect(page.getByText('66.7%')).toBeVisible();
  }, { docs: 'response-rate-by-source' });
  await page.close();
});

test('job seeker prepares for the Quarry Robotics interview', {
  tag: ['@feature:ai-interview-question-generation'],
}, async () => {
  const page = await ext.openPopup(WIDE);

  await step(page, 'open interview prep and read the generated questions', async () => {
    await openScreen(page, 'header-interview-prep-btn', 'interview-prep-screen');
    await expect(page.locator('.interview-prep-question-card').first()).toBeVisible();
    await expect(page.locator('.interview-prep-question-text').first()).toContainText('never brick a unit');
  }, { docs: 'ai-interview-question-generation' });
  await page.close();
});

test('job seeker opens ats-fill on a phone', {
  tag: ['@feature:collapsible-header-nav'],
}, async () => {
  const page = await ext.openPopup(PHONE);

  await step(page, 'see the home screen on a phone', async () => {
    await expect(page.locator('#main-screen')).toBeVisible();
    await expect(page.locator('#stat-total')).toHaveText('12');
  });

  await step(page, 'read the masthead without it squeezing or overlapping', async () => {
    const intro = await page.locator('.main-hero .helper-text').boundingBox();
    const stats = await page.locator('.main-stats').boundingBox();
    expect(intro.width).toBeGreaterThan(250);
    expect(stats.y).toBeGreaterThanOrEqual(intro.y + intro.height);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  }, { screenshot: false });

  await step(page, 'open the header menu', async () => {
    await page.locator('#header-menu-toggle').click();
    await expect(page.locator('#header-analytics-btn')).toBeVisible();
    await expect(page.locator('#header-help-btn')).toBeVisible();
  });
  await page.close();
});
