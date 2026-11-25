import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeAnalyticsSummary,
  computeApplicationAnalytics,
  computeResponseRateBySource,
  computeResponseTimeDistribution,
  computeSalaryEffectiveness,
  deriveApplicationSource,
  getAnnualizedPay,
  getDaysToFirstResponse,
  getSalaryBucket,
  getSourceNudge,
  hasEmployerResponse,
  isSentApplication,
} from '../lib/analytics.js';

import { addApplication, updateApplication } from '../lib/tracker.js';

function installChromeStorageMock(seed = {}) {
  const state = { ...seed };
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: state[key] };
          if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, state[item]]));
          return { ...state };
        },
        async set(value) {
          Object.assign(state, value);
        },
      },
    },
  };
  return state;
}

// Fixture: 5 sent applications (3 with responses) plus one drafted entry that
// must never reach the denominator.
function sampleApplications() {
  return [
    {
      id: '1',
      status: 'submitted',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      date: '2026-01-01',
      pay_min: 100000,
      pay_max: 120000,
    },
    {
      id: '2',
      status: 'interview',
      url: 'https://boards.greenhouse.io/acme/jobs/2',
      date: '2026-01-01',
      first_response_at: '2026-01-06T12:00:00.000Z',
      pay_min: 130000,
      pay_max: 150000,
    },
    {
      id: '3',
      status: 'rejected',
      url: 'https://jobs.lever.co/northwind/3',
      date: '2026-01-01',
      first_response_at: '2026-01-13T00:00:00.000Z',
      pay_min: 0,
      pay_max: 0,
    },
    {
      id: '4',
      status: 'submitted',
      url: 'https://jobs.lever.co/northwind/4',
      date: '2026-01-02',
      pay_min: 90000,
      pay_max: 90000,
    },
    {
      id: '5',
      status: 'drafted',
      url: 'https://boards.greenhouse.io/acme/jobs/5',
      date: '2026-01-01',
      pay_min: 500000,
      pay_max: 500000,
    },
    {
      id: '6',
      status: 'offer',
      url: 'https://www.linkedin.com/jobs/view/6',
      date: '2026-01-01',
      first_response_at: '2026-01-21T00:00:00.000Z',
      pay_min: 200000,
      pay_max: 220000,
    },
  ];
}

// ── Predicates ───────────────────────────────────────────────────────────────

test('only sent applications count, and only real replies count as responses', () => {
  assert.equal(isSentApplication({ status: 'drafted' }), false);
  assert.equal(isSentApplication({ status: 'filled' }), false);
  assert.equal(isSentApplication({ status: 'submitted' }), true);
  assert.equal(isSentApplication({ status: 'applied' }), true, 'legacy "applied" normalizes to submitted');
  assert.equal(isSentApplication({ status: 'retired' }), true);

  assert.equal(hasEmployerResponse({ status: 'interview' }), true);
  assert.equal(hasEmployerResponse({ status: 'offer' }), true);
  assert.equal(hasEmployerResponse({ status: 'rejected' }), true);
  assert.equal(hasEmployerResponse({ status: 'submitted' }), false);
  assert.equal(hasEmployerResponse({ status: 'retired' }), false, 'silence is not a response');
});

// ── Source derivation ────────────────────────────────────────────────────────

test('source derivation prefers the stored field and falls back to the URL host', () => {
  assert.equal(deriveApplicationSource({ source: 'Remotive', url: 'https://x.com' }), 'Remotive');
  assert.equal(deriveApplicationSource({ url: 'https://boards.greenhouse.io/acme/jobs/1' }), 'Greenhouse');
  assert.equal(deriveApplicationSource({ url: 'https://jobs.lever.co/northwind/3' }), 'Lever');
  assert.equal(deriveApplicationSource({ url: 'https://acme.ashbyhq.com/roles/x' }), 'Ashby');
  assert.equal(deriveApplicationSource({ url: 'https://acme.wd1.myworkdayjobs.com/x' }), 'Workday');
  assert.equal(deriveApplicationSource({ url: 'https://www.linkedin.com/jobs/view/6' }), 'LinkedIn');
  assert.equal(deriveApplicationSource({ url: 'https://careers.example.com/jobs/9' }), 'careers.example.com');
  assert.equal(deriveApplicationSource({ url: 'www.example.org/jobs' }), 'example.org', 'tolerates a missing scheme');
  assert.equal(deriveApplicationSource({}), 'Unknown');
});

// ── Salary bucketing ─────────────────────────────────────────────────────────

test('pay is annualized and bucketed by band midpoint', () => {
  assert.equal(getAnnualizedPay({ pay_min: 100000, pay_max: 120000 }), 110000);
  assert.equal(getAnnualizedPay({ pay_min: 0, pay_max: 150000 }), 150000);
  assert.equal(getAnnualizedPay({ pay_min: 60, pay_max: 60 }), 124800, 'hourly rates annualize at 2080h');
  assert.equal(getAnnualizedPay({}), 0);

  assert.equal(getSalaryBucket({ pay_min: 70000, pay_max: 70000 }).id, 'under_80k');
  assert.equal(getSalaryBucket({ pay_min: 80000, pay_max: 80000 }).id, '80k_120k', 'bucket floors are inclusive');
  assert.equal(getSalaryBucket({ pay_min: 60, pay_max: 60 }).id, '120k_160k');
  assert.equal(getSalaryBucket({ pay_min: 250000, pay_max: 250000 }).id, 'over_200k');
  assert.equal(getSalaryBucket({}).id, 'unknown');
});

test('salary effectiveness keeps ascending bands, drops empty ones, and rates each', () => {
  const rows = computeSalaryEffectiveness(sampleApplications());

  assert.deepEqual(rows.map((row) => row.id), ['80k_120k', '120k_160k', 'over_200k', 'unknown']);

  const lowBand = rows.find((row) => row.id === '80k_120k');
  assert.equal(lowBand.sent, 2, 'the $500k drafted entry must not leak in');
  assert.equal(lowBand.responses, 0);
  assert.equal(lowBand.responseRate, 0);

  const topBand = rows.find((row) => row.id === 'over_200k');
  assert.equal(topBand.sent, 1);
  assert.equal(topBand.responseRate, 100);
});

// ── Response rate by source ──────────────────────────────────────────────────

test('response rate by source groups sent applications and sorts by volume', () => {
  const rows = computeResponseRateBySource(sampleApplications());

  assert.deepEqual(rows.map((row) => row.source), ['Greenhouse', 'Lever', 'LinkedIn']);

  const greenhouse = rows[0];
  assert.equal(greenhouse.sent, 2, 'the drafted Greenhouse lead is excluded');
  assert.equal(greenhouse.responses, 1);
  assert.equal(greenhouse.responseRate, 50);
  assert.equal(greenhouse.interviews, 1);

  const linkedin = rows[2];
  assert.equal(linkedin.sent, 1);
  assert.equal(linkedin.responseRate, 100);
  assert.equal(linkedin.offers, 1);
});

test('response rate by source handles an empty tracker', () => {
  assert.deepEqual(computeResponseRateBySource([]), []);
  assert.deepEqual(computeResponseRateBySource(), []);
});

test('source nudge needs enough history and a clear advantage', () => {
  const app = (n, host, status) => ({
    id: String(n),
    status,
    url: 'https://' + host + '/job/' + n,
    date: '2026-01-01',
    first_response_at: status === 'interview' ? '2026-01-05T00:00:00.000Z' : undefined,
  });

  const data = [
    app(1, 'boards.greenhouse.io', 'interview'),
    app(2, 'boards.greenhouse.io', 'interview'),
    app(3, 'boards.greenhouse.io', 'interview'),
    app(4, 'boards.greenhouse.io', 'submitted'),
    app(5, 'boards.greenhouse.io', 'submitted'),
    app(6, 'jobs.lever.co', 'submitted'),
    app(7, 'jobs.lever.co', 'submitted'),
    app(8, 'jobs.lever.co', 'submitted'),
    app(9, 'jobs.lever.co', 'submitted'),
    app(10, 'jobs.lever.co', 'submitted'),
  ];

  assert.equal(
    getSourceNudge(data, 'Greenhouse'),
    'Greenhouse boards respond 2x more often than your average.'
  );
  assert.equal(getSourceNudge(data, 'Lever'), null);
  assert.equal(getSourceNudge(data, 'Nowhere'), null);
  assert.equal(getSourceNudge(data.slice(0, 4), 'Greenhouse'), null);
  assert.equal(getSourceNudge([], 'Greenhouse'), null);
});

// ── Time to first response ───────────────────────────────────────────────────

test('days to first response measures submitted date to first reply', () => {
  assert.equal(getDaysToFirstResponse({
    status: 'interview', date: '2026-01-01', first_response_at: '2026-01-08T00:00:00.000Z',
  }), 7);

  assert.equal(getDaysToFirstResponse({
    status: 'rejected', date: '2026-01-01', updated_at: '2026-01-04T00:00:00.000Z',
  }), 3, 'legacy entries fall back to updated_at');

  assert.equal(getDaysToFirstResponse({ status: 'submitted', date: '2026-01-01' }), null,
    'no response means no timing');
  assert.equal(getDaysToFirstResponse({
    status: 'interview', first_response_at: '2026-01-08T00:00:00.000Z',
  }), null, 'no submission date means no timing');
  assert.equal(getDaysToFirstResponse({
    status: 'interview', date: '2026-02-01', first_response_at: '2026-01-08T00:00:00.000Z',
  }), 0, 'a response dated before submission clamps to 0 rather than going negative');
});

test('time-to-response distribution buckets against everything sent', () => {
  const dist = computeResponseTimeDistribution(sampleApplications());

  assert.equal(dist.totalSent, 5);
  assert.equal(dist.respondedCount, 3);
  assert.equal(dist.timedCount, 3);
  assert.equal(dist.noResponseCount, 2);

  // Response waits are 5, 12 and 20 days.
  assert.equal(dist.medianDays, 12);
  assert.equal(dist.fastestDays, 5);
  assert.equal(dist.slowestDays, 20);

  assert.equal(dist.withinOneWeekCount, 1);
  assert.equal(dist.withinOneWeekPct, 20);
  assert.equal(dist.withinTwoWeeksCount, 2, 'the two-week bucket is cumulative');
  assert.equal(dist.withinTwoWeeksPct, 40);
  assert.equal(dist.noResponsePct, 40);
  assert.equal(dist.withinTwoWeeksPct + dist.noResponsePct + 20, 100,
    'cumulative buckets plus silence account for the whole pipeline');
});

test('median averages the middle pair for an even number of responses', () => {
  const dist = computeResponseTimeDistribution([
    { status: 'interview', date: '2026-01-01', first_response_at: '2026-01-03T00:00:00.000Z' },
    { status: 'interview', date: '2026-01-01', first_response_at: '2026-01-06T00:00:00.000Z' },
    { status: 'rejected', date: '2026-01-01', first_response_at: '2026-01-10T00:00:00.000Z' },
    { status: 'offer', date: '2026-01-01', first_response_at: '2026-01-21T00:00:00.000Z' },
  ]);

  // Waits are 2, 5, 9, 20 → median of 5 and 9.
  assert.equal(dist.medianDays, 7);
});

test('untimeable responses are reported instead of silently dropped', () => {
  const dist = computeResponseTimeDistribution([
    { status: 'interview', first_response_at: '2026-01-06T00:00:00.000Z' },
    { status: 'submitted', date: '2026-01-01' },
  ]);

  assert.equal(dist.respondedCount, 1);
  assert.equal(dist.timedCount, 0);
  assert.equal(dist.unknownTimingCount, 1);
  assert.equal(dist.medianDays, null);
});

test('responses without first_response_at are counted as estimated', () => {
  const dist = computeResponseTimeDistribution([
    { status: 'interview', date: '2026-01-01', updated_at: '2026-01-05T00:00:00.000Z' },
    { status: 'offer', date: '2026-01-01', first_response_at: '2026-01-09T00:00:00.000Z' },
  ]);

  assert.equal(dist.timedCount, 2);
  assert.equal(dist.estimatedTimingCount, 1);
});

test('an empty tracker produces zeroed, non-throwing timing stats', () => {
  const dist = computeResponseTimeDistribution([]);
  assert.equal(dist.totalSent, 0);
  assert.equal(dist.medianDays, null);
  assert.equal(dist.withinOneWeekPct, 0);
  assert.equal(dist.noResponsePct, 0);
});

// ── Summary ──────────────────────────────────────────────────────────────────

test('summary reports totals, overall rate, and average time to response', () => {
  const summary = computeAnalyticsSummary(sampleApplications());

  assert.equal(summary.totalTracked, 6);
  assert.equal(summary.totalSent, 5);
  assert.equal(summary.totalResponses, 3);
  assert.equal(summary.responseRate, 60);
  assert.equal(summary.interviews, 1);
  assert.equal(summary.offers, 1);
  // (5 + 12 + 20) / 3 = 12.333…
  assert.equal(summary.averageDaysToResponse, 12.3);
  assert.equal(summary.medianDaysToResponse, 12);
});

test('summary of an empty tracker stays at zero without dividing by zero', () => {
  const summary = computeAnalyticsSummary([]);
  assert.equal(summary.totalSent, 0);
  assert.equal(summary.responseRate, 0);
  assert.equal(summary.averageDaysToResponse, null);
});

test('computeApplicationAnalytics bundles every section', () => {
  const analytics = computeApplicationAnalytics(sampleApplications());
  assert.deepEqual(Object.keys(analytics).sort(), ['bySalary', 'bySource', 'responseTime', 'summary']);
  assert.equal(analytics.summary.responseRate, 60);
  assert.equal(analytics.bySource.length, 3);
});

// ── Storage schema support ───────────────────────────────────────────────────

test('tracker stamps first_response_at once and keeps it stable across later stages', async () => {
  installChromeStorageMock({ applications: [] });

  const saved = await addApplication({
    company: 'Acme',
    title: 'Platform Engineer',
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    status: 'submitted',
    source: 'Greenhouse',
    date: '2026-01-01',
  });

  assert.equal(saved.source, 'Greenhouse', 'source is persisted for analytics');
  assert.equal(saved.first_response_at, '', 'a submitted application has no response yet');

  const interviewing = await updateApplication(saved.id, { status: 'interview' });
  assert.notEqual(interviewing.first_response_at, '', 'moving into interview stamps the first reply');
  const stampedAt = interviewing.first_response_at;

  const offered = await updateApplication(saved.id, { status: 'offer' });
  assert.equal(offered.first_response_at, stampedAt,
    'advancing to offer must not reset the first-response timestamp');

  const rejected = await updateApplication(saved.id, { status: 'rejected' });
  assert.equal(rejected.first_response_at, stampedAt);

  assert.equal(hasEmployerResponse(rejected), true);
  assert.equal(deriveApplicationSource(rejected), 'Greenhouse');
});

test('applications already in a response lane backfill from updated_at, not today', async () => {
  installChromeStorageMock({
    applications: [{
      id: 'legacy-1',
      company: 'Northwind',
      title: 'Infra Engineer',
      url: 'https://jobs.lever.co/northwind/1',
      status: 'interview',
      date: '2026-01-01',
      updated_at: '2026-01-09T00:00:00.000Z',
    }],
  });

  const updated = await updateApplication('legacy-1', { verdict: 'Strong fit' });

  assert.equal(updated.first_response_at, '2026-01-09T00:00:00.000Z');
  assert.equal(getDaysToFirstResponse(updated), 8, 'backfilled timing stays historically accurate');
});
