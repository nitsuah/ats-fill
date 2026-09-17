// tracker-handlers.js
// Tracker event handler functions — save, delete, drag-drop, add form, import

import { $, sendMessage, sendToActiveTab, renderStatusOptions } from '../../lib/utils.js';
import { normalizeApplicationStatus } from '../../lib/tracker.js';
import { trackerDragState, trackerViewState, trackerSaveTimers, expandedTrackerIds } from './tracker-state.js';
import { renderTracker, syncTrackerCardSummary, getTrackerLaneCount, toggleFinalStageGroup, toggleFinalStageBubbleSelection, clearFinalStageBubbleSelections, toggleFinalDockLane, togglePrimaryLaneCollapse, setBubblesExpanded, areAllBubblesExpanded } from './tracker-ui.js';
import { getTrackingStatusMeta } from './tracker-meta.js';
import { exportCsv, importTrackerCsvFile } from './tracker-csv.js';
import { showScreen } from '../ux/navigation.js';
import { setStatus } from '../ux/state.js';
import { fillTrackerDraftForm, readTrackerDraftForm, resetTrackerDraftForm } from '../forms/forms.js';
import { openInterviewPrepForApplication } from '../ux/interview-prep.js';

// ── Status helpers ──────────────────────────────────────────────────────────

function setTrackerScreenStatus(msg, type = '') {
  const el = $('tracker-status');
  const inline = $('tracker-status-inline');

  if (el) {
    el.textContent = msg;
    el.className = 'status-msg' + (type ? ' ' + type : '');
  }

  if (inline) {
    inline.textContent = msg || '';
    const docked = inline.classList.contains('tracker-status-inline-docked') ? ' tracker-status-inline-docked' : '';
    inline.className = 'tracker-status-inline' + docked + (type ? ' ' + type : '');
  }
}

function setTrackerAddStatus(msg, type = '') {
  const el = $('tracker-add-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

// ── AI summarize / clean-up for long descriptions ───────────────────────────

/**
 * Run an AI summarize/clean-up pass over description text via the service
 * worker. Returns the transformed text, or null on empty input / failure
 * (status is reflected in statusEl).
 */
async function runJdTransform(text, mode, statusEl) {
  const value = String(text || '').trim();
  if (!value) {
    if (statusEl) statusEl.textContent = 'Paste a description first.';
    return null;
  }
  if (statusEl) statusEl.textContent = mode === 'cleanup' ? '🧹 Cleaning up…' : '✨ Summarizing…';
  try {
    const resp = await sendMessage({ type: 'SUMMARIZE_JD', payload: { text: value, mode } });
    if (!resp?.success) throw new Error(resp?.error || 'AI request failed.');
    if (statusEl) statusEl.textContent = '✅ Done — review and Save.';
    return resp.text;
  } catch (err) {
    if (statusEl) statusEl.textContent = '❌ ' + (err?.message || 'AI request failed.');
    return null;
  }
}

// ── Lazy reference to loadMainScreen (avoids circular imports) ──────────────

let _loadMainScreen = null;
export function setLoadMainScreen(fn) {
  _loadMainScreen = fn;
}
async function loadMainScreen(opts) {
  if (_loadMainScreen) await _loadMainScreen(opts);
}

// ── Init all tracker event handlers ─────────────────────────────────────────

export function initTrackerHandlers() {
  $('view-tracker-btn')?.addEventListener('click', async () => {
    await renderTracker();
    showScreen('tracker');
  });

  $('tracker-home-btn')?.addEventListener('click', async () => {
    await loadMainScreen();
  });

  $('add-application-btn')?.addEventListener('click', () => toggleTrackerAddForm());
  $('cancel-add-application-btn')?.addEventListener('click', () => toggleTrackerAddForm(false));
  $('import-current-job-btn')?.addEventListener('click', importCurrentPageIntoTrackerForm);

  // Quick-add AI summarize / clean-up
  const wireQuickAddAi = (btnId) => {
    $(btnId)?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      const mode = btn.dataset.mode || 'summary';
      const textarea = $('new-application-description');
      if (!textarea) return;
      btn.disabled = true;
      const result = await runJdTransform(textarea.value, mode, $('quickadd-ai-status'));
      btn.disabled = false;
      if (result) textarea.value = result;
    });
  };
  wireQuickAddAi('quickadd-summarize-btn');
  wireQuickAddAi('quickadd-cleanup-btn');
  $('save-new-application-btn')?.addEventListener('click', saveNewApplicationFromForm);
  $('import-csv-btn')?.addEventListener('click', () => $('import-csv-input')?.click());
  $('import-csv-input')?.addEventListener('change', (e) => importTrackerCsvFile(e));

  // Populate status options on the add form
  if ($('new-application-status')) {
    $('new-application-status').innerHTML = renderStatusOptions($('new-application-status').value || 'drafted', { verbose: true });
  }

  // Search and filter
  $('tracker-search-input')?.addEventListener('input', async (event) => {
    trackerViewState.query = event.target.value || '';
    await renderTracker();
    showScreen('tracker');
  });
  $('tracker-scope-toggle')?.addEventListener('click', async () => {
    trackerViewState.activeOnly = !trackerViewState.activeOnly;
    await renderTracker();
    showScreen('tracker');
  });
  $('tracker-sort-select')?.addEventListener('change', async (event) => {
    trackerViewState.sortMode = event.target.value || 'smart';
    await renderTracker();
    showScreen('tracker');
  });
  $('tracker-clear-filters-btn')?.addEventListener('click', async () => {
    trackerViewState.query = '';
    // Clearing returns to the default Active view, not an unfiltered "All".
    trackerViewState.activeOnly = true;
    trackerViewState.sortMode = 'smart';
    if ($('tracker-search-input')) $('tracker-search-input').value = '';
    await renderTracker();
    showScreen('tracker');
  });

  // Export CSV
  $('export-csv-btn')?.addEventListener('click', async () => {
    const resp = await sendMessage({ type: 'GET_STATE' });
    exportCsv(resp?.applications || []);
    setTrackerScreenStatus('✅ Exported the current tracker as CSV.', 'success');
  });

  // Drag & drop
  $('tracker-body')?.addEventListener('dragstart', handleTrackerDragStart);
  $('tracker-body')?.addEventListener('dragover', handleTrackerDragOver);
  $('tracker-body')?.addEventListener('drop', handleTrackerDrop);
  $('tracker-body')?.addEventListener('dragend', handleTrackerDragEnd);

  // Delegated click handlers on tracker body
  $('tracker-body')?.addEventListener('click', async (event) => {
    // Interactive score stars on the collapsed card — set the score without
    // expanding the card.
    const starEl = event.target.closest('.tracker-star[data-star]');
    if (starEl) {
      const card = starEl.closest('.tracker-card');
      const id = card?.dataset.id;
      if (id) {
        const value = Number(starEl.dataset.star) || 0;
        const resp = await sendMessage({ type: 'UPDATE_APPLICATION', payload: { id, patch: { scorecard: value ? `${value}/5` : '' } } });
        if (resp?.success && resp.entry) syncTrackerCardSummary(card, resp.entry);
      }
      return;
    }

    // Click the sentiment emoji to cycle the verdict — also without expanding.
    const sentEl = event.target.closest('[data-sentiment-cycle]');
    if (sentEl) {
      const card = sentEl.closest('.tracker-card');
      const id = card?.dataset.id;
      if (id) {
        const order = ['strong_yes', 'lean_yes', 'neutral', 'lean_no', 'no', 'research'];
        const cur = sentEl.dataset.verdict || 'neutral';
        const next = order[(order.indexOf(cur) + 1 + order.length) % order.length];
        const resp = await sendMessage({ type: 'UPDATE_APPLICATION', payload: { id, patch: { verdict: next } } });
        if (resp?.success && resp.entry) syncTrackerCardSummary(card, resp.entry);
      }
      return;
    }

    // AI summarize / clean-up on a card's description (sets the textarea without
    // auto-saving, so the original is preserved until the user clicks Save).
    const jdAiBtn = event.target.closest('.tracker-jd-ai-btn');
    if (jdAiBtn) {
      const card = jdAiBtn.closest('.tracker-card');
      const textarea = card?.querySelector('.tracker-field-description');
      if (!textarea) return;
      const mode = jdAiBtn.dataset.mode || 'summary';
      jdAiBtn.disabled = true;
      const result = await runJdTransform(textarea.value, mode, card.querySelector('.tracker-jd-ai-status'));
      jdAiBtn.disabled = false;
      if (result) textarea.value = result;
      return;
    }

    const laneToggleBtn = event.target.closest('.tracker-lane-toggle');
    if (laneToggleBtn) {
      const status = laneToggleBtn.dataset.finalStatus || '';
      toggleFinalStageGroup(status);
      await renderTracker();
      showScreen('tracker');
      return;
    }

    const finalDockToggleBtn = event.target.closest('.tracker-final-dock-toggle');
    if (finalDockToggleBtn) {
      const status = finalDockToggleBtn.dataset.finalDockToggle || '';
      toggleFinalDockLane(status);
      await renderTracker();
      showScreen('tracker');
      return;
    }

    const laneCollapseToggleBtn = event.target.closest('.tracker-lane-collapse-toggle');
    if (laneCollapseToggleBtn) {
      const key = laneCollapseToggleBtn.dataset.laneCollapseToggle || '';
      togglePrimaryLaneCollapse(key);
      await renderTracker();
      showScreen('tracker');
      return;
    }

    // Expand/collapse every card in one section at once.
    const sectionToggle = event.target.closest('.tracker-section-toggle');
    if (sectionToggle) {
      const wrap = sectionToggle.closest('.tracker-lane-subheader, .tracker-lane-header');
      const ids = [...(wrap?.querySelectorAll('.tracker-overflow-bubble[data-id]') || [])]
        .map((b) => b.dataset.id).filter(Boolean);
      setBubblesExpanded(ids, !areAllBubblesExpanded(ids));
      await renderTracker();
      showScreen('tracker');
      return;
    }

    // Clear (×) on a final-stage dock only collapses that lane's previews.
    const clearBubblesBtn = event.target.closest('[data-clear-final-bubbles="true"]');
    if (clearBubblesBtn) {
      const lane = clearBubblesBtn.closest('.tracker-lane-final');
      const ids = [...(lane?.querySelectorAll('[data-expand-card-id]') || [])]
        .map((b) => b.dataset.expandCardId).filter(Boolean);
      if (ids.length) setBubblesExpanded(ids, false);
      else clearFinalStageBubbleSelections();
      await renderTracker();
      showScreen('tracker');
      return;
    }

    // Both final-stage bubbles and primary-lane overflow bubbles expand to a
    // read-only preview card via the same selection set.
    const expandBubbleBtn = event.target.closest('[data-expand-card-id]');
    if (expandBubbleBtn) {
      const id = expandBubbleBtn.dataset.expandCardId || '';
      if (id) {
        toggleFinalStageBubbleSelection(id);
        await renderTracker();
        showScreen('tracker');
      }
      return;
    }

    // Don't intercept company title links
    if (event.target.closest('.tracker-summary-title-link')) {
      event.stopPropagation();
      return;
    }

    // Toggle expand/collapse
    const toggleBtn = event.target.closest('.tracker-card-toggle');
    if (toggleBtn) {
      const card = toggleBtn.closest('.tracker-card');
      if (card) {
        const willExpand = !card.classList.contains('expanded');
        // Only one card may be in edit mode at a time — collapse any others.
        if (willExpand) collapseAllExpandedCards(card.dataset.id);
        const expanded = card.classList.toggle('expanded');
        toggleBtn.setAttribute('aria-expanded', String(expanded));
        const id = card.dataset.id;
        if (expanded) expandedTrackerIds.add(id);
        else expandedTrackerIds.delete(id);
      }
      return;
    }

    // Interview Prep button
    const interviewPrepBtn = event.target.closest('.tracker-interview-prep-btn');
    if (interviewPrepBtn) {
      const id = interviewPrepBtn.dataset.id;
      if (id) {
        try {
          await openInterviewPrepForApplication(id);
        } catch (err) {
          setTrackerScreenStatus('❌ Could not load interview prep: ' + err.message, 'error');
        }
      }
      return;
    }

    // Delete button
    const deleteBtn = event.target.closest('.tracker-delete-btn');
    if (deleteBtn) {
      const card = deleteBtn.closest('.tracker-card');
      if (card) {
        await deleteTrackerCard(card);
      }
      return;
    }

    // Save button
    const saveBtn = event.target.closest('.tracker-save-btn');
    if (!saveBtn) return;
    const card = saveBtn.closest('.tracker-card');
    if (!card) return;
    await saveTrackerCard(card, { showMessage: true });
  });

  // Keyboard support for the expand/collapse card summary (role="button").
  $('tracker-body')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    const toggle = event.target.closest('.tracker-card-toggle');
    if (!toggle) return;
    event.preventDefault();
    toggle.click();
  });

  // Click-away: a click anywhere outside an expanded card collapses it.
  document.addEventListener('click', (event) => {
    if (!document.querySelector('#tracker-body .tracker-card.expanded')) return;
    // Ignore clicks inside an expanded card (editing) or on a toggle (the
    // delegated handler above already manages expand/collapse for those).
    if (event.target.closest('.tracker-card.expanded')) return;
    if (event.target.closest('.tracker-card-toggle')) return;
    collapseAllExpandedCards();
  });

  // Esc collapses the open card too.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!document.querySelector('#tracker-body .tracker-card.expanded')) return;
    collapseAllExpandedCards();
  });

  // Auto-save on field change/blur
  const autoSave = (event) => {
    const field = event.target.closest?.('[data-field], [data-pay-range]');
    if (!field) return;
    const card = field.closest('.tracker-card');
    if (!card) return;

    if (field.dataset.field === 'status') {
      const tone = normalizeApplicationStatus(field.value || 'drafted');
      field.dataset.statusTone = tone;
      // Capture the previous status BEFORE mutating so saveTrackerCard can
      // detect a lane change and re-render the card into its new section.
      card.dataset.prevStatus = card.dataset.status || 'drafted';
      card.dataset.status = tone;
    }

    if (field.dataset.field === 'location_select') {
      const otherInput = card.querySelector('[data-field="location_other"]');
      if (otherInput) {
        otherInput.classList.toggle('hidden', field.value !== 'other');
        if (field.value !== 'other') {
          otherInput.value = '';
        }
      }
    }

    if (field.dataset.field === 'scorecard_select') {
      const otherInput = card.querySelector('[data-field="scorecard_other"]');
      if (otherInput) {
        otherInput.classList.toggle('hidden', field.value !== 'other');
        if (field.value !== 'other') {
          otherInput.value = '';
        }
      }
    }

    const isPayField = field.matches?.('[data-pay-range]')
      || field.dataset.field === 'pay_min'
      || field.dataset.field === 'pay_max';

    if (isPayField && (event.type === 'input' || event.type === 'change')) {
      syncPayInputs(card, field, event.type);
    }

    // Re-validate pay on any interaction so the Save button reflects validity.
    const payValid = validatePayInputs(card);

    // Don't quietly persist a bad pay range — keep the highlight up and let the
    // user fix it (or hit Save, which stays blocked while invalid).
    if (isPayField && !payValid) return;

    scheduleTrackerSave(card);
  };

  $('tracker-body')?.addEventListener('input', autoSave, true);
  $('tracker-body')?.addEventListener('change', autoSave, true);
  $('tracker-body')?.addEventListener('focusout', autoSave, true);
}

// ── Expand / collapse helpers ───────────────────────────────────────────────

/**
 * Collapse every expanded card except `keepId`. Mutates the DOM directly (no
 * re-render) so the cards stay exactly where they are in their lanes.
 */
function collapseAllExpandedCards(keepId = null) {
  document.querySelectorAll('#tracker-body .tracker-card.expanded').forEach((card) => {
    if (keepId && card.dataset.id === keepId) return;
    card.classList.remove('expanded');
    card.querySelector('.tracker-card-toggle')?.setAttribute('aria-expanded', 'false');
    if (card.dataset.id) expandedTrackerIds.delete(card.dataset.id);
  });
}

// ── Save / delete ───────────────────────────────────────────────────────────

function scheduleTrackerSave(card) {
  const id = card?.dataset?.id;
  if (!id) return;

  if (trackerSaveTimers.has(id)) {
    clearTimeout(trackerSaveTimers.get(id));
  }

  const timer = setTimeout(() => {
    saveTrackerCard(card, { showMessage: false }).catch((err) => {
      setStatus('fill-status', '❌ ' + err.message, 'error');
    });
    trackerSaveTimers.delete(id);
  }, 250);

  trackerSaveTimers.set(id, timer);
}

async function saveTrackerCard(card, { showMessage = false } = {}) {
  const id = card?.dataset?.id;
  if (!id) return;

  const previousStatus = card.dataset.prevStatus || card.dataset.status || 'drafted';
  const saveBtn = card.querySelector('.tracker-save-btn');
  const saveState = card.querySelector('.tracker-save-state');

  const dateInput = card.querySelector('input[data-field="date"]');

  const scorecardSelect = card.querySelector('[data-field="scorecard_select"]')?.value || '';
  const scorecardOther = card.querySelector('[data-field="scorecard_other"]')?.value || '';

  let scorecardValue = '';
  if (scorecardSelect === 'other') {
    scorecardValue = scorecardOther;
  } else if (scorecardSelect !== '') {
    scorecardValue = `${Number(scorecardSelect)}/5`;
  }

  const patch = {
    company: card.querySelector('[data-field="company"]')?.value || '',
    title: card.querySelector('[data-field="title"]')?.value || '',
    url: card.querySelector('[data-field="url"]')?.value || '',
    status: card.querySelector('[data-field="status"]')?.value || 'drafted',
    location: getLocationValueFromCard(card),
    employment_type: card.querySelector('[data-field="employment_type"]')?.value || 'Full-time',
    remote: !!card.querySelector('[data-field="remote"]')?.checked,
    pay_min: Number(card.querySelector('[data-field="pay_min"]')?.value || 0) || 0,
    pay_max: Number(card.querySelector('[data-field="pay_max"]')?.value || 0) || 0,
    scorecard: scorecardValue,
    verdict: card.querySelector('[data-field="verdict"]')?.value || '',
    description: card.querySelector('[data-field="description"]')?.value || '',
  };

  if (patch.pay_min > patch.pay_max) {
    const tmp = patch.pay_min;
    patch.pay_min = patch.pay_max;
    patch.pay_max = tmp;
  }

  if (dateInput) {
    patch.date = dateInput.value || '';
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
  }
  if (saveState) {
    saveState.textContent = 'Saving…';
    saveState.classList.remove('ok');
  }

  try {
    const resp = await sendMessage({
      type: 'UPDATE_APPLICATION',
      payload: { id, patch },
    });

    if (!resp?.success) {
      throw new Error(resp?.error || 'Could not update tracker entry.');
    }

    card.classList.add('saved-flash');
    if (saveState) {
      saveState.textContent = showMessage ? '✅ Saved' : '✅ Auto-saved';
      saveState.classList.add('ok');
    }
    if (showMessage) {
      setStatus('fill-status', '✅ Tracker entry updated.', 'success');
    }

    const nextStatus = normalizeApplicationStatus(patch.status);
    card.dataset.status = nextStatus;
    delete card.dataset.prevStatus;
    card.dataset.sortOrder = String(resp?.entry?.sort_order ?? card.dataset.sortOrder ?? '');
    syncTrackerCardSummary(card, {
      ...patch,
      ...(resp?.entry || {}),
    });

    // An explicit Save collapses the card one level — hide the edit details and
    // fall back to the summary view. Auto-saves (on blur) leave it open.
    if (showMessage && id && expandedTrackerIds.has(id)) {
      expandedTrackerIds.delete(id);
      card.classList.remove('expanded');
      card.querySelector('.tracker-card-toggle')?.setAttribute('aria-expanded', 'false');
    }

    await loadMainScreen({ showMain: false });

    if (nextStatus !== normalizeApplicationStatus(previousStatus)) {
      await renderTracker();
      showScreen('tracker');
    }

    setTimeout(() => {
      card.classList.remove('saved-flash');
    }, 1200);
  } catch (err) {
    if (saveState) {
      saveState.textContent = 'Save failed';
      saveState.classList.remove('ok');
    }
    if (showMessage) {
      setStatus('fill-status', '❌ ' + err.message, 'error');
    }
    throw err;
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
    // Re-assert the blocked state if the pay range is still invalid.
    validatePayInputs(card);
  }
}

async function deleteTrackerCard(card) {
  const id = card?.dataset?.id;
  if (!id) return;

  const company = card.querySelector('.tracker-summary-title')?.textContent?.trim() || 'this application';
  const confirmed = confirm(`Delete ${company} from the tracker? This only removes the local tracker card.`);
  if (!confirmed) return;

  const resp = await sendMessage({
    type: 'DELETE_APPLICATION',
    payload: { id },
  });

  if (!resp?.success) {
    throw new Error(resp?.error || 'Could not delete that tracker entry.');
  }

  expandedTrackerIds.delete(id);
  setTrackerScreenStatus('✅ Tracker entry deleted.', 'success');
  await renderTracker();
  await loadMainScreen({ showMain: false });
  showScreen('tracker');
}

// ── Add form ────────────────────────────────────────────────────────────────

function toggleTrackerAddForm(forceOpen) {
  const card = $('tracker-add-card');
  if (!card) return;

  const shouldOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : card.classList.contains('hidden');

  card.classList.toggle('hidden', !shouldOpen);
  const addBtn = $('add-application-btn');
  if (addBtn) {
    addBtn.textContent = shouldOpen ? 'Close add form' : '＋ Add manually';
  }

  if (!shouldOpen) {
    resetTrackerDraftForm();
    setTrackerAddStatus('Paste a JD or import the current page, then save.');
    return;
  }

  // Always default status to drafted when opening add form
  if ($('new-application-status')) {
    $('new-application-status').value = 'drafted';
  }
  $('new-application-company')?.focus();
}

async function importCurrentPageIntoTrackerForm() {
  toggleTrackerAddForm(true);
  setTrackerAddStatus('⏳ Importing the current page…');

  try {
    const resp = await sendToActiveTab({ type: 'GET_JOB_INFO' });
    if (!resp?.success || !resp.job) {
      throw new Error(resp?.error || 'Could not read job details from the current page.');
    }

    fillTrackerDraftForm({
      ...resp.job,
      description: resp.job.jd || '',
    });
    setTrackerAddStatus('✅ Current page details imported.', 'success');
  } catch (err) {
    setTrackerAddStatus('❌ ' + err.message, 'error');
  }
}

async function saveNewApplicationFromForm() {
  const saveBtn = $('save-new-application-btn');
  const draft = readTrackerDraftForm();

  if (!draft.company && !draft.title) {
    setTrackerAddStatus('❌ Add at least a company or role title first.', 'error');
    return;
  }

  if (saveBtn) saveBtn.disabled = true;
  setTrackerAddStatus('⏳ Saving to tracker…');

  try {
    let derived = {};
    if (draft.description) {
      const resp = await sendMessage({
        type: 'PARSE_APPLICATION_DRAFT',
        payload: { text: draft.description, draft },
      });
      derived = resp?.details || {};
    }

    const payload = {
      ...derived,
      ...draft,
      location: draft.location || derived.location || 'Unknown',
      employment_type: draft.employment_type || derived.employment_type || 'Full-time',
      remote: draft.remote || derived.remote || false,
      salary_range: draft.salary_range || derived.salary_range || '',
      jd_snippet: draft.description.slice(0, 300),
      answers_generated: false,
      fill_report: null,
    };

    const resp = await sendMessage({ type: 'LOG_APPLICATION', payload });
    if (!resp?.success) {
      throw new Error(resp?.error || 'Could not add that tracker entry.');
    }

    resetTrackerDraftForm();
    toggleTrackerAddForm(false);
    await renderTracker();
    await loadMainScreen({ showMain: false });
    showScreen('tracker');
    setStatus('fill-status', '✅ Application added to the tracker.', 'success');
  } catch (err) {
    setTrackerAddStatus('❌ ' + err.message, 'error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── Drag & drop ─────────────────────────────────────────────────────────────

export function handleTrackerDragStart(event) {
  // Bubbles and the card grabber handle both move an application between lanes.
  const handle = event.target.closest('.tracker-overflow-bubble[draggable="true"], .tracker-final-bubble[draggable="true"], .tracker-card-grabber[draggable="true"]');
  if (handle) {
    trackerDragState.id = handle.dataset.id || '';
    trackerDragState.status = normalizeApplicationStatus(handle.dataset.status || 'drafted');
    trackerDragState.kind = 'bubble';
    handle.classList.add('dragging');
    handle.closest('.tracker-card')?.classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', trackerDragState.id);
    }
    return;
  }

  const card = event.target.closest('.tracker-card');
  if (!card) return;
  if (card.classList.contains('expanded') || card.getAttribute('draggable') === 'false') {
    event.preventDefault();
    return;
  }

  trackerDragState.id = card.dataset.id || '';
  trackerDragState.status = card.dataset.status || 'drafted';
  trackerDragState.kind = 'card';
  card.classList.add('dragging');

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', trackerDragState.id);
  }
}

function getLocationValueFromCard(card) {
  const select = card.querySelector('[data-field="location_select"]');
  const other = card.querySelector('[data-field="location_other"]');
  if (!select) return 'Unknown';
  if (select.value === 'other') {
    return (other?.value || '').trim() || 'Unknown';
  }
  return String(select.value || '').trim() || 'Unknown';
}

const PAY_SLIDER_MAX = 500000;
const PAY_SLIDER_STEP = 5000;

// Map an arbitrary number onto the slider's stepped 0–500k track for display.
// The number box keeps the user's exact value; the slider just visualizes it.
function payToSlider(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(PAY_SLIDER_MAX, Math.round(num / PAY_SLIDER_STEP) * PAY_SLIDER_STEP);
}

// Gentle correction applied only on blur/change: clamp negatives to 0, drop
// junk, but otherwise preserve the exact figure the user typed.
function normalizePayOnBlur(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return '';
  const num = Number(text);
  if (!Number.isFinite(num) || num < 0) return '0';
  return String(Math.round(num));
}

function syncPayInputs(card, changedField, eventType) {
  const minRange = card.querySelector('[data-pay-range="min"]');
  const maxRange = card.querySelector('[data-pay-range="max"]');
  const minNumber = card.querySelector('[data-field="pay_min"]');
  const maxNumber = card.querySelector('[data-field="pay_max"]');
  if (!minRange || !maxRange || !minNumber || !maxNumber) return;

  if (changedField === minRange) {
    // Dragging a slider writes its (already stepped) value into the number box.
    minNumber.value = String(Number(minRange.value));
  } else if (changedField === maxRange) {
    maxNumber.value = String(Number(maxRange.value));
  } else if (changedField?.dataset?.field === 'pay_min' && eventType === 'change') {
    minNumber.value = normalizePayOnBlur(minNumber.value);
  } else if (changedField?.dataset?.field === 'pay_max' && eventType === 'change') {
    maxNumber.value = normalizePayOnBlur(maxNumber.value);
  }

  // Keep the slider thumbs mirrored to the current numbers without ever
  // rewriting what the user typed (so manual fine-tuning still works).
  minRange.value = String(payToSlider(minNumber.value));
  maxRange.value = String(payToSlider(maxNumber.value));
}

// Flag a bad pay range (negative, non-numeric, or min > max), highlight the
// offending boxes, surface a nudge, and block Save until it's resolved.
function validatePayInputs(card) {
  const minNumber = card.querySelector('[data-field="pay_min"]');
  const maxNumber = card.querySelector('[data-field="pay_max"]');
  const warning = card.querySelector('.pay-warning');
  const saveBtn = card.querySelector('.tracker-save-btn');
  if (!minNumber || !maxNumber) return true;

  const minText = minNumber.value.trim();
  const maxText = maxNumber.value.trim();
  const min = Number(minText);
  const max = Number(maxText);

  const minBad = minText !== '' && (!Number.isFinite(min) || min < 0);
  const maxBad = maxText !== '' && (!Number.isFinite(max) || max < 0);
  const orderBad = minText !== '' && maxText !== ''
    && Number.isFinite(min) && Number.isFinite(max) && min > max;

  minNumber.classList.toggle('pay-invalid', minBad || orderBad);
  maxNumber.classList.toggle('pay-invalid', maxBad || orderBad);

  const valid = !minBad && !maxBad && !orderBad;
  if (warning) {
    warning.textContent = valid
      ? ''
      : orderBad
        ? 'Min pay is higher than max — fix the range before saving.'
        : 'Pay must be a positive number.';
    warning.classList.toggle('hidden', valid);
  }
  if (saveBtn) {
    saveBtn.disabled = !valid;
    saveBtn.classList.toggle('is-blocked', !valid);
  }

  return valid;
}

function handleTrackerDragOver(event) {
  // Bubble / card-grabber moves: highlight the destination lane.
  if (trackerDragState.kind === 'bubble') {
    const dropZone = event.target.closest('[data-status-target]');
    if (!dropZone) return;
    event.preventDefault();
    document.querySelectorAll('.drag-target').forEach((el) => el.classList.remove('drag-target'));
    dropZone.classList.add('drag-target');
    return;
  }

  const dragging = $('tracker-body')?.querySelector('.tracker-card.dragging');
  const container = event.target.closest('.tracker-lane-cards');
  const finalLane = event.target.closest('.tracker-lane-final[data-status-target]');
  if (!dragging || (!container && !finalLane)) return;

  event.preventDefault();
  document.querySelectorAll('.tracker-lane-cards.drag-target').forEach((el) => el.classList.remove('drag-target'));
  document.querySelectorAll('.tracker-lane-final.drag-target').forEach((el) => el.classList.remove('drag-target'));

  if (finalLane && !container) {
    finalLane.classList.add('drag-target');
    return;
  }

  container.classList.add('drag-target');

  const afterElement = getTrackerDragAfterElement(container, event.clientY);
  if (!afterElement) {
    container.appendChild(dragging);
  } else if (afterElement !== dragging) {
    container.insertBefore(dragging, afterElement);
  }
}

export async function handleTrackerDrop(event) {
  // Bubble / card-grabber drop → change the application's status to the lane.
  if (trackerDragState.kind === 'bubble') {
    const dropZone = event.target.closest('[data-status-target]');
    if (!dropZone) {
      clearTrackerDragState();
      return;
    }
    event.preventDefault();
    const movedId = trackerDragState.id;
    const destinationStatus = normalizeApplicationStatus(dropZone.dataset.statusTarget || trackerDragState.status || 'drafted');

    try {
      if (movedId && destinationStatus !== trackerDragState.status) {
        const resp = await sendMessage({
          type: 'UPDATE_APPLICATION',
          payload: { id: movedId, patch: { status: destinationStatus } },
        });
        if (!resp?.success) {
          throw new Error(resp?.error || 'Could not move that card.');
        }
        await renderTracker();
        await loadMainScreen({ showMain: false });
        showScreen('tracker');
        const movedStatusMeta = getTrackingStatusMeta(destinationStatus);
        setTrackerScreenStatus(`✅ Moved card to ${movedStatusMeta.label} — ${movedStatusMeta.optionHint}.`, 'success');
      }
    } catch (err) {
      setTrackerScreenStatus('❌ ' + err.message, 'error');
    } finally {
      clearTrackerDragState();
    }
    return;
  }

  const dragging = $('tracker-body')?.querySelector('.tracker-card.dragging');
  const container = event.target.closest('.tracker-lane-cards');
  const finalLane = event.target.closest('.tracker-lane-final[data-status-target]');
  if (!dragging || (!container && !finalLane)) return;

  event.preventDefault();
  const movedId = trackerDragState.id;
  const destinationStatus = (container?.dataset?.statusTarget || finalLane?.dataset?.statusTarget || dragging.dataset.status || 'drafted');

  try {
    if (finalLane && !container) {
      const resp = await sendMessage({
        type: 'UPDATE_APPLICATION',
        payload: {
          id: movedId,
          patch: { status: destinationStatus },
        },
      });
      if (!resp?.success) {
        throw new Error(resp?.error || 'Could not move card to that lane.');
      }
      await renderTracker();
      await loadMainScreen({ showMain: false });
      showScreen('tracker');
      const movedStatusMeta = getTrackingStatusMeta(destinationStatus);
      setTrackerScreenStatus(`✅ Moved card to ${movedStatusMeta.label} — ${movedStatusMeta.optionHint}.`, 'success');
      return;
    }

    await persistTrackerBoardOrder(movedId, destinationStatus);
  } catch (err) {
    setTrackerScreenStatus('❌ ' + err.message, 'error');
  } finally {
    clearTrackerDragState();
  }
}

export function handleTrackerDragEnd() {
  clearTrackerDragState();
}

function clearTrackerDragState() {
  trackerDragState.id = '';
  trackerDragState.status = '';
  trackerDragState.kind = '';
  document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  document.querySelectorAll('.drag-target').forEach((el) => el.classList.remove('drag-target'));
}

function getTrackerDragAfterElement(container, y) {
  const draggableCards = [...container.querySelectorAll('.tracker-card:not(.dragging)')];
  return draggableCards.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

async function persistTrackerBoardOrder(movedId, destinationStatus) {
  const containers = [...document.querySelectorAll('#tracker-body .tracker-lane-cards')];
  const updates = [];
  let sortOrder = 0;

  for (const container of containers) {
    const status = container.dataset.statusTarget || 'drafted';
    const cards = container.querySelectorAll('.tracker-card');
    for (const card of cards) {
      const id = card.dataset.id;
      if (!id) continue;
      const cardStatus = id === movedId ? destinationStatus : status;
      updates.push({ id, status: cardStatus, sort_order: sortOrder });
      sortOrder++;
    }
  }

  if (!updates.length) return;

  setTrackerScreenStatus('⏳ Updating board order…');
  const resp = await sendMessage({
    type: 'REORDER_APPLICATIONS',
    payload: { updates },
  });

  if (!resp?.success) {
    throw new Error(resp?.error || 'Could not reorder the tracker board.');
  }

  await renderTracker();
  await loadMainScreen({ showMain: false });
  showScreen('tracker');

  const movedStatusMeta = getTrackingStatusMeta(destinationStatus);
  setTrackerScreenStatus(
    movedId
      ? `✅ Moved card to ${movedStatusMeta.label} — ${movedStatusMeta.optionHint}.`
      : '✅ Tracker board order updated.',
    'success'
  );
}
