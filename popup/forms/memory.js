// memory.js
// Handles learned defaults, memory, and related UI logic

import { $, esc, escAttr, sendMessage, isSensitiveMemoryQuestion } from '../../lib/utils.js';
import { setStatus } from '../ux/state.js';

const expandedMemoryQuestions = new Set();

/**
 * Fetch and render learned defaults (memory) UI.
 * Splits items into regular vs sensitive lists and renders both.
 */
export async function renderLearnedDefaults() {
  const resp = await sendMessage({ type: 'GET_LEARNED_DEFAULTS' });
  const allMemory = Array.isArray(resp?.items) ? resp.items : (resp?.memory || []);
  const allIgnored = Array.isArray(resp?.ignoredItems) ? resp.ignoredItems : (resp?.ignored || []);
  const pendingItems = Array.isArray(resp?.pendingItems) ? resp.pendingItems : [];

  const pendingContainer = $('pending-memory-list');
  if (pendingContainer) renderPendingMemoryGroup(pendingContainer, pendingItems);
  const pendingBadge = $('pending-memory-count');
  if (pendingBadge) pendingBadge.textContent = `${pendingItems.length} to review`;

  // Split regular vs sensitive
  const regularMemory = allMemory.filter(item => !isSensitiveMemoryQuestion(item.question));
  const sensitiveMemory = allMemory.filter(item => isSensitiveMemoryQuestion(item.question));

  // Main memory list — matches HTML id="learned-defaults-list"
  const container = $('learned-defaults-list');
  if (container) renderMemoryGroup(container, regularMemory, 'No memory saved yet.');

  // Ignored memory list — matches HTML id="ignored-memory-list"
  const ignoredContainer = $('ignored-memory-list');
  if (ignoredContainer) renderIgnoredMemoryGroup(ignoredContainer, allIgnored, 'No ignored memory right now.');

  // Sensitive memory list — matches HTML id="sensitive-memory-list"
  const sensitiveContainer = $('sensitive-memory-list');
  if (sensitiveContainer) renderMemoryGroup(sensitiveContainer, sensitiveMemory, 'No sensitive memory saved.');

  // Update badge counts
  const countBadge = $('memory-count-badge');
  if (countBadge) countBadge.textContent = `${allMemory.length} saved`;
  const ignoredCountBadge = $('ignored-memory-count');
  if (ignoredCountBadge) ignoredCountBadge.textContent = `${allIgnored.length} ignored`;
  const sensitiveCountBadge = $('sensitive-memory-count');
  if (sensitiveCountBadge) sensitiveCountBadge.textContent = `${sensitiveMemory.length} guarded`;
}

/**
 * Answers captured from pages wait here until the user approves or discards them.
 */
export function renderPendingMemoryGroup(container, items) {
  if (!items.length) {
    container.innerHTML = '<p class="empty-msg">Nothing waiting for review.</p>';
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="memory-item pending-memory-item" data-question="${escAttr(item.question)}">
      <div class="memory-card-copy">
        <div class="memory-item-label">Suggested</div>
        <div class="memory-item-question">${esc(item.question)}</div>
        <textarea class="memory-answer-input" rows="2">${esc(item.answer || '')}</textarea>
      </div>
      <div class="memory-item-actions">
        <button type="button" class="btn btn-ghost btn-xs memory-approve-btn" data-question="${escAttr(item.question)}">Approve</button>
        <button type="button" class="btn btn-ghost btn-xs memory-discard-btn" data-question="${escAttr(item.question)}">Discard</button>
      </div>
    </div>`).join('');
}

/**
 * Compact "bubble" (chip) shown for a contracted memory item. Clicking expands
 * it into the full editable card via the shared expand handler.
 */
function renderMemoryChip(item, { label = 'Prompt', isActive = false } = {}) {
  const question = String(item.question || '').trim();
  const display = question.length > 24 ? `${question.slice(0, 22)}…` : (question || label);
  const tooltip = question + (item.answer ? ` → ${item.answer}` : '');
  return `<button type="button" class="memory-bubble memory-expand-btn${isActive ? ' is-active' : ''}" data-question="${escAttr(question)}" aria-expanded="${isActive}" title="${escAttr(tooltip)}">${esc(display)}</button>`;
}

/**
 * Render a group of memory items as contracted bubbles; expanded items become
 * full edit cards inline.
 */
export function renderMemoryGroup(container, items, emptyMessage) {
  if (!items.length) {
    container.innerHTML = `<p class="empty-msg">${esc(emptyMessage)}</p>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const isActive = expandedMemoryQuestions.has(item.question);
    if (!isActive) {
      return renderMemoryChip(item);
    }
    return `
    <div class="memory-item expanded" data-question="${escAttr(item.question)}">
      <button type="button" class="memory-card-summary memory-expand-btn" aria-expanded="true">
        <div class="memory-card-copy">
          <div class="memory-item-label">Prompt</div>
          <div class="memory-item-question">${esc(item.question)}</div>
          <div class="memory-item-preview">${esc(String(item.answer || '').slice(0, 120) || 'No answer')}</div>
        </div>
        <span class="memory-expand-indicator">▾</span>
      </button>
      <div class="memory-card-details">
        <textarea class="memory-answer-input" rows="4">${esc(item.answer || '')}</textarea>
        <div class="memory-item-actions">
          <button class="btn btn-ghost btn-xs memory-save-btn" data-question="${escAttr(item.question)}">Save</button>
          <button class="btn btn-ghost btn-xs memory-ignore-btn" data-question="${escAttr(item.question)}">Ignore</button>
          <button class="btn btn-ghost btn-xs memory-delete-btn" data-question="${escAttr(item.question)}">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

/**
 * Render a group of ignored memory items as contracted bubbles; expanded items
 * become full restore/delete cards inline.
 */
export function renderIgnoredMemoryGroup(container, items, emptyMessage) {
  // Apply search filter from #ignore-search-input if present
  const searchInput = document.getElementById('ignore-search-input');
  const query = (searchInput?.value || '').toLowerCase().trim();
  const filtered = query
    ? items.filter(item => item.question.toLowerCase().includes(query) || String(item.answer || '').toLowerCase().includes(query))
    : items;

  if (!filtered.length) {
    container.innerHTML = `<p class="empty-msg">${esc(query ? 'No matches.' : emptyMessage)}</p>`;
    return;
  }

  container.innerHTML = filtered.map(item => {
    if (!expandedMemoryQuestions.has(item.question)) {
      return renderMemoryChip(item, { label: 'Ignored prompt' });
    }
    return `
    <div class="memory-item ignored-memory-item expanded" data-question="${escAttr(item.question)}">
      <button type="button" class="memory-card-summary memory-expand-btn" aria-expanded="true">
        <div class="memory-card-copy">
          <div class="memory-item-label">Ignored prompt</div>
          <div class="memory-item-question">${esc(item.question)}</div>
          <div class="memory-item-preview">${esc(String(item.answer || '').slice(0, 120) || 'No answer')}</div>
        </div>
        <span class="memory-expand-indicator">▾</span>
      </button>
      <div class="memory-card-details">
        <div class="memory-archived-answer">${esc(item.answer || 'No archived answer')}</div>
        <div class="memory-item-actions">
          <button class="btn btn-ghost btn-xs memory-restore-btn" data-question="${escAttr(item.question)}">Restore</button>
          <button class="btn btn-ghost btn-xs memory-delete-btn" data-question="${escAttr(item.question)}">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

/**
 * Initialize memory list event handlers (edit, ignore, delete, restore).
 */
export function initMemoryHandlers() {
  // Delegated handlers for regular + sensitive memory lists
  const handleMemoryClick = async (event) => {
    const expandBtn = event.target.closest('.memory-expand-btn');
    const saveBtn = event.target.closest('.memory-save-btn');
    const ignoreBtn = event.target.closest('.memory-ignore-btn');
    const deleteBtn = event.target.closest('.memory-delete-btn');
    const restoreBtn = event.target.closest('.memory-restore-btn');
    const approveBtn = event.target.closest('.memory-approve-btn');
    const discardBtn = event.target.closest('.memory-discard-btn');

    try {
      if (approveBtn) {
        const question = approveBtn.dataset.question || '';
        const answer = approveBtn.closest('.memory-item')?.querySelector('.memory-answer-input')?.value?.trim() || '';
        if (!question || !answer) return;
        await sendMessage({ type: 'APPROVE_PENDING_LEARNED_DEFAULT', payload: { question, answer } });
        await renderLearnedDefaults();
        setStatus('setup-status', '✅ Memory saved.', 'success');
        return;
      }

      if (discardBtn) {
        const question = discardBtn.dataset.question || '';
        if (!question) return;
        await sendMessage({ type: 'DISCARD_PENDING_LEARNED_DEFAULT', payload: { question } });
        await renderLearnedDefaults();
        return;
      }

      if (expandBtn) {
        // The button is either a contracted chip (data-question on itself) or
        // the summary of an expanded card (data-question on the parent item).
        const question = expandBtn.dataset.question || expandBtn.closest('.memory-item')?.dataset.question || '';
        if (question) {
          if (expandedMemoryQuestions.has(question)) {
            expandedMemoryQuestions.delete(question);
          } else {
            expandedMemoryQuestions.add(question);
          }
          // Re-render so the chip ⇄ card swap takes effect.
          await renderLearnedDefaults();
        }
        return;
      }

      if (saveBtn) {
        const question = saveBtn.dataset.question || '';
        const newAnswer = saveBtn.closest('.memory-item')?.querySelector('.memory-answer-input')?.value?.trim() || '';
        if (!question || !newAnswer) return;
        await editLearnedDefault(question, newAnswer);
        await renderLearnedDefaults();
        setStatus('setup-status', '✅ Memory updated.', 'success');
        return;
      }

      if (ignoreBtn) {
        const question = ignoreBtn.dataset.question || '';
        if (!question) return;
        await ignoreLearnedDefault(question);
        await renderLearnedDefaults();
        setStatus('setup-status', '✅ Moved memory to ignore list.', 'success');
        return;
      }

      if (deleteBtn) {
        const question = deleteBtn.dataset.question || '';
        const item = deleteBtn.closest('.memory-item');
        const isIgnored = item?.classList.contains('ignored-memory-item');
        if (!question) return;
        const confirmed = window.confirm(`Delete this memory entry?\n\n"${question.slice(0, 80)}"`);
        if (!confirmed) return;
        if (isIgnored) {
          await deleteIgnoredLearnedDefault(question);
        } else {
          await deleteLearnedDefault(question);
        }
        expandedMemoryQuestions.delete(question);
        await renderLearnedDefaults();
        setStatus('setup-status', '✅ Memory deleted.', 'success');
        return;
      }

      if (restoreBtn) {
        const question = restoreBtn.dataset.question || '';
        if (!question) return;
        await restoreIgnoredLearnedDefault(question);
        await renderLearnedDefaults();
        setStatus('setup-status', '✅ Memory restored.', 'success');
      }
    } catch (err) {
      setStatus('setup-status', '❌ ' + (err?.message || 'Could not update memory.'), 'error');
    }
  };

  // Bind to all memory list containers
  $('pending-memory-list')?.addEventListener('click', handleMemoryClick);
  $('learned-defaults-list')?.addEventListener('click', handleMemoryClick);
  $('ignored-memory-list')?.addEventListener('click', handleMemoryClick);
  $('sensitive-memory-list')?.addEventListener('click', handleMemoryClick);

  // Re-filter the ignore list on every keystroke.
  $('ignore-search-input')?.addEventListener('input', async () => {
    const resp = await sendMessage({ type: 'GET_LEARNED_DEFAULTS' });
    const allIgnored = Array.isArray(resp?.ignoredItems) ? resp.ignoredItems : [];
    const container = $('ignored-memory-list');
    if (container) renderIgnoredMemoryGroup(container, allIgnored, 'No ignored memory right now.');
  });
}

// CRUD functions for memory actions
export async function addLearnedDefault(question, answer) {
  return sendMessage({ type: 'UPDATE_LEARNED_DEFAULT', payload: { question, answer } });
}
export async function editLearnedDefault(id, answer) {
  return sendMessage({ type: 'UPDATE_LEARNED_DEFAULT', payload: { question: id, answer } });
}
export async function ignoreLearnedDefault(id) {
  return sendMessage({ type: 'IGNORE_LEARNED_DEFAULT', payload: { question: id } });
}
export async function deleteLearnedDefault(id) {
  return sendMessage({ type: 'DELETE_LEARNED_DEFAULT', payload: { question: id } });
}
export async function restoreIgnoredLearnedDefault(id) {
  return sendMessage({ type: 'DELETE_IGNORED_LEARNED_DEFAULT', payload: { question: id } });
}
export async function deleteIgnoredLearnedDefault(id) {
  return sendMessage({ type: 'DELETE_IGNORED_LEARNED_DEFAULT', payload: { question: id } });
}
