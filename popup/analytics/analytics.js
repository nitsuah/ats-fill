// analytics.js
// Application analytics panel: aggregate stats derived from the tracker.
// Everything renders from chrome.storage.local — no network calls.

import { $, esc, sendMessage } from '../../lib/utils.js';
import { computeApplicationAnalytics } from '../../lib/analytics.js';
import { showScreen, isStandaloneView, openExpandedWorkspace } from '../ux/navigation.js';
import { setStatus } from '../ux/state.js';

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * Replace the panel body with an error state and set the status line.
 *
 * Both are needed: leaving the previous render in place would let a stale
 * set of metrics stay on screen while the status line reports a failure.
 *
 * @param {HTMLElement} body The `#analytics-body` container.
 * @param {string} message Human-readable failure text.
 * @returns {void}
 */
function showLoadError(body, message) {
  body.innerHTML = `<p class="empty-msg">${esc(message)}</p>`;
  setStatus('analytics-status', '❌ ' + message, 'error');
}

/**
 * Render the analytics panel into `#analytics-body`.
 *
 * Reads tracked applications from the service worker and replaces the panel
 * body with the summary, source, salary, and response-time sections. No-ops
 * when the container is absent (the popup is on another screen).
 *
 * @returns {Promise<void>} Resolves once the panel has been rendered, or early
 *   if the container is missing or tracker data could not be loaded.
 */
export async function renderAnalytics() {
  const body = $('analytics-body');
  if (!body) return;

  let applications = [];
  try {
    const resp = await sendMessage({ type: 'GET_STATE' });
    // sendMessage resolves null on timeout, chrome.runtime.lastError, and
    // caught send errors. Treating that as an empty list would render "no
    // applications yet" over a transport failure.
    if (!resp) {
      showLoadError(body, 'Could not load tracker data.');
      return;
    }
    applications = resp.applications || [];
  } catch (err) {
    showLoadError(body, 'Could not load tracker data: ' + (err?.message || err));
    return;
  }

  const analytics = computeApplicationAnalytics(applications);
  const { summary } = analytics;

  if (!summary.totalSent) {
    body.innerHTML = `<p class="empty-msg">No submitted applications yet. Analytics appear once applications reach Submitted or later — drafted and filled entries are excluded because they were never sent.</p>`;
    setStatus('analytics-status', `${summary.totalTracked} tracked · 0 sent`, '');
    return;
  }

  body.innerHTML = [
    renderSummary(summary),
    renderSourceSection(analytics.bySource),
    renderSalarySection(analytics.bySalary),
    renderResponseTimeSection(analytics.responseTime),
  ].join('');

  setStatus(
    'analytics-status',
    `${summary.totalSent} sent · ${summary.totalResponses} responses · ${fmtPct(summary.responseRate)} response rate`,
    ''
  );
}

function renderSummary(summary) {
  const tiles = [
    { label: 'Applications sent', value: String(summary.totalSent), hint: `${summary.totalTracked} tracked in total` },
    { label: 'Responses', value: String(summary.totalResponses), hint: `${summary.interviews} interview · ${summary.offers} offer` },
    { label: 'Response rate', value: fmtPct(summary.responseRate), hint: 'Share of sent applications that got a reply' },
    {
      label: 'Avg. time to response',
      value: summary.averageDaysToResponse === null ? '—' : `${summary.averageDaysToResponse}d`,
      hint: summary.medianDaysToResponse === null ? 'No dated responses yet' : `Median ${summary.medianDaysToResponse}d`,
    },
  ];

  return `
    <section class="analytics-section" aria-label="Summary">
      <div class="analytics-stat-grid">
        ${tiles.map((tile) => `
          <div class="analytics-stat">
            <span class="analytics-stat-value">${esc(tile.value)}</span>
            <span class="analytics-stat-label">${esc(tile.label)}</span>
            <span class="analytics-stat-hint">${esc(tile.hint)}</span>
          </div>`).join('')}
      </div>
    </section>`;
}

function renderSourceSection(rows) {
  const body = rows.length
    ? renderBarRows(rows.map((row) => ({
      label: row.source,
      pct: row.responseRate,
      meta: `${row.responses}/${row.sent}`,
      title: `${row.source}: ${row.responses} of ${row.sent} sent applications got a response (${fmtPct(row.responseRate)}).`,
    })))
    : '<p class="empty-msg">No sources to compare yet.</p>';

  return sectionShell(
    'Response rate by source',
    'Sources come from the saved job URL when the listing predates source tracking.',
    body
  );
}

function renderSalarySection(rows) {
  const body = rows.length
    ? renderBarRows(rows.map((row) => ({
      label: row.label,
      pct: row.responseRate,
      meta: `${row.responses}/${row.sent}`,
      title: `${row.label}: ${row.responses} of ${row.sent} sent applications got a response (${fmtPct(row.responseRate)}).`,
    })))
    : '<p class="empty-msg">No salary data recorded yet.</p>';

  return sectionShell(
    'Salary range effectiveness',
    'Bands use the midpoint of each recorded pay range, annualized. Small buckets are noisy — read the counts, not just the bars.',
    body
  );
}

function renderResponseTimeSection(dist) {
  const rows = renderBarRows([
    {
      label: 'Responded within 1 week',
      pct: dist.withinOneWeekPct,
      meta: `${dist.withinOneWeekCount}/${dist.totalSent}`,
      title: `${dist.withinOneWeekCount} of ${dist.totalSent} sent applications got a reply within 7 days.`,
    },
    {
      label: 'Responded within 2 weeks',
      pct: dist.withinTwoWeeksPct,
      meta: `${dist.withinTwoWeeksCount}/${dist.totalSent}`,
      title: `${dist.withinTwoWeeksCount} of ${dist.totalSent} sent applications got a reply within 14 days.`,
    },
    {
      label: 'No response yet',
      pct: dist.noResponsePct,
      meta: `${dist.noResponseCount}/${dist.totalSent}`,
      title: `${dist.noResponseCount} of ${dist.totalSent} sent applications have not had a reply.`,
      tone: 'muted',
    },
  ]);

  const facts = [
    `Median time to first response: <strong>${dist.medianDays === null ? '—' : dist.medianDays + ' days'}</strong>`,
    dist.fastestDays === null ? '' : `Fastest ${dist.fastestDays}d · slowest ${dist.slowestDays}d`,
    dist.unknownTimingCount
      ? `${dist.unknownTimingCount} response${dist.unknownTimingCount === 1 ? '' : 's'} could not be timed (no submission date recorded).`
      : '',
    dist.estimatedTimingCount
      ? `${dist.estimatedTimingCount} response time${dist.estimatedTimingCount === 1 ? '' : 's'} ${dist.estimatedTimingCount === 1 ? 'is an estimate' : 'are estimates'} (logged before first-response dates were recorded).`
      : '',
  ].filter(Boolean);

  return sectionShell(
    'Time to first response',
    'Measured from the submitted date to the first move into Interview, Offer, or Rejected.',
    `${rows}<ul class="analytics-facts">${facts.map((fact) => `<li>${fact}</li>`).join('')}</ul>`
  );
}

// ── Shared markup helpers ────────────────────────────────────────────────────

function sectionShell(title, hint, body) {
  return `
    <section class="help-card analytics-section">
      <div class="report-header">
        <span class="report-title">${esc(title)}</span>
      </div>
      <p class="helper-text">${esc(hint)}</p>
      ${body}
    </section>`;
}

function renderBarRows(rows) {
  return `<div class="analytics-bars">${rows.map((row) => `
    <div class="analytics-bar-row" title="${esc(row.title || '')}">
      <span class="analytics-bar-label">${esc(row.label)}</span>
      <span class="analytics-bar-track">
        <span class="analytics-bar-fill${row.tone === 'muted' ? ' is-muted' : ''}" style="width:${clampPct(row.pct)}%"></span>
      </span>
      <span class="analytics-bar-value">${esc(fmtPct(row.pct))}</span>
      <span class="analytics-bar-meta">${esc(row.meta)}</span>
    </div>`).join('')}</div>`;
}

function fmtPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num}%`;
}

function clampPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(100, num);
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Wire the analytics entry points (header button and tracker toolbar button).
 *
 * Both open the expanded workspace tab when invoked from the popup, falling
 * back to in-popup rendering when the workspace cannot be opened.
 *
 * @returns {void}
 */
export function initAnalyticsHandlers() {
  const open = async () => {
    // Analytics is a wide, table-ish view — prefer the expanded workspace tab,
    // the same way the tracker and job search do.
    if (!isStandaloneView()) {
      const opened = await openExpandedWorkspace('analytics');
      if (opened) return;
    }
    showScreen('analytics');
    await renderAnalytics();
  };

  $('header-analytics-btn')?.addEventListener('click', open);
  $('tracker-analytics-btn')?.addEventListener('click', open);
  $('analytics-refresh-btn')?.addEventListener('click', renderAnalytics);
}
