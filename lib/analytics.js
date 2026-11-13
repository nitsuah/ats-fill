/**
 * apply-bot — analytics.js
 * Pure aggregation helpers for the application analytics panel.
 *
 * Everything here is derived from the tracker entries already in
 * chrome.storage.local (`applications`). No network calls, no chrome APIs —
 * these are plain functions so they stay unit-testable.
 */

import { normalizeApplicationStatus, RESPONSE_STATUSES } from './tracker.js';

// Statuses that mean the application actually left the building. Drafted /
// filled entries were never sent, so counting them would deflate response rate.
export const SENT_STATUSES = ['submitted', 'pending', 'interview', 'offer', 'rejected', 'retired'];

export { RESPONSE_STATUSES };

const MS_PER_DAY = 86400000;
const HOURS_PER_YEAR = 2080;

// Hostname → friendly source label. Anything unmatched falls back to the bare
// hostname, which is usually a company career site.
const SOURCE_HOST_MAP = [
  ['greenhouse.io', 'Greenhouse'],
  ['lever.co', 'Lever'],
  ['ashbyhq.com', 'Ashby'],
  ['myworkdayjobs.com', 'Workday'],
  ['workday.com', 'Workday'],
  ['icims.com', 'iCIMS'],
  ['jobvite.com', 'Jobvite'],
  ['phenompeople.com', 'Phenom'],
  ['linkedin.com', 'LinkedIn'],
  ['indeed.com', 'Indeed'],
  ['remotive.com', 'Remotive'],
  ['arbeitnow.com', 'Arbeitnow'],
  ['themuse.com', 'The Muse'],
  ['adzuna.com', 'Adzuna'],
  ['usajobs.gov', 'USAJOBS'],
  ['remoteok.com', 'RemoteOK'],
  ['jobicy.com', 'Jobicy'],
  ['workingnomads.com', 'Working Nomads'],
  ['reed.co.uk', 'Reed'],
  ['jooble.org', 'Jooble'],
  ['algolia.com', 'Hacker News'],
  ['ycombinator.com', 'Hacker News'],
  ['weworkremotely.com', 'We Work Remotely'],
  ['remote.co', 'Remote.co'],
];

export const SALARY_BUCKETS = [
  { id: 'under_80k', label: 'Under $80k', min: 0, max: 80000 },
  { id: '80k_120k', label: '$80k – $120k', min: 80000, max: 120000 },
  { id: '120k_160k', label: '$120k – $160k', min: 120000, max: 160000 },
  { id: '160k_200k', label: '$160k – $200k', min: 160000, max: 200000 },
  { id: 'over_200k', label: '$200k+', min: 200000, max: Infinity },
];

export const UNKNOWN_SALARY_BUCKET = { id: 'unknown', label: 'No salary recorded' };

// ── Predicates ───────────────────────────────────────────────────────────────

/**
 * Whether an application was actually sent to an employer.
 *
 * Drafted and filled entries are excluded — they never left the building, so
 * counting them would deflate every response-rate denominator.
 *
 * @param {{ status?: string }} app Tracked application record.
 * @returns {boolean} True when the status is Submitted or later.
 */
export function isSentApplication(app) {
  return SENT_STATUSES.includes(normalizeApplicationStatus(app?.status));
}

/**
 * Whether an employer actually replied to an application.
 *
 * `retired` (job unlisted / silence) is deliberately not a response — grouping
 * it with rejections would inflate the response rate.
 *
 * @param {{ status?: string }} app Tracked application record.
 * @returns {boolean} True for interview, offer, or rejected.
 */
export function hasEmployerResponse(app) {
  return RESPONSE_STATUSES.includes(normalizeApplicationStatus(app?.status));
}

// ── Field derivation ─────────────────────────────────────────────────────────

/**
 * Where an application came from.
 *
 * Prefers an explicit `source` field (written by newer Job Search saves), and
 * otherwise derives it from the job URL's hostname so historical entries — which
 * predate the field — still bucket usefully.
 *
 * @param {object} app
 * @returns {string}
 */
export function deriveApplicationSource(app) {
  const explicit = String(app?.source || '').trim();
  if (explicit) return explicit;

  const url = String(app?.url || '').trim();
  if (!url) return 'Unknown';

  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Tolerate bare hostnames pasted without a scheme.
    const match = url.toLowerCase().match(/^(?:[a-z]+:\/\/)?([^/?#\s]+)/);
    host = match ? match[1] : '';
  }
  if (!host) return 'Unknown';

  for (const [needle, label] of SOURCE_HOST_MAP) {
    if (host === needle || host.endsWith('.' + needle)) return label;
  }

  return host.replace(/^www\./, '') || 'Unknown';
}

/**
 * Timestamp (ms) of the first employer response, or null if there wasn't one.
 *
 * Uses `first_response_at` when present. Legacy entries saved before that field
 * existed fall back to `updated_at`, which is the moment the user moved the card
 * into a response lane — an approximation, flagged as `estimated` by callers.
 *
 * @param {object} app
 * @returns {number|null}
 */
export function getFirstResponseTime(app) {
  if (!hasEmployerResponse(app)) return null;
  const explicit = parseTimestamp(app?.first_response_at);
  if (explicit !== null) return explicit;
  return parseTimestamp(app?.updated_at);
}

/**
 * Whole days between the submission date and the first response.
 * Returns null when either end is missing or the data is inconsistent.
 *
 * @param {object} app
 * @returns {number|null}
 */
export function getDaysToFirstResponse(app) {
  const submitted = parseTimestamp(app?.date);
  const responded = getFirstResponseTime(app);
  if (submitted === null || responded === null) return null;
  const days = Math.floor((responded - submitted) / MS_PER_DAY);
  // A response stamped before the submission date means bad data, not a
  // negative wait — clamp instead of discarding the application entirely.
  return days < 0 ? 0 : days;
}

/**
 * Midpoint of an application's pay band, normalized to annual dollars.
 * Values under $1,000 are read as hourly rates and annualized.
 *
 * @param {object} app
 * @returns {number} 0 when no usable salary is recorded.
 */
export function getAnnualizedPay(app) {
  const min = annualize(app?.pay_min);
  const max = annualize(app?.pay_max);
  if (min && max) return Math.round((min + max) / 2);
  return min || max || 0;
}

export function getSalaryBucket(app) {
  const pay = getAnnualizedPay(app);
  if (!pay) return UNKNOWN_SALARY_BUCKET;
  return SALARY_BUCKETS.find((bucket) => pay >= bucket.min && pay < bucket.max) || UNKNOWN_SALARY_BUCKET;
}

// ── Aggregations ─────────────────────────────────────────────────────────────

/**
 * Response rate per job source, sorted by volume then rate.
 *
 * @param {object[]} applications
 * @returns {{source: string, sent: number, responses: number, responseRate: number}[]}
 */
export function computeResponseRateBySource(applications = []) {
  const sent = (applications || []).filter(isSentApplication);
  const groups = new Map();

  for (const app of sent) {
    const source = deriveApplicationSource(app);
    const group = groups.get(source) || { source, sent: 0, responses: 0, interviews: 0, offers: 0, rejections: 0 };
    group.sent += 1;
    const status = normalizeApplicationStatus(app?.status);
    if (status === 'interview') group.interviews += 1;
    if (status === 'offer') group.offers += 1;
    if (status === 'rejected') group.rejections += 1;
    if (hasEmployerResponse(app)) group.responses += 1;
    groups.set(source, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, responseRate: rate(group.responses, group.sent) }))
    .sort((a, b) => b.sent - a.sent || b.responseRate - a.responseRate || a.source.localeCompare(b.source));
}

/**
 * Response rate per salary band, so the user can see whether aiming higher or
 * lower correlates with hearing back. Buckets stay in ascending order (with the
 * unknown bucket last) so the chart reads as a range, not a leaderboard.
 *
 * @param {object[]} applications
 * @returns {{id: string, label: string, sent: number, responses: number, responseRate: number}[]}
 */
export function computeSalaryEffectiveness(applications = []) {
  const sent = (applications || []).filter(isSentApplication);
  const order = [...SALARY_BUCKETS, UNKNOWN_SALARY_BUCKET];
  const groups = new Map(order.map((bucket) => [bucket.id, { id: bucket.id, label: bucket.label, sent: 0, responses: 0 }]));

  for (const app of sent) {
    const bucket = getSalaryBucket(app);
    const group = groups.get(bucket.id);
    if (!group) continue;
    group.sent += 1;
    if (hasEmployerResponse(app)) group.responses += 1;
  }

  return order
    .map((bucket) => groups.get(bucket.id))
    .filter((group) => group.sent > 0)
    .map((group) => ({ ...group, responseRate: rate(group.responses, group.sent) }));
}

/**
 * How long responses take.
 *
 * Percentages are shares of everything sent (not just of things that got a
 * reply), so `withinOneWeekPct + ... + noResponsePct` describes the whole
 * pipeline. `unknownTimingCount` covers responses we can't date because the
 * entry has no submission date.
 *
 * @param {object[]} applications
 */
export function computeResponseTimeDistribution(applications = []) {
  const sent = (applications || []).filter(isSentApplication);
  const responded = sent.filter(hasEmployerResponse);

  const dayValues = [];
  let unknownTimingCount = 0;
  for (const app of responded) {
    const days = getDaysToFirstResponse(app);
    if (days === null) unknownTimingCount += 1;
    else dayValues.push(days);
  }
  dayValues.sort((a, b) => a - b);

  const withinOneWeek = dayValues.filter((days) => days <= 7).length;
  const withinTwoWeeks = dayValues.filter((days) => days <= 14).length;
  const noResponse = sent.length - responded.length;

  return {
    totalSent: sent.length,
    respondedCount: responded.length,
    timedCount: dayValues.length,
    unknownTimingCount,
    noResponseCount: noResponse,
    medianDays: median(dayValues),
    fastestDays: dayValues.length ? dayValues[0] : null,
    slowestDays: dayValues.length ? dayValues[dayValues.length - 1] : null,
    withinOneWeekCount: withinOneWeek,
    withinTwoWeeksCount: withinTwoWeeks,
    withinOneWeekPct: rate(withinOneWeek, sent.length),
    withinTwoWeeksPct: rate(withinTwoWeeks, sent.length),
    noResponsePct: rate(noResponse, sent.length),
  };
}

/**
 * Headline numbers for the top of the panel.
 *
 * @param {object[]} applications
 */
export function computeAnalyticsSummary(applications = []) {
  const all = applications || [];
  const sent = all.filter(isSentApplication);
  const responded = sent.filter(hasEmployerResponse);

  const dayValues = responded
    .map(getDaysToFirstResponse)
    .filter((days) => days !== null);

  const interviews = sent.filter((app) => normalizeApplicationStatus(app?.status) === 'interview').length;
  const offers = sent.filter((app) => normalizeApplicationStatus(app?.status) === 'offer').length;

  return {
    totalTracked: all.length,
    totalSent: sent.length,
    totalResponses: responded.length,
    responseRate: rate(responded.length, sent.length),
    interviews,
    offers,
    averageDaysToResponse: dayValues.length
      ? Math.round((dayValues.reduce((sum, days) => sum + days, 0) / dayValues.length) * 10) / 10
      : null,
    medianDaysToResponse: median(dayValues.slice().sort((a, b) => a - b)),
  };
}

/**
 * Everything the panel renders, in one pass.
 *
 * @param {object[]} applications
 */
export function computeApplicationAnalytics(applications = []) {
  return {
    summary: computeAnalyticsSummary(applications),
    bySource: computeResponseRateBySource(applications),
    bySalary: computeSalaryEffectiveness(applications),
    responseTime: computeResponseTimeDistribution(applications),
  };
}

// ── Internals ────────────────────────────────────────────────────────────────

function rate(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function median(sortedValues = []) {
  if (!sortedValues.length) return null;
  const mid = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[mid];
  return Math.round(((sortedValues[mid - 1] + sortedValues[mid]) / 2) * 10) / 10;
}

function parseTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  // Bare YYYY-MM-DD parses as UTC midnight, which is what we want for day math.
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

function annualize(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num < 1000 ? Math.round(num * HOURS_PER_YEAR) : Math.round(num);
}
