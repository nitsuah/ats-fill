// job-search.js
// Job search panel: pick sources (plug-and-play registry), filter by pay,
// render a results grid, and save a result straight into the tracker.

import { esc, escAttr, sendMessage } from '../../lib/utils.js';
import { isStandaloneView, openExpandedWorkspace } from '../ux/navigation.js';
import { jobPassesPayFilter } from '../../lib/job-search.js';

const lastResultsById = new Map();
const savedJobIds = new Set();
const selectedSourceIds = new Set();
let sourceSelectionSeeded = false;
let lastRawResults = [];
let lastSources = [];

// ── Pay filter state ─────────────────────────────────────────────────────────

const PAY_RANGES = {
  annual: { min: 0, max: 500, step: 5, unit: 'K' },   // values are thousands ($k)
  hourly: { min: 0, max: 200, step: 1, unit: '$/hr' }, // values are $/hr
};
const payFilter = { mode: 'annual', min: 0, max: 500, hideUnknown: false };
const extraFilters = { remote: 'any', type: 'any', location: 'any' };
let payDefaultsSeeded = false;
let prefsLoaded = false;

// ── Persisted preferences (sources + pay filter) ─────────────────────────────

function saveJobPrefs() {
  try {
    chrome.storage?.local?.set?.({
      jobSearchPrefs: {
        sources: [...selectedSourceIds],
        pay: { mode: payFilter.mode, min: payFilter.min, max: payFilter.max, hideUnknown: payFilter.hideUnknown },
        filters: { ...extraFilters },
      },
    });
  } catch {
    // Non-extension context — ignore.
  }
}

async function restoreJobPrefs() {
  try {
    const data = await chrome.storage?.local?.get?.('jobSearchPrefs');
    const prefs = data?.jobSearchPrefs;
    if (!prefs) return;
    if (Array.isArray(prefs.sources)) {
      selectedSourceIds.clear();
      prefs.sources.forEach((id) => selectedSourceIds.add(id));
      sourceSelectionSeeded = true;
    }
    if (prefs.pay && (prefs.pay.mode === 'annual' || prefs.pay.mode === 'hourly')) {
      payFilter.mode = prefs.pay.mode;
      const r = PAY_RANGES[payFilter.mode];
      payFilter.min = Math.min(r.max, Math.max(r.min, Number(prefs.pay.min) || r.min));
      payFilter.max = Math.min(r.max, Math.max(r.min, Number(prefs.pay.max) || r.max));
      payFilter.hideUnknown = !!prefs.pay.hideUnknown;
      payDefaultsSeeded = true;
    }
    if (prefs.filters && typeof prefs.filters === 'object') {
      for (const key of ['remote', 'type', 'location']) {
        if (typeof prefs.filters[key] === 'string') extraFilters[key] = prefs.filters[key];
      }
    }
  } catch {
    // ignore
  }
}

function payIsActive() {
  const r = PAY_RANGES[payFilter.mode];
  return payFilter.min > r.min || payFilter.max < r.max;
}

function fmtPayValue(v, mode) {
  return mode === 'hourly' ? `$${v}` : `$${v}k`;
}

function payReadoutText() {
  if (!payIsActive()) return 'Any pay';
  const r = PAY_RANGES[payFilter.mode];
  const lo = fmtPayValue(payFilter.min, payFilter.mode);
  const hi = payFilter.max >= r.max ? `${fmtPayValue(r.max, payFilter.mode)}+` : fmtPayValue(payFilter.max, payFilter.mode);
  const suffix = payFilter.mode === 'hourly' ? '/hr' : '';
  return `${lo} – ${hi}${suffix}`;
}

function syncPayUi() {
  const r = PAY_RANGES[payFilter.mode];
  const minNum = document.getElementById('pay-min-num');
  const maxNum = document.getElementById('pay-max-num');
  const minSlider = document.getElementById('pay-slider-min');
  const maxSlider = document.getElementById('pay-slider-max');
  [minNum, maxNum, minSlider, maxSlider].forEach((el) => {
    if (!el) return;
    el.min = String(r.min);
    el.max = String(r.max);
    el.step = String(r.step);
  });
  if (minNum) minNum.value = String(payFilter.min);
  if (maxNum) maxNum.value = String(payFilter.max);
  if (minSlider) minSlider.value = String(payFilter.min);
  if (maxSlider) maxSlider.value = String(payFilter.max);
  const unit = document.getElementById('pay-unit-min');
  if (unit) unit.textContent = r.unit;
  const readoutText = payReadoutText();
  const readout = document.getElementById('pay-filter-readout');
  if (readout) readout.textContent = readoutText;
  // The visible range text is hidden; surface it as a tooltip instead.
  const controls = document.getElementById('pay-controls');
  if (controls) controls.title = readoutText;
  document.querySelectorAll('.job-pay-mode').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === payFilter.mode);
  });
  // Reflect saved extra-filter selections.
  const setSel = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setSel('filter-remote', extraFilters.remote);
  setSel('filter-type', extraFilters.type);
  setSel('filter-location', extraFilters.location);
  const hideUnknownEl = document.getElementById('pay-hide-unknown');
  if (hideUnknownEl) hideUnknownEl.checked = !!payFilter.hideUnknown;
}

// Classify a job's location string into a coarse region bucket.
function classifyLocation(location = '') {
  const s = String(location || '').toLowerCase();
  if (!s || s === 'unknown') return 'other';
  if (/\bremote\b|anywhere|worldwide|flexible|global/.test(s)) return 'remote';
  if (/\b(usa|u\.s\.a|united states|u\.s\.)\b|\b(us)\b|, us$|america/.test(s)) return 'usa';
  if (/\b(uk|united kingdom|england|ireland|germany|france|spain|portugal|netherlands|poland|italy|sweden|norway|denmark|finland|switzerland|austria|belgium|czech|romania|greece|europe|eu)\b/.test(s)) return 'europe';
  return 'other';
}

function jobPassesExtraFilters(job) {
  if (extraFilters.remote === 'remote' && !job.remote) return false;
  if (extraFilters.remote === 'onsite' && job.remote) return false;
  if (extraFilters.type !== 'any') {
    const t = String(job.employment_type || '').toLowerCase();
    if (!t.includes(extraFilters.type)) return false;
  }
  if (extraFilters.location !== 'any' && classifyLocation(job.location) !== extraFilters.location) return false;
  return true;
}

function setPayFromInputs(rawMin, rawMax) {
  const r = PAY_RANGES[payFilter.mode];
  const clamp = (v) => Math.min(r.max, Math.max(r.min, Math.round((Number(v) || 0) / r.step) * r.step));
  let lo = clamp(rawMin);
  let hi = clamp(rawMax);
  if (lo > hi) [lo, hi] = [hi, lo];
  payFilter.min = lo;
  payFilter.max = hi;
}

async function seedPayDefaultsFromMemory() {
  if (payDefaultsSeeded) return;
  payDefaultsSeeded = true;
  try {
    const state = await sendMessage({ type: 'GET_STATE' });
    const min = Number(state?.settings?.preferred_salary_min);
    const max = Number(state?.settings?.preferred_salary_max);
    if (Number.isFinite(min) && min > 0) payFilter.min = Math.min(500, Math.round(min / 1000));
    if (Number.isFinite(max) && max > 0) payFilter.max = Math.min(500, Math.round(max / 1000));
  } catch {
    // No settings — keep the full default range.
  }
}

// ── Source filter chips ──────────────────────────────────────────────────────

export async function loadJobSources() {
  if (!prefsLoaded) {
    await restoreJobPrefs();
    prefsLoaded = true;
  }
  let sources = [];
  try {
    const resp = await sendMessage({ type: 'GET_JOB_SOURCES' });
    sources = resp?.sources || [];
  } catch {
    sources = [];
  }
  if (!sourceSelectionSeeded) {
    sources.filter((s) => s.available).forEach((s) => selectedSourceIds.add(s.id));
    sourceSelectionSeeded = true;
  }
  const availableIds = new Set(sources.filter((s) => s.available).map((s) => s.id));
  [...selectedSourceIds].forEach((id) => { if (!availableIds.has(id)) selectedSourceIds.delete(id); });

  renderSourceChips(sources);
  await seedPayDefaultsFromMemory();
  syncPayUi();
  return sources;
}

function renderSourceChips(sources, countMap = {}) {
  const container = document.getElementById('job-source-filters');
  if (!container) return;
  if (!sources.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = sources.map((s) => {
    const selected = s.available && selectedSourceIds.has(s.id);
    const classes = ['job-source-chip'];
    if (selected) classes.push('is-active');
    if (!s.available) classes.push('is-unavailable');
    const count = countMap[s.id];
    const countLabel = (count != null) ? ` (${count})` : '';
    const title = s.available
      ? `Toggle ${s.label}`
      : s.session
        ? `Uses your active LinkedIn session — ${s.requires || 'open LinkedIn in a browser tab'}`
        : `${s.label} — click to configure ${s.requires || 'credentials'}`;
    const lockIcon = s.available ? '' : (s.session ? ' ⚡' : ' 🔒');
    return `<button type="button" class="${classes.join(' ')}" data-source-id="${escAttr(s.id)}" data-available="${s.available ? '1' : '0'}" data-session="${s.session ? '1' : '0'}" aria-pressed="${selected ? 'true' : 'false'}" title="${escAttr(title)}">${esc(s.label)}${lockIcon}${esc(countLabel)}</button>`;
  }).join('');
}

function heatmapClass(count) {
  if (typeof count !== 'number' || count === 0) return 'chip-count-zero';
  if (count <= 5) return 'chip-count-low';
  if (count <= 10) return 'chip-count-mid';
  return 'chip-count-high';
}

function updateSourceChipCounts(sourceResults = []) {
  const countMap = {};
  sourceResults.forEach((s) => { countMap[s.id] = s.ok ? (s.count || 0) : null; });
  const container = document.getElementById('job-source-filters');
  if (!container) return;

  const chips = [...container.querySelectorAll('.job-source-chip[data-source-id]')];
  chips.forEach((chip) => {
    const id = chip.dataset.sourceId;
    if (!(id in countMap)) return;
    const count = countMap[id];
    // Strip any existing count suffix, update label
    const base = chip.textContent.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*[🔒⚡]\s*$/, '').trim();
    const locked = chip.dataset.available === '0';
    const lockIcon = locked ? (chip.dataset.session === '1' ? ' ⚡' : ' 🔒') : '';
    chip.textContent = count !== null
      ? `${base}${lockIcon} (${count})`
      : `${base}${lockIcon} (!)`;
    chip.dataset.count = count !== null ? count : -1;
    // Apply heatmap
    chip.classList.remove('chip-count-zero', 'chip-count-low', 'chip-count-mid', 'chip-count-high');
    chip.classList.add(heatmapClass(count !== null ? count : 0));
  });

  // Re-sort chips by count descending (highest results first)
  chips.sort((a, b) => Number(b.dataset.count || 0) - Number(a.dataset.count || 0));
  chips.forEach((chip) => container.appendChild(chip));
}

// ── Results ──────────────────────────────────────────────────────────────────

/** Shared markup for the distinctive empty/no-results state. */
function emptyStateHtml(icon, title, hint) {
  return `
    <div class="empty-msg job-search-empty-state">
      <span class="job-search-empty-icon" aria-hidden="true">${esc(icon)}</span>
      <p class="job-search-empty-title">${esc(title)}</p>
      <p class="job-search-empty-hint">${esc(hint)}</p>
    </div>
  `;
}

function applyAndRender() {
  const payCfg = { enabled: payIsActive() || payFilter.hideUnknown, mode: payFilter.mode, min: payFilter.min, max: payFilter.max, hideUnknown: payFilter.hideUnknown };
  const filtered = lastRawResults.filter((j) => jobPassesPayFilter(j, payCfg) && jobPassesExtraFilters(j));
  renderJobSearchResults(filtered, lastSources);
}

export function renderJobSearchResults(results, sources = []) {
  const resultsDiv = document.getElementById('job-search-results');
  if (!resultsDiv) return;

  lastResultsById.clear();
  (results || []).forEach((job) => { if (job?.id) lastResultsById.set(job.id, job); });

  if (!results || results.length === 0) {
    resultsDiv.innerHTML = payIsActive() && lastRawResults.length
      ? emptyStateHtml('🎚️', 'No jobs match the current pay filter', 'Widen the pay range in Filters, or turn off "Hide jobs without posted salary".')
      : emptyStateHtml('🔍', 'No jobs found for this search', 'Try a broader query, add more sources in Filters, or check Settings for boards that need a free API key.');
    return;
  }

  resultsDiv.innerHTML = results.map((j) => {
    const badges = [
      j.remote ? '<span class="job-badge job-badge-remote">Remote</span>' : '',
      j.employment_type ? `<span class="job-badge">${esc(j.employment_type)}</span>` : '',
      j.salary ? `<span class="job-badge job-badge-salary">${esc(j.salary)}</span>` : '',
      `<span class="job-badge job-badge-source">${esc(j.source || 'Web')}</span>`,
    ].filter(Boolean).join('');
    const openLabel = j.atsLabel ? `Open ${esc(j.title || 'job')} (apply on ${esc(j.atsLabel)})` : `Open ${esc(j.title || 'job')} at ${esc(j.company || '')}`;
    const descBlock = j.description ? `
      <div class="job-desc-row">
        <p class="job-desc">${esc(j.description.slice(0, 180))}${j.description.length > 180 ? '…' : ''}</p>
        <div class="job-ai-btns" role="group" aria-label="AI description tools">
          <button type="button" class="job-ai-btn" data-job-id="${escAttr(j.id)}" data-ai-mode="summary" title="Summarize description with AI (requires Gemini key)">✨</button>
          <button type="button" class="job-ai-btn" data-job-id="${escAttr(j.id)}" data-ai-mode="cleanup" title="Clean up description with AI (requires Gemini key)">🧹</button>
        </div>
      </div>` : '';
    const saved = savedJobIds.has(j.id);
    return `
    <div class="job-search-result" data-job-id="${escAttr(j.id)}" data-job-url="${escAttr(j.url)}" role="link" tabindex="0" aria-label="${escAttr(openLabel)}">
      <button type="button" class="job-saved-link${saved ? '' : ' hidden'}" data-job-id="${escAttr(j.id)}" title="Saved — open in Pipeline" aria-label="Saved — open in Pipeline">✓ Saved</button>
      <div class="job-result-headline">
        <div class="job-title">${esc(j.title || 'Untitled role')}</div>
        <div class="job-meta">${esc(j.company || 'Unknown company')} • ${esc(j.location || 'Location n/a')}</div>
      </div>
      <div class="job-badges">${badges}</div>
      ${descBlock}
      <button type="button" class="job-save-btn${saved ? ' hidden' : ''}" data-job-id="${escAttr(j.id)}">💾 Save job</button>
    </div>`;
  }).join('');
}


async function saveJobToTracker(jobId, button) {
  const job = lastResultsById.get(jobId);
  if (!job) return;
  const card = button.closest('.job-search-result');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const resp = await sendMessage({
      type: 'LOG_APPLICATION',
      payload: {
        company: job.company, title: job.title, url: job.url, status: 'drafted',
        location: job.location, employment_type: job.employment_type, remote: !!job.remote,
        salary_range: job.salary || '', description: job.description || '', source: job.source || '',
        jd_snippet: (job.description || '').slice(0, 300), answers_generated: false, fill_report: null,
      },
    });
    if (!resp?.success) throw new Error(resp?.error || 'Could not save job.');
    savedJobIds.add(jobId);
    button.classList.add('hidden');
    card?.querySelector('.job-saved-link')?.classList.remove('hidden');
  } catch (err) {
    button.disabled = false;
    button.textContent = '💾 Save job';
    console.warn('[apply-bot] Failed to save job to tracker.', err);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initJobSearchHandlers(showScreen) {
  const openPanel = async () => {
    if (!isStandaloneView()) {
      const opened = await openExpandedWorkspace('job-search');
      if (opened) return;
    }
    showScreen('job-search');
    await loadJobSources();
  };
  document.getElementById('job-search-btn')?.addEventListener('click', openPanel);
  document.getElementById('header-job-search-btn')?.addEventListener('click', openPanel);
  document.getElementById('open-job-search-btn')?.addEventListener('click', openPanel);

  const jobSearchInput = document.getElementById('job-search-input');
  const jobSearchSubmitBtn = document.getElementById('job-search-submit-btn');
  const resultsDiv = document.getElementById('job-search-results');

  if (jobSearchSubmitBtn && jobSearchInput) {
    jobSearchSubmitBtn.onclick = async () => {
      const query = jobSearchInput.value.trim();
      if (!selectedSourceIds.size) {
        if (resultsDiv) resultsDiv.innerHTML = '<p class="empty-msg">Select at least one source in Filters.</p>';
        return;
      }
      jobSearchSubmitBtn.disabled = true;
      jobSearchSubmitBtn.textContent = 'Searching…';
      if (resultsDiv) resultsDiv.innerHTML = '<p class="empty-msg">Searching across job boards…</p>';
      try {
        const resp = await sendMessage({ type: 'SEARCH_JOBS', payload: { query, sources: [...selectedSourceIds] } });
        if (!resp?.success) throw new Error(resp?.error || 'Search failed.');
        lastRawResults = resp.jobs || [];
        lastSources = resp.sources || [];
        updateSourceChipCounts(lastSources);
        applyAndRender();
      } catch (err) {
        lastRawResults = [];
        if (resultsDiv) resultsDiv.innerHTML = `<p class="empty-msg">❌ ${esc(err?.message || 'Job search failed.')}</p>`;
      } finally {
        jobSearchSubmitBtn.disabled = false;
        jobSearchSubmitBtn.textContent = 'Search';
      }
    };
    jobSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') jobSearchSubmitBtn.click(); });
  }

  // Filters expander (mirrors the tracker's "Add manually" sub-bar pattern).
  document.getElementById('job-filters-toggle')?.addEventListener('click', (event) => {
    const subbar = document.getElementById('job-search-subbar');
    if (!subbar) return;
    const open = subbar.classList.toggle('hidden');
    event.currentTarget.setAttribute('aria-expanded', String(!open));
    event.currentTarget.classList.toggle('is-active', !open);
  });

  // Source chips: toggle available ones; route locked ones to AI settings.
  document.getElementById('job-source-filters')?.addEventListener('click', async (event) => {
    const chip = event.target.closest('.job-source-chip');
    if (!chip) return;
    if (chip.dataset.available === '0') {
      await openExpandedWorkspace('ai', 'ai-settings-section');
      return;
    }
    const id = chip.dataset.sourceId;
    if (!id) return;
    if (selectedSourceIds.has(id)) selectedSourceIds.delete(id); else selectedSourceIds.add(id);
    chip.classList.toggle('is-active', selectedSourceIds.has(id));
    chip.setAttribute('aria-pressed', String(selectedSourceIds.has(id)));
    saveJobPrefs();
  });

  // Pay mode toggle.
  document.querySelectorAll('.job-pay-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (payFilter.mode === btn.dataset.mode) return;
      payFilter.mode = btn.dataset.mode === 'hourly' ? 'hourly' : 'annual';
      const r = PAY_RANGES[payFilter.mode];
      payFilter.min = r.min;
      payFilter.max = r.max;
      syncPayUi();
      applyAndRender();
      saveJobPrefs();
    });
  });

  // Pay sliders + number boxes both drive the filter and stay in sync.
  const onPayChange = (source) => {
    if (source === 'slider') {
      setPayFromInputs(document.getElementById('pay-slider-min')?.value, document.getElementById('pay-slider-max')?.value);
    } else {
      setPayFromInputs(document.getElementById('pay-min-num')?.value, document.getElementById('pay-max-num')?.value);
    }
    syncPayUi();
    applyAndRender();
    saveJobPrefs();
  };
  document.getElementById('pay-min-num')?.addEventListener('change', () => onPayChange('num'));
  document.getElementById('pay-max-num')?.addEventListener('change', () => onPayChange('num'));
  document.getElementById('pay-slider-min')?.addEventListener('input', () => onPayChange('slider'));
  document.getElementById('pay-slider-max')?.addEventListener('input', () => onPayChange('slider'));

  // Remote / type / location filter selects.
  const onExtraFilterChange = (key) => (event) => {
    extraFilters[key] = event.target.value;
    applyAndRender();
    saveJobPrefs();
  };
  document.getElementById('filter-remote')?.addEventListener('change', onExtraFilterChange('remote'));
  document.getElementById('filter-type')?.addEventListener('change', onExtraFilterChange('type'));
  document.getElementById('filter-location')?.addEventListener('change', onExtraFilterChange('location'));

  // Hide unknown salary toggle.
  document.getElementById('pay-hide-unknown')?.addEventListener('change', (event) => {
    payFilter.hideUnknown = event.target.checked;
    applyAndRender();
    saveJobPrefs();
  });

  // Card interactions: AI tools / save / open-in-tracker / open-post.
  if (resultsDiv) {
    const handleResultActivate = async (event) => {
      // AI summarize / clean-up button
      const aiBtn = event.target.closest('.job-ai-btn');
      if (aiBtn) {
        event.stopPropagation();
        const jobId = aiBtn.dataset.jobId || '';
        const mode = aiBtn.dataset.aiMode || 'summary';
        const job = lastResultsById.get(jobId);
        if (!job?.description) return;
        const origLabel = aiBtn.textContent;
        aiBtn.disabled = true;
        aiBtn.textContent = '⏳';
        try {
          const resp = await sendMessage({ type: 'SUMMARIZE_JD', payload: { text: job.description, mode } });
          if (!resp?.success) throw new Error(resp?.error || 'AI unavailable');
          job.description = resp.text;
          const card = aiBtn.closest('.job-search-result');
          const descEl = card?.querySelector('.job-desc');
          if (descEl) descEl.textContent = resp.text;
        } catch (err) {
          console.warn('[apply-bot] AI job desc action failed:', err.message);
        } finally {
          aiBtn.disabled = false;
          aiBtn.textContent = origLabel;
        }
        return;
      }

      const saveBtn = event.target.closest('.job-save-btn');
      if (saveBtn) {
        const jobId = saveBtn.dataset.jobId || '';
        if (jobId) saveJobToTracker(jobId, saveBtn);
        return;
      }
      const savedLink = event.target.closest('.job-saved-link');
      if (savedLink) {
        openExpandedWorkspace('tracker');
        return;
      }
      const card = event.target.closest('.job-search-result');
      const url = card?.dataset.jobUrl;
      if (url) window.open(url, '_blank', 'noopener');
    };
    resultsDiv.addEventListener('click', handleResultActivate);
    resultsDiv.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (event.target.closest('.job-search-result') && !event.target.closest('button')) {
        event.preventDefault();
        void handleResultActivate(event);
      }
    });
  }


  if (isStandaloneView() && new URLSearchParams(window.location.search).get('screen') === 'job-search') {
    loadJobSources();
  }
}
