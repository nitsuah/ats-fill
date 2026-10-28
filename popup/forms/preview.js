// preview.js
// Handles preview screen logic and rendering

import { $, esc, escAttr, sendMessage, sendToActiveTab } from '../../lib/utils.js';
import { showScreen, bindReviewJumpHandlers } from '../ux/navigation.js';
import { setStatus } from '../ux/state.js';

let lastPreviewEntries = [];

export function initPreviewHandlers() {
  $('preview-back-btn')?.addEventListener('click', () => showScreen('main'));
  bindReviewJumpHandlers('preview-report-unresolved', 'fill-status');

  $('preview-filter-input')?.addEventListener('input', () => {
    renderPreviewList($('preview-filter-input')?.value || '');
  });

  $('inject-from-preview-btn')?.addEventListener('click', async () => {
    const resp = await sendMessage({ type: 'GET_LAST_ANSWERS' });
    if (!resp?.answers) return;
    try {
      await sendToActiveTab({ type: 'INJECT_ANSWERS', payload: resp.answers });
    } catch (err) {
      // tab may not have content script
    }
  });

  $('preview-content')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('.preview-ai-btn');
    if (!btn) return;
    const entryLabel = btn.dataset.entryLabel;
    const mode = btn.dataset.aiMode;
    const entry = lastPreviewEntries.find((e) => e.label === entryLabel);
    if (!entry?.value) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      const resp = await sendMessage({ type: 'SUMMARIZE_JD', payload: { text: entry.value, mode } });
      if (!resp?.success) throw new Error(resp?.error || 'AI unavailable');
      entry.value = resp.text;
      // re-render only the changed card's value paragraph
      const card = btn.closest('.preview-card');
      const valEl = card?.querySelector('.preview-card-value');
      if (valEl) valEl.textContent = resp.text;
    } catch (e) {
      console.warn('[apply-bot] preview AI:', e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}

/**
 * Render the answer preview screen from a set of answers and a fill report.
 */
export function renderPreview(answers, report) {
  const content = $('preview-content');
  if (!content) return;

  if (!answers || !Object.keys(answers).length) {
    lastPreviewEntries = [];
    content.innerHTML = '<p class="empty-msg">Generate answers first by clicking "Fill Form".</p>';
    if ($('preview-filter-input')) $('preview-filter-input').value = '';
    if ($('preview-answer-count')) $('preview-answer-count').textContent = '0 answers';
    renderPreviewReport(null);
    return;
  }

  lastPreviewEntries = Object.entries(answers).map(([label, value]) => ({
    label,
    value: String(value || '').trim(),
  }));

  if ($('preview-filter-input')) $('preview-filter-input').value = '';
  renderPreviewList('');

  renderPreviewReport(report);
}

function renderPreviewList(query = '') {
  const content = $('preview-content');
  if (!content) return;

  const normalizedQuery = String(query || '').toLowerCase().trim();
  const filtered = normalizedQuery
    ? lastPreviewEntries.filter((entry) => {
      return entry.label.toLowerCase().includes(normalizedQuery) || entry.value.toLowerCase().includes(normalizedQuery);
    })
    : lastPreviewEntries;

  if ($('preview-answer-count')) {
    const total = filtered.length;
    $('preview-answer-count').textContent = `${total} answer${total === 1 ? '' : 's'}`;
  }

  if (!filtered.length) {
    content.innerHTML = '<p class="empty-msg">No preview answers match the current filter.</p>';
    return;
  }

  const grouped = groupPreviewEntries(filtered);
  content.innerHTML = grouped.map((group) => {
    const cards = group.items.map((item) => {
      const aiButtons = (item.value || '').length > 120
        ? `<div class="preview-ai-btns">
        <button class="job-ai-btn preview-ai-btn" data-entry-label="${escAttr(item.label)}" data-ai-mode="summary" title="Summarize with AI">✨</button>
        <button class="job-ai-btn preview-ai-btn" data-entry-label="${escAttr(item.label)}" data-ai-mode="cleanup" title="Clean up with AI">🧹</button>
      </div>`
        : '';
      return `
      <article class="preview-card">
        <h4 class="preview-card-label">${esc(item.label)}</h4>
        <p class="preview-card-value">${esc(item.value || '—')}</p>
        ${aiButtons}
      </article>
    `;
    }).join('');

    return `
      <section class="preview-group">
        <div class="preview-group-header">
          <h3 class="preview-group-title">${esc(group.label)}</h3>
          <span class="badge badge-info">${group.items.length}</span>
        </div>
        <div class="preview-grid">${cards}</div>
      </section>
    `;
  }).join('');
}

function groupPreviewEntries(entries = []) {
  const groups = [
    { key: 'core', label: 'Core profile', items: [] },
    { key: 'preferences', label: 'Preferences', items: [] },
    { key: 'experience', label: 'Experience and narrative', items: [] },
    { key: 'sensitive', label: 'Sensitive and demographic', items: [] },
    { key: 'other', label: 'Other answers', items: [] },
  ];

  for (const entry of entries) {
    const key = String(entry.label || '').toLowerCase();
    let groupKey = 'other';

    if (/name|email|phone|location|address|city|state|zip|postal|linkedin|github|portfolio|website|current company|current job title|pronouns/.test(key)) {
      groupKey = 'core';
    } else if (/salary|pay|authorization|sponsorship|remote|start date|availability|employment type/.test(key)) {
      groupKey = 'preferences';
    } else if (/experience|why|fit|accommodation|additional information|summary|skills|degree|education/.test(key)) {
      groupKey = 'experience';
    } else if (/race|ethnic|gender|veteran|disability|hispanic|latino|asian|white|black|native|military|sexual orientation/.test(key)) {
      groupKey = 'sensitive';
    }

    const bucket = groups.find((group) => group.key === groupKey) || groups[groups.length - 1];
    bucket.items.push(entry);
  }

  return groups.filter((group) => group.items.length > 0);
}

function renderPreviewReport(report) {
  const card = $('preview-report-card');
  if (!card) return;

  if (!report || !Array.isArray(report.unresolved) || !report.unresolved.length) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  const summary = $('preview-report-summary');
  if (summary) {
    summary.textContent = `${report.unresolved.length} field${report.unresolved.length === 1 ? '' : 's'} may need manual review.`;
  }

  const list = $('preview-report-unresolved');
  if (list) {
    list.innerHTML = report.unresolved.map(item => {
      const label = typeof item === 'string' ? item : (item.label || item.question || item.field || 'Unknown field');
      const reason = typeof item === 'object' ? (item.reason || '') : '';
      const payload = encodeURIComponent(JSON.stringify(item));
      return `<li>
        <button class="btn btn-ghost btn-xs review-jump-btn" data-payload="${escAttr(payload)}" title="${escAttr(label)}">${esc(label)}</button>
        ${reason ? `<span class="review-reason">${esc(reason)}</span>` : ''}
      </li>`;
    }).join('');
  }
}

/**
 * Render the fill report card on the main screen.
 */
export function renderFillReport(report) {
  const card = $('fill-report-card');
  if (!card) return;

  if (!report || (!Array.isArray(report.unresolved) || !report.unresolved.length)) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  const summary = $('fill-report-summary');
  if (summary) {
    const parts = [
      report.filled ? `${report.filled} filled` : '',
      report.preserved ? `${report.preserved} kept` : '',
      report.unresolved.length ? `${report.unresolved.length} to review` : '',
    ].filter(Boolean).join(' • ');
    summary.textContent = parts || 'Review completed.';
  }

  const list = $('fill-report-unresolved');
  if (list) {
    list.innerHTML = report.unresolved.map(item => {
      const label = typeof item === 'string' ? item : (item.label || item.question || item.field || 'Unknown field');
      const reason = typeof item === 'object' ? (item.reason || '') : '';
      const payload = encodeURIComponent(JSON.stringify(item));
      return `<li>
        <button class="btn btn-ghost btn-xs review-jump-btn" data-payload="${escAttr(payload)}" title="${escAttr(label)}">${esc(label)}</button>
        ${reason ? `<span class="review-reason">${esc(reason)}</span>` : ''}
      </li>`;
    }).join('');

    bindReviewJumpHandlers('fill-report-unresolved', 'fill-status');
  }
}
