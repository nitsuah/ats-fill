// Nightly "AI user" journeys: happy paths a real user takes in the extension,
// one visual baseline per step. Run by .github/workflows/journeys.yml through
// the shared nitsuah/.github journeys harness, which files/dedups/closes
// `bot:journey` issues from the JSON report. Contract:
// nitsuah/.github journeys/STANDARD.md.
//
// The extension is loaded headed (MV3 service workers need a display), so run
// it under xvfb-run, and only in the Playwright Docker image: baselines are
// Linux-only (see tests/journeys/README.md).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  testDir: path.join(repoRoot, 'tests', 'journeys'),
  outputDir: path.join(repoRoot, 'test-results'),
  // One baseline per step, Linux only.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{testName}/{arg}{ext}',
  // A missing baseline must fail in CI instead of being written and thrown away.
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0, // pass-on-retry = flaky, not an issue
  reporter: [['list'], ['json', { outputFile: path.join(repoRoot, 'journeys-report', 'report.json') }]],
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 5, // soaked at 0 px noise (DOM-only, 136 runs); one changed letter of small text is 12 px
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
});
