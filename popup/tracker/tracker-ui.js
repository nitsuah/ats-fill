// tracker-ui.js
// Tracker board rendering: lanes, cards, sorting, filtering

import { $, esc, escAttr, sendMessage, formatDate, formatDateInput, formatSavedTimestamp, renderStatusOptions, renderEmploymentTypeOptions } from '../../lib/utils.js';
import { normalizeApplicationStatus } from '../../lib/tracker.js';
import { expandedTrackerIds, trackerViewState } from './tracker-state.js';
import { getTrackingStatusMeta, TRACKER_STATUS_ORDER } from './tracker-meta.js';

const selectedFinalStageBubbleIds = new Set();

const VERDICT_OPTIONS = [
  { value: 'strong_yes', label: 'Strong yes' },
  { value: 'lean_yes', label: 'Lean yes' },
  { value: 'neutral', label: 'Neutral / maybe' },
  { value: 'lean_no', label: 'Lean no' },
  { value: 'no', label: 'No, not a fit' },
  { value: 'research', label: 'Need more research' },
  { value: 'interview_prep', label: 'Interview prep' },
];

const USA_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida',
  'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska',
  'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas',
  'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
];

const NA_COUNTRIES = ['Canada', 'Mexico', 'Bermuda', 'Greenland', 'Bahamas', 'Costa Rica', 'Panama'];

// Re-export filterTrackerApplications from lib
export { filterApplicationsForQuery as filterTrackerApplications } from '../../lib/tracker.js';

// ── Sorting ─────────────────────────────────────────────────────────────────

function payRankValue(app) {
  // Rank by the top of the band, falling back to the floor.
  const max = Number(app?.pay_max) || 0;
  const min = Number(app?.pay_min) || 0;
  return Math.max(max, min);
}

export function sortTrackerApplications(applications = []) {
  const list = [...(applications || [])];
  const mode = trackerViewState.sortMode || 'smart';

  if (mode === 'pay_desc') {
    return list.sort((a, b) => payRankValue(b) - payRankValue(a)
      || parseSortableDateTime(b?.updated_at) - parseSortableDateTime(a?.updated_at));
  }
  if (mode === 'submitted_desc') {
    return list.sort((a, b) => parseSortableDate(b?.date) - parseSortableDate(a?.date)
      || parseSortableDateTime(b?.updated_at) - parseSortableDateTime(a?.updated_at));
  }
  if (mode === 'updated_desc') {
    return list.sort((a, b) => parseSortableDateTime(b?.updated_at) - parseSortableDateTime(a?.updated_at));
  }

  // 'smart' (default): recency of submission, then last update, then manual order.
  return list.sort((a, b) => {
    const aDate = parseSortableDate(a?.date);
    const bDate = parseSortableDate(b?.date);
    if (aDate !== bDate) {
      return bDate - aDate;
    }

    const aUpdated = parseSortableDateTime(a?.updated_at);
    const bUpdated = parseSortableDateTime(b?.updated_at);
    if (aUpdated !== bUpdated) {
      return bUpdated - aUpdated;
    }

    const aOrder = Number(a?.sort_order);
    const bOrder = Number(b?.sort_order);
    const hasA = Number.isFinite(aOrder);
    const hasB = Number.isFinite(bOrder);
    if (hasA || hasB) {
      return (hasB ? bOrder : Number.NEGATIVE_INFINITY) - (hasA ? aOrder : Number.NEGATIVE_INFINITY);
    }

    return String(b?.id || '').localeCompare(String(a?.id || ''));
  });
}

function parseSortableDate(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const ms = Date.parse(`${text}T00:00:00`);
  return Number.isFinite(ms) ? ms : 0;
}

function parseSortableDateTime(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

// ── Filter UI sync ──────────────────────────────────────────────────────────

export function hasActiveTrackerFilters() {
  return !!String(trackerViewState.query || '').trim() || trackerViewState.activeOnly;
}

export function syncTrackerFilterUi() {
  const toggle = $('tracker-scope-toggle');
  if (!toggle) return;

  toggle.textContent = trackerViewState.activeOnly ? 'Active' : 'All';
  toggle.classList.toggle('is-active', trackerViewState.activeOnly);
  toggle.setAttribute('aria-pressed', String(trackerViewState.activeOnly));
  toggle.title = trackerViewState.activeOnly
    ? 'Showing only active pipeline items.'
    : 'Showing every tracked application.';
}

export function syncTrackerSortUi() {
  const select = $('tracker-sort-select');
  if (!select) return;
  select.value = trackerViewState.sortMode || 'smart';
}

// ── Lane count ──────────────────────────────────────────────────────────────

export function getTrackerLaneCount(applications, lane) {
  if (Array.isArray(lane.groups)) {
    return lane.groups.reduce((sum, group) => {
      return sum + applications.filter((app) => group.statuses.includes(normalizeApplicationStatus(app.status))).length;
    }, 0);
  }
  return applications.filter((app) => lane.statuses.includes(normalizeApplicationStatus(app.status))).length;
}

// ── Render tracker board ────────────────────────────────────────────────────

const expandedFinalStages = {
  rejected: false,
  retired: false,
};
const finalDockExpanded = {
  rejected: false,
  retired: false,
};

// On first open this session, the first few items of each active section are
// expanded into cards by default. After that we respect whatever the user has
// since collapsed/expanded.
let bubbleDefaultsSeeded = false;
const DEFAULT_EXPANDED_PER_SECTION = 3;
const PRIMARY_SECTION_STATUS_GROUPS = [
  ['drafted', 'filled'],
  ['pending'],
  ['submitted'],
  ['interview'],
  ['offer'],
];

function seedDefaultExpandedBubbles(apps = []) {
  for (const statuses of PRIMARY_SECTION_STATUS_GROUPS) {
    apps
      .filter((app) => statuses.includes(normalizeApplicationStatus(app.status)))
      .slice(0, DEFAULT_EXPANDED_PER_SECTION)
      .forEach((app) => {
        const id = String(app.id || '');
        if (id) selectedFinalStageBubbleIds.add(id);
      });
  }
}

export function toggleFinalStageGroup(status) {
  const normalized = normalizeApplicationStatus(status);
  if (!Object.prototype.hasOwnProperty.call(expandedFinalStages, normalized)) return;
  expandedFinalStages[normalized] = !expandedFinalStages[normalized];
}

export function selectFinalStageBubble(id) {
  const value = String(id || '').trim();
  if (!value) return;
  selectedFinalStageBubbleIds.add(value);
}

export function toggleFinalStageBubbleSelection(id) {
  const value = String(id || '').trim();
  if (!value) return;
  if (selectedFinalStageBubbleIds.has(value)) {
    selectedFinalStageBubbleIds.delete(value);
    return;
  }
  selectedFinalStageBubbleIds.add(value);
}

export function clearFinalStageBubbleSelections() {
  selectedFinalStageBubbleIds.clear();
}

export function setBubblesExpanded(ids = [], expanded = true) {
  ids.forEach((id) => {
    const value = String(id || '').trim();
    if (!value) return;
    if (expanded) selectedFinalStageBubbleIds.add(value);
    else selectedFinalStageBubbleIds.delete(value);
  });
}

export function areAllBubblesExpanded(ids = []) {
  const list = ids.map((id) => String(id || '').trim()).filter(Boolean);
  return list.length > 0 && list.every((id) => selectedFinalStageBubbleIds.has(id));
}

export function toggleFinalDockLane(status) {
  const normalized = normalizeApplicationStatus(status);
  if (!Object.prototype.hasOwnProperty.call(finalDockExpanded, normalized)) return;
  finalDockExpanded[normalized] = !finalDockExpanded[normalized];
}

// Primary lane (Drafts / Submitted / Later stages) collapse state. Unlike the
// final-stage dock above, these default to expanded and only start collapsed
// when a lane is empty at first render — see seedPrimaryLaneDefaults().
const primaryLaneExpanded = {};
let primaryLaneSeeded = false;

function seedPrimaryLaneDefaults(applications, lanes) {
  lanes.forEach((lane) => {
    primaryLaneExpanded[lane.key] = getTrackerLaneCount(applications, lane) > 0;
  });
}

export function togglePrimaryLaneCollapse(key) {
  if (!(key in primaryLaneExpanded)) return;
  primaryLaneExpanded[key] = !primaryLaneExpanded[key];
}

function isPrimaryLaneExpanded(key) {
  return primaryLaneExpanded[key] !== false;
}

export async function renderTracker() {
  const previousInline = $('tracker-status-inline');
  const previousInlineText = previousInline?.textContent || '';
  const previousInlineClass = previousInline?.className || 'tracker-status-inline';

  const resp = await sendMessage({ type: 'GET_STATE' });
  const apps = sortTrackerApplications(resp?.applications || []);

  const { filterApplicationsForQuery } = await import('../../lib/tracker.js');
  const filteredApps = filterApplicationsForQuery(apps, trackerViewState.query, { activeOnly: trackerViewState.activeOnly });

  if (!bubbleDefaultsSeeded) {
    seedDefaultExpandedBubbles(filteredApps);
    bubbleDefaultsSeeded = true;
  }

  const tbody = $('tracker-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  applyTrackerSummary(apps);

  if ($('tracker-search-input') && $('tracker-search-input').value !== trackerViewState.query) {
    $('tracker-search-input').value = trackerViewState.query;
  }
  syncTrackerFilterUi();
  syncTrackerSortUi();

  if (filteredApps.length === 0) {
    const emptyEl = $('tracker-empty');
    if (emptyEl) {
      emptyEl.textContent = hasActiveTrackerFilters()
        ? 'No tracked applications match the current filters.'
        : 'No applications tracked yet.';
      emptyEl.classList.remove('hidden');
    }
    return;
  }
  $('tracker-empty')?.classList.add('hidden');

  const lanes = [
    {
      key: 'early',
      label: '🟡 Drafts',
      groups: [
        { key: 'drafted', label: '🟡 Drafted', statuses: ['drafted', 'filled'] },
        { key: 'pending', label: '⏳ Pending', statuses: ['pending'] },
      ],
    },
    { key: 'submitted', label: '✅ Submitted', statuses: ['submitted'] },
    {
      key: 'later',
      label: '📅 Later stages',
      groups: [
        { key: 'interview', label: '📅 Interview', statuses: ['interview'] },
        { key: 'offer', label: '🎉 Offer', statuses: ['offer'] },
      ],
    },
    { key: 'rejected', label: '❌ Rejected', statuses: ['rejected'], finalStage: true },
    { key: 'retired', label: '⬜ Retired', statuses: ['retired'], finalStage: true },
  ];

  const primaryLanes = lanes.filter((lane) => !lane.finalStage);
  const finalLanes = lanes.filter((lane) => lane.finalStage);

  if (!primaryLaneSeeded) {
    seedPrimaryLaneDefaults(filteredApps, primaryLanes);
    primaryLaneSeeded = true;
  }

  tbody.innerHTML = `
    <div class="tracker-list-main">${primaryLanes.map((lane) => renderTrackerLane(filteredApps, lane)).join('')}</div>
    <div id="tracker-status-inline" class="tracker-status-inline tracker-status-inline-docked" role="status" aria-live="polite"></div>
    <div class="tracker-list-final-dock">${finalLanes.map((lane) => renderTrackerLane(filteredApps, lane)).join('')}</div>
  `;

  const inline = $('tracker-status-inline');
  if (inline) {
    inline.textContent = previousInlineText;
    const hasState = /\bsuccess\b|\berror\b/.test(previousInlineClass);
    inline.className = `tracker-status-inline tracker-status-inline-docked${hasState && /\bsuccess\b/.test(previousInlineClass) ? ' success' : ''}${hasState && /\berror\b/.test(previousInlineClass) ? ' error' : ''}`;
  }
}

function applyTrackerSummary(apps = []) {
  const total = apps.length;
  const active = apps.filter((a) => !['rejected', 'retired'].includes(normalizeApplicationStatus(a.status))).length;

  if ($('stat-total')) $('stat-total').textContent = total;
  if ($('stat-applied')) $('stat-applied').textContent = apps.filter(a => normalizeApplicationStatus(a.status) === 'submitted').length;
  if ($('stat-pending')) $('stat-pending').textContent = active;
  if ($('header-tracker-count')) {
    $('header-tracker-count').textContent = `${active} / ${total} active`;
  }
  if ($('header-tracker-btn')) {
    $('header-tracker-btn').title = `${active} of ${total} tracked applications still active. Open tracker workspace.`;
  }
}

// ── Render lane ─────────────────────────────────────────────────────────────

export function renderTrackerLane(applications, lane) {
  if (Array.isArray(lane.groups)) {
    const laneOpen = isPrimaryLaneExpanded(lane.key);
    const sections = lane.groups.map((group) => {
      const laneApps = applications.filter((app) => group.statuses.includes(normalizeApplicationStatus(app.status)));
      const statusTone = group.statuses[0] || group.key;
      const bubbles = renderSectionBubbles(laneApps, statusTone);
      // The column-level collapse toggle hides expanded card previews (not
      // the bubble row itself, so drag/drop targets stay visible either way).
      const expanded = laneOpen ? renderSectionExpandedCards(laneApps) : '';
      return `
        <div class="tracker-lane-group" data-status-target="${escAttr(group.statuses[0])}">
          <div class="tracker-lane-subheader">
            <span class="tracker-lane-subtitle">${group.label}</span>
            <div class="tracker-lane-inline-bubbles">${bubbles}</div>
            ${renderSectionToggle(laneApps)}
            <span class="tracker-lane-count">${laneApps.length}</span>
          </div>
          <div class="tracker-lane-cards" data-status-target="${escAttr(group.statuses[0])}">${expanded}</div>
        </div>
      `;
    }).join('');

    const total = getTrackerLaneCount(applications, lane);

    return `
      <section class="tracker-lane tracker-lane-stacked${laneOpen ? '' : ' is-collapsed'}">
        <div class="tracker-lane-header">
          <span class="tracker-lane-title">${lane.label}</span>
          <div class="tracker-lane-header-actions">
            <span class="tracker-lane-count">${total}</span>
            <button class="btn btn-ghost btn-xs tracker-lane-collapse-toggle" data-lane-collapse-toggle="${escAttr(lane.key)}" type="button">${laneOpen ? 'Collapse' : 'Expand'}</button>
          </div>
        </div>
        ${sections}
      </section>
    `;
  }

  const laneApps = applications.filter((app) => lane.statuses.includes(normalizeApplicationStatus(app.status)));
  const isFinalStageLane = lane.finalStage === true;
  if (isFinalStageLane) {
    const laneStatus = lane.statuses[0] || lane.key;
    const isExpandedDock = !!finalDockExpanded[laneStatus];
    const bubbles = laneApps.length
      ? laneApps.map((app) => renderFinalStageBubble(app)).join('') + renderFinalStageClearBubble()
      : '<p class="empty-msg tracker-lane-empty">Nothing here yet.</p>';

    const expandedCards = laneApps.filter((app) => selectedFinalStageBubbleIds.has(String(app.id || '')));
    const expandedMarkup = expandedCards.length
      ? `<div class="tracker-final-expanded">${expandedCards.map((app) => renderTrackerCard(app)).join('')}</div>`
      : '';

    const hint = laneApps.length && isExpandedDock
      ? `<p class="tracker-final-hint">${expandedCards.length ? 'Select more bubbles to stack preview cards, or use Clear to reset.' : 'Click a bubble to open a read-only card preview.'}</p>`
      : '';

    return `
      <section class="tracker-lane tracker-lane-final tracker-lane-final-dock${isExpandedDock ? '' : ' is-collapsed'}" data-status-target="${escAttr(lane.statuses[0])}">
        <div class="tracker-lane-header">
          <span class="tracker-lane-title">${lane.label}</span>
          <div class="tracker-lane-header-actions">
            <span class="tracker-lane-count">${laneApps.length}</span>
            <button class="btn btn-ghost btn-xs tracker-final-dock-toggle" data-final-dock-toggle="${escAttr(laneStatus)}" type="button">${isExpandedDock ? 'Collapse' : 'Expand'}</button>
          </div>
        </div>
        <div class="tracker-final-bubble-list">${bubbles}</div>
        ${hint}
        ${isExpandedDock ? expandedMarkup : ''}
      </section>
    `;
  }
  const laneOpen = isPrimaryLaneExpanded(lane.key);
  const statusTone = lane.statuses[0] || lane.key;
  const bubbles = renderSectionBubbles(laneApps, statusTone);
  const expanded = laneOpen ? renderSectionExpandedCards(laneApps) : '';

  return `
    <section class="tracker-lane${isFinalStageLane ? ` tracker-lane-final tracker-lane-final-${escAttr(statusTone)}` : ''}${laneOpen ? '' : ' is-collapsed'}" data-status-target="${escAttr(lane.statuses[0])}">
      <div class="tracker-lane-header">
        <span class="tracker-lane-title">${lane.label}</span>
        <div class="tracker-lane-inline-bubbles">${bubbles}</div>
        ${renderSectionToggle(laneApps)}
        <span class="tracker-lane-count">${laneApps.length}</span>
        <button class="btn btn-ghost btn-xs tracker-lane-collapse-toggle" data-lane-collapse-toggle="${escAttr(lane.key)}" type="button">${laneOpen ? 'Collapse' : 'Expand'}</button>
      </div>
      <div class="tracker-lane-cards" data-status-target="${escAttr(lane.statuses[0])}">${expanded}</div>
    </section>
  `;
}

// Contracted, draggable bubbles for a section (shown inline with the subtitle).
function renderSectionBubbles(apps = [], statusTone = '') {
  if (!apps.length) return '';
  return apps.map((app) => renderOverflowBubble(app, statusTone)).join('');
}

// +/× toggle that expands or collapses every card in a section at once.
function renderSectionToggle(apps = []) {
  if (!apps.length) return '';
  const allOpen = areAllBubblesExpanded(apps.map((app) => app.id));
  return `<button class="tracker-section-toggle" type="button" title="${allOpen ? 'Collapse all in this section' : 'Expand all in this section'}" aria-label="${allOpen ? 'Collapse all' : 'Expand all'}">${allOpen ? '×' : '+'}</button>`;
}

// Expanded preview cards for whichever bubbles in this section are selected.
function renderSectionExpandedCards(apps = []) {
  const expandedCards = apps.filter((app) => selectedFinalStageBubbleIds.has(String(app.id || '')));
  if (!expandedCards.length) return '';
  return `<div class="tracker-overflow-expanded">${expandedCards.map((app) => renderTrackerCard(app)).join('')}</div>`;
}

function renderOverflowBubble(app, statusTone = '') {
  const initial = getCompanyInitial(app.company);
  const isExpanded = selectedFinalStageBubbleIds.has(String(app.id || ''));
  const normalizedStatus = normalizeApplicationStatus(app.status);
  const title = `${String(app.company || 'Unknown company')} — ${String(app.title || 'Untitled role')}`;
  return `<button class="tracker-overflow-bubble${isExpanded ? ' is-expanded' : ''}" draggable="true" data-id="${escAttr(app.id)}" data-status="${escAttr(normalizedStatus)}" data-expand-card-id="${escAttr(app.id)}" data-status-tone="${escAttr(statusTone)}" title="${escAttr(title)}" aria-label="Toggle preview for ${escAttr(title)}" aria-pressed="${isExpanded ? 'true' : 'false'}" type="button">${esc(initial)}</button>`;
}

// ── Render card ─────────────────────────────────────────────────────────────

export function renderTrackerCard(app) {
  const expanded = expandedTrackerIds.has(app.id);
  const summaryToggleClass = ' tracker-card-toggle';
  const summaryRole = ' role="button" tabindex="0"';
  const normalizedStatus = normalizeApplicationStatus(app.status);
  // Drafts/pending show only the Updated date; everything else shows Submitted.
  const showUpdatedOnly = ['drafted', 'filled', 'pending'].includes(normalizedStatus);
  const pay = resolvePayBand(app);
  const locationUi = getLocationUiState(app.location);
  const scoreUi = getScorecardUiState(app.scorecard);
  const companyLabel = app.url
    ? `<a class="tracker-summary-title-link" href="${escAttr(app.url)}" target="_blank" rel="noopener">${esc(app.company || 'Unknown company')}</a>`
    : esc(app.company || 'Unknown company');

  return `
    <div class="tracker-card${expanded ? ' expanded' : ''}" draggable="false" data-id="${escAttr(app.id)}" data-status="${escAttr(normalizedStatus)}" data-sort-order="${escAttr(String(app.sort_order ?? ''))}">
      <div class="tracker-card-grabber" draggable="true" data-id="${escAttr(app.id)}" data-status="${escAttr(normalizedStatus)}" title="Drag to move between lanes" aria-label="Drag to move this card">⠿</div>
      <div class="tracker-card-header">
        <div class="tracker-card-summary${summaryToggleClass}"${summaryRole} aria-expanded="${expanded ? 'true' : 'false'}">
          <div class="tracker-summary-copy">
            <div class="tracker-summary-title">${companyLabel}</div>
            <div class="tracker-summary-role">${esc(app.title || 'Untitled role')}</div>
            <div class="tracker-summary-details">${renderCardSummaryDetailsInner(app)}</div>
          </div>
        </div>
        <div class="tracker-card-tools tracker-card-tools-right">
          <select class="tracker-status-select" data-field="status" data-status-tone="${escAttr(normalizedStatus)}" aria-label="Update application status">
            ${renderStatusOptions(app.status)}
          </select>
          <div class="tracker-card-meta-row tracker-card-meta-submitted${showUpdatedOnly ? ' hidden' : ''}">
            <span class="tracker-card-date-label">Submitted:</span>
            <span class="tracker-card-date tracker-card-submitted">${esc(formatDate(app.date) || '—')}</span>
          </div>
          <div class="tracker-card-meta-row tracker-card-meta-updated${showUpdatedOnly ? '' : ' hidden'}">
            <span class="tracker-card-date-label">Updated:</span>
            <span class="tracker-card-date tracker-card-updated">${esc(formatSavedTimestamp(app.updated_at) || '—')}</span>
          </div>
        </div>
      </div>
      <div class="tracker-card-details">
        <div class="tracker-card-fields">
          <div class="tracker-card-groups-grid">
            <div class="tracker-context-box">
              <div class="tracker-context-headline">
                <label class="tracker-field-label">
                  <span>Company</span>
                  <input class="tracker-field-company" data-field="company" type="text" value="${escAttr(app.company || '')}" placeholder="Company name" />
                </label>
                <label class="tracker-field-label">
                  <span>Role</span>
                  <input class="tracker-field-title" data-field="title" type="text" value="${escAttr(app.title || '')}" placeholder="Role title" />
                </label>
              </div>
              <div class="location-editor tracker-field-location">
                <select data-field="location_select" class="tracker-location-select" aria-label="Location">
                  ${renderLocationOptions(locationUi.selectValue)}
                </select>
                <input data-field="location_other" type="text" class="tracker-location-other${locationUi.selectValue === 'other' ? '' : ' hidden'}" value="${escAttr(locationUi.otherText)}" placeholder="Custom location" />
              </div>
              <div class="inline-fields compact-fields tracker-field-employment">
                <select data-field="employment_type">
                  ${renderEmploymentTypeOptions(app.employment_type)}
                </select>
                <label class="checkbox-row" style="margin-top:0">
                  <input data-field="remote" type="checkbox" ${app.remote ? 'checked' : ''} />
                  Remote
                </label>
              </div>
            </div>

            <div class="pay-editor tracker-score-pay">
              <div class="pay-editor-row">
                <div class="pay-editor-top">
                  <label class="pay-label">Pay min</label>
                  <input data-field="pay_min" type="number" min="0" step="1000" inputmode="numeric" value="${escAttr(String(pay.min || ''))}" placeholder="0" />
                </div>
                <input type="range" class="pay-slider" data-pay-range="min" min="0" max="500000" step="5000" value="${escAttr(String(Math.min(500000, pay.min || 0)))}" aria-label="Pay min slider" />
              </div>
              <div class="pay-editor-row">
                <div class="pay-editor-top">
                  <label class="pay-label">Pay max</label>
                  <input data-field="pay_max" type="number" min="0" step="1000" inputmode="numeric" value="${escAttr(String(pay.max || ''))}" placeholder="0" />
                </div>
                <input type="range" class="pay-slider" data-pay-range="max" min="0" max="500000" step="5000" value="${escAttr(String(Math.min(500000, pay.max || Math.max(pay.min || 0, 0))))}" aria-label="Pay max slider" />
              </div>
              <p class="pay-warning hidden" role="alert"></p>
            </div>

            <div class="tracker-score-verdict">
              <label class="tracker-field-label">
                <span>Sentiment</span>
                <select data-field="verdict" aria-label="Interest verdict">
                  ${renderVerdictOptions(app.verdict)}
                </select>
              </label>
              <label class="tracker-field-label">
                <span>Scorecard</span>
                <div class="tracker-scorecard-editor">
                  <select data-field="scorecard_select" aria-label="Scorecard stars">
                    ${renderScorecardOptions(scoreUi.selectValue)}
                  </select>
                  <input data-field="scorecard_other" type="text" class="tracker-scorecard-other${scoreUi.selectValue === 'other' ? '' : ' hidden'}" value="${escAttr(scoreUi.otherText)}" placeholder="Custom score text" />
                </div>
              </label>
              <label class="tracker-field-label">
                <span>Job URL</span>
                <input class="tracker-field-url" data-field="url" type="url" value="${escAttr(app.url || '')}" placeholder="Job URL" />
              </label>
            </div>

            <div class="tracker-date-box">
              <label class="tracker-date-editor-label">
                <span>Submitted date</span>
                <input class="tracker-card-date-input" data-field="date" type="date" value="${escAttr(app.date ? formatDateInput(app.date) : '')}" aria-label="Edit submission date" />
              </label>
              <label class="tracker-date-editor-label">
                <span>Last updated</span>
                <input type="text" value="${escAttr(formatSavedTimestamp(app.updated_at) || '—')}" readonly />
              </label>
            </div>
          </div>

          <div class="jd-ai-toolbar">
            <button class="btn btn-ghost btn-xs jd-ai-btn tracker-jd-ai-btn" type="button" data-mode="summary" title="Summarize this description into key points">✨ Summarize</button>
            <button class="btn btn-ghost btn-xs jd-ai-btn tracker-jd-ai-btn" type="button" data-mode="cleanup" title="Strip boilerplate / noise from this description">🧹 Clean up</button>
            <span class="jd-ai-status helper-text tracker-jd-ai-status"></span>
          </div>
          <textarea class="tracker-field-description" data-field="description" rows="4" placeholder="Stored job description / notes">${esc(app.description || app.jd_snippet || '')}</textarea>
        </div>
        <div class="tracker-card-actions">
          <span class="tracker-save-state">Auto-save on blur</span>
          <div class="tracker-card-action-buttons">
            <button class="btn btn-ghost btn-sm tracker-interview-prep-btn" data-id="${escAttr(app.id)}" title="Open interview prep for this application">🎯 Interview Prep</button>
            <button class="btn btn-ghost btn-sm tracker-delete-btn" data-id="${escAttr(app.id)}">Delete</button>
            <button class="btn btn-secondary btn-sm tracker-save-btn" data-id="${escAttr(app.id)}">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Card summary sync ───────────────────────────────────────────────────────

export function syncTrackerCardSummary(card, patch = {}) {
  if (!card) return;

  const company = patch.company || 'Unknown company';
  const title = patch.title || 'Untitled role';
  const summaryMeta = [
    patch.location || 'Unknown',
    patch.employment_type || 'Full-time',
    patch.remote ? 'Remote' : 'On-site',
  ].filter(Boolean).join(' · ');
  const summaryNote = getVerdictLabel(patch.verdict) || patch.scorecard || (patch.description ? 'Description cached' : 'Click to edit');

  const statusSelect = card.querySelector('.tracker-card-header .tracker-status-select');
  if (statusSelect) {
    statusSelect.value = normalizeApplicationStatus(patch.status);
    statusSelect.dataset.statusTone = normalizeApplicationStatus(patch.status);
  }

  const titleEl = card.querySelector('.tracker-summary-title');
  if (titleEl) {
    if (String(patch.url || '').trim()) {
      titleEl.innerHTML = `<a class="tracker-summary-title-link" href="${escAttr(String(patch.url || '').trim())}" target="_blank" rel="noopener">${esc(company)}</a>`;
    } else {
      titleEl.textContent = company;
    }
  }
  const roleEl = card.querySelector('.tracker-summary-role');
  if (roleEl) roleEl.textContent = title;

  const detailsEl = card.querySelector('.tracker-summary-details');
  if (detailsEl) detailsEl.innerHTML = renderCardSummaryDetailsInner(patch);

  const submittedEl = card.querySelector('.tracker-card-submitted');
  if (submittedEl) submittedEl.textContent = formatDate(patch.date) || '—';

  const updatedEl = card.querySelector('.tracker-card-updated');
  if (updatedEl) updatedEl.textContent = formatSavedTimestamp(patch.updated_at) || '—';

  const showUpdatedOnly = ['drafted', 'filled', 'pending'].includes(normalizeApplicationStatus(patch.status));
  card.querySelector('.tracker-card-meta-submitted')?.classList.toggle('hidden', showUpdatedOnly);
  card.querySelector('.tracker-card-meta-updated')?.classList.toggle('hidden', !showUpdatedOnly);
}

function getVerdictLabel(value = '') {
  const normalized = String(value || '').trim();
  const match = VERDICT_OPTIONS.find((option) => option.value === normalized);
  return match ? match.label : normalized;
}

// ── Emoji indicators (compact card meta) ────────────────────────────────────

// More discernible than smileys: fire / thumbs / dash / thumbs-down / x / glass.
const VERDICT_EMOJI = {
  strong_yes: '🔥',
  lean_yes: '👍',
  neutral: '➖',
  lean_no: '👎',
  no: '❌',
  research: '🔍',
};
const VERDICT_CYCLE = ['strong_yes', 'lean_yes', 'neutral', 'lean_no', 'no', 'research'];

function getVerdictEmoji(value = '') {
  return VERDICT_EMOJI[String(value || '').trim()] || '➖';
}

// Resolve a 0–5 integer star count from whatever scorecard text is stored.
function getStarCount(scorecard) {
  const ui = getScorecardUiState(scorecard);
  if (ui.selectValue && ui.selectValue !== 'other') {
    const n = Number(ui.selectValue);
    return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
  }
  const display = getScoreDisplay(scorecard);
  if (!display) return 0;
  return (String(display.stars).match(/★/g) || []).length;
}

// Inline SVG US flag — Windows doesn't render the 🇺🇸 emoji (shows "US"), so we
// draw a small recognizable flag (red field, white stripes, blue canton).
const US_FLAG_SVG = '<svg class="flag-svg" viewBox="0 0 19 10" width="15" height="10" aria-hidden="true"><rect width="19" height="10" fill="#b22234"/><rect y="1.43" width="19" height="0.77" fill="#fff"/><rect y="2.97" width="19" height="0.77" fill="#fff"/><rect y="4.5" width="19" height="0.77" fill="#fff"/><rect y="6.04" width="19" height="0.77" fill="#fff"/><rect y="7.57" width="19" height="0.77" fill="#fff"/><rect width="8" height="5.38" fill="#3c3b6e"/></svg>';

function getLocationIndicator(location = '') {
  const loc = String(location || '').trim();
  if (!loc || loc === 'Unknown') return { icon: '📍', label: 'Location not set' };
  if (loc === 'United States' || USA_STATES.includes(loc)) return { icon: US_FLAG_SVG, label: loc };
  if (/remote|anywhere|worldwide/i.test(loc)) return { icon: '🌐', label: loc };
  return { icon: '📍', label: loc };
}

function getEmploymentIndicator(type = '') {
  const t = String(type || '').toLowerCase();
  if (t.includes('intern')) return { emoji: '🎓', label: 'Internship' };
  if (t.includes('contract')) return { emoji: '✖️', label: 'Contract' };
  if (t.includes('part')) return { emoji: '⚪', label: 'Part-time' };
  if (t.includes('temp')) return { emoji: '⏳', label: 'Temporary' };
  return { emoji: '🟢', label: 'Full-time' };
}

function getRemoteIndicator(remote) {
  return remote ? { emoji: '🏠', label: 'Remote / WFH' } : { emoji: '🏢', label: 'On-site' };
}

/**
 * Compact emoji-first summary details (location/type/remote indicators + a pay
 * row carrying salary, the sentiment emoji, and score stars). Reused by both
 * the initial card render and the live summary sync so they never drift.
 */
function renderCardSummaryDetailsInner(app = {}) {
  const pay = resolvePayBand(app);
  const salaryText = formatPayDisplay(pay.min, pay.max, app.salary_range);
  const scoreDisplay = getScoreDisplay(app.scorecard);
  const loc = getLocationIndicator(app.location);
  const emp = getEmploymentIndicator(app.employment_type);
  const rem = getRemoteIndicator(app.remote);
  const verdictLabel = getVerdictLabel(app.verdict) || 'Neutral / maybe';
  const verdictEmoji = getVerdictEmoji(app.verdict || 'neutral');
  const verdictValue = String(app.verdict || 'neutral').trim() || 'neutral';

  // Clickable stars (reverse DOM order enables a pure-CSS hover-fill).
  const starCount = getStarCount(app.scorecard);
  const scoreTitle = scoreDisplay ? `Score: ${scoreDisplay.raw} (click to set)` : 'Not scored (click to set)';
  const starButtons = [5, 4, 3, 2, 1]
    .map((n) => `<span class="tracker-star${n <= starCount ? ' is-filled' : ''}" data-star="${n}" title="Set score ${n}/5">★</span>`)
    .join('');
  const stars = `<span class="tracker-score-stars tracker-score-interactive${scoreDisplay && scoreDisplay.isZero ? ' is-zero' : ''}" title="${escAttr(scoreTitle)}" aria-label="${escAttr(scoreTitle)}">${starButtons}</span>`;

  // All indicators on one inline row: pay · location · type · remote · sentiment · stars.
  return `
    <div class="tracker-summary-detailrow">
      <span class="tracker-summary-salary${salaryText ? '' : ' hidden'}">${esc(salaryText || '')}</span>
      <span class="meta-emoji meta-flag" title="${escAttr(loc.label)}" aria-label="${escAttr('Location: ' + loc.label)}">${loc.icon}</span>
      <span class="meta-emoji" title="${escAttr(emp.label)}" aria-label="${escAttr('Type: ' + emp.label)}">${emp.emoji}</span>
      <span class="meta-emoji" title="${escAttr(rem.label)}" aria-label="${escAttr(rem.label)}">${rem.emoji}</span>
      <span class="tracker-summary-sentiment tracker-sentiment-interactive" data-sentiment-cycle="1" data-verdict="${escAttr(verdictValue)}" title="${escAttr('Sentiment: ' + verdictLabel + ' (click to change)')}" aria-label="${escAttr('Sentiment: ' + verdictLabel)}">${verdictEmoji}</span>
      ${stars}
    </div>
  `;
}

function getScoreDisplay(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const zeroText = /\bzero\b|\b0\s*stars?\b/i.test(raw);
  if (zeroText) {
    return { stars: '☆☆☆☆☆', raw: 'ZERO stars', isZero: true };
  }

  const ratioMatch = raw.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  let score = 0;
  let max = 0;

  if (ratioMatch) {
    score = Number(ratioMatch[1]);
    max = Number(ratioMatch[2]);
  } else {
    const numMatch = raw.match(/\d+(?:\.\d+)?/);
    if (!numMatch) return null;
    score = Number(numMatch[0]);
    max = score <= 5 ? 5 : 10;
  }

  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) {
    return null;
  }

  const normalized = Math.max(0, Math.min(5, Math.round((score / max) * 5)));
  const stars = '★'.repeat(normalized) + '☆'.repeat(Math.max(0, 5 - normalized));
  return {
    stars,
    raw: normalized === 0 ? 'ZERO stars' : raw,
    isZero: normalized === 0,
  };
}

function renderFinalStageBubble(app) {
  const initial = getCompanyInitial(app.company);
  const isExpanded = selectedFinalStageBubbleIds.has(String(app.id || ''));
  const normalizedStatus = normalizeApplicationStatus(app.status);
  const title = `${String(app.company || 'Unknown company')} — ${String(app.title || 'Untitled role')}`;
  return `<button class="tracker-final-bubble${isExpanded ? ' is-expanded' : ''}" draggable="true" data-id="${escAttr(app.id)}" data-status="${escAttr(normalizedStatus)}" data-expand-card-id="${escAttr(app.id)}" title="${escAttr(title)}" aria-pressed="${isExpanded ? 'true' : 'false'}" type="button">${esc(initial)}</button>`;
}

function renderFinalStageClearBubble() {
  const hasSelections = selectedFinalStageBubbleIds.size > 0;
  return `<button class="tracker-final-bubble tracker-final-bubble-clear${hasSelections ? ' is-active' : ''}" data-clear-final-bubbles="true" title="Clear all expanded bubble previews" aria-label="Clear all bubble selections" type="button">×</button>`;
}

function getCompanyInitial(company = '') {
  const text = String(company || '').trim();
  if (!text) return '?';
  const first = text.match(/[A-Za-z0-9]/);
  return first ? first[0].toUpperCase() : '?';
}

function getScorecardUiState(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return { selectValue: '', otherText: '' };

  if (/\bzero\b|\b0\s*stars?\b/i.test(raw)) {
    return { selectValue: '0', otherText: '' };
  }

  const ratioMatch = raw.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (ratioMatch) {
    const score = Number(ratioMatch[1]);
    const max = Number(ratioMatch[2]);
    if (Number.isFinite(score) && Number.isFinite(max) && max > 0) {
      const stars = Math.max(0, Math.min(5, Math.round((score / max) * 5)));
      return { selectValue: String(stars), otherText: '' };
    }
  }

  const numericOnly = raw.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  if (numericOnly) {
    const score = Number(numericOnly[1]);
    if (Number.isFinite(score)) {
      const stars = Math.max(0, Math.min(5, Math.round(score)));
      return { selectValue: String(stars), otherText: '' };
    }
  }

  return { selectValue: 'other', otherText: raw };
}

function renderScorecardOptions(current = '') {
  const normalized = String(current || '');
  const options = [
    { value: '', label: 'Not scored' },
    { value: '5', label: '★★★★★ 5 stars' },
    { value: '4', label: '★★★★☆ 4 stars' },
    { value: '3', label: '★★★☆☆ 3 stars' },
    { value: '2', label: '★★☆☆☆ 2 stars' },
    { value: '1', label: '★☆☆☆☆ 1 star' },
    { value: '0', label: '☆☆☆☆☆ ZERO stars (red flag)' },
    { value: 'other', label: 'Other (custom text)' },
  ];
  return options.map((option) => {
    const selected = option.value === normalized ? ' selected' : '';
    return `<option value="${escAttr(option.value)}"${selected}>${esc(option.label)}</option>`;
  }).join('');
}

function renderVerdictOptions(current = '') {
  const normalized = String(current || '').trim();
  const hasKnown = VERDICT_OPTIONS.some((option) => option.value === normalized);
  return VERDICT_OPTIONS.map((option) => {
    const selected = option.value === (hasKnown ? normalized : 'neutral') ? ' selected' : '';
    return `<option value="${escAttr(option.value)}"${selected}>${esc(option.label)}</option>`;
  }).join('');
}

function resolvePayBand(app = {}) {
  const min = parsePayValue(app.pay_min);
  const max = parsePayValue(app.pay_max);
  if (min || max) {
    return {
      min: min || 0,
      max: max || Math.max(min || 0, 0),
    };
  }

  const parsed = parsePayBandFromText(app.salary_range);
  return {
    min: parsed.min || 0,
    max: parsed.max || 0,
  };
}

function parsePayValue(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : 0;
}

function parsePayBandFromText(text = '') {
  const numbers = String(text || '').match(/\d[\d,]*/g) || [];
  if (!numbers.length) return { min: 0, max: 0 };
  const parsed = numbers.map((value) => Number(String(value).replace(/,/g, ''))).filter((n) => Number.isFinite(n));
  if (!parsed.length) return { min: 0, max: 0 };
  if (parsed.length === 1) return { min: parsed[0], max: parsed[0] };
  return { min: Math.min(parsed[0], parsed[1]), max: Math.max(parsed[0], parsed[1]) };
}

function formatPayDisplay(min, max, fallback = '') {
  const safeMin = parsePayValue(min);
  const safeMax = parsePayValue(max);
  if (safeMin && safeMax) return `$${safeMin.toLocaleString()} - $${safeMax.toLocaleString()}`;
  if (safeMin) return `$${safeMin.toLocaleString()}`;
  if (safeMax) return `$${safeMax.toLocaleString()}`;
  const fallbackText = String(fallback || '').trim();
  return fallbackText;
}

function getLocationUiState(location = '') {
  const normalized = String(location || '').trim();
  if (!normalized) {
    return { selectValue: 'United States', otherText: '' };
  }

  if (normalized === 'United States' || USA_STATES.includes(normalized) || NA_COUNTRIES.includes(normalized)) {
    return { selectValue: normalized, otherText: '' };
  }

  return {
    selectValue: 'other',
    otherText: normalized,
  };
}

function renderLocationOptions(selectedValue = '') {
  const current = String(selectedValue || 'United States');
  const renderOption = (value, label = value) => {
    const selected = value === current ? ' selected' : '';
    return `<option value="${escAttr(value)}"${selected}>${esc(label)}</option>`;
  };

  const usOptions = USA_STATES.map((state) => renderOption(state)).join('');
  const naOptions = NA_COUNTRIES.map((country) => renderOption(country)).join('');

  return `
    ${renderOption('United States')}
    <optgroup label="USA states">${usOptions}</optgroup>
    <optgroup label="North America">${naOptions}</optgroup>
    ${renderOption('other', 'Other (custom)')}
  `;
}
