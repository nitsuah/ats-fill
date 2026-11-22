/**
 * background/modules/handlers/learned.js - Learned default answers handlers
 * Extracted from service-worker.js
 */

import {
  getLearnedMemoryKey,
  isIgnoredLearnedPrompt,
  shouldPersistLearnedValue,
} from '../../../lib/form-filler.js';
import {
  sanitizeLearnedDefaultsMap,
  sanitizeIgnoredLearnedDefaultsMap,
  trimLearnedDefaultsMap,
  trimIgnoredLearnedDefaultsMap,
} from '../helpers.js';

function findStoredLearnedEntry(map = {}, question = '') {
  const normalizedKey = getLearnedMemoryKey(question);
  const exact = Object.entries(map || {}).find(([label]) => getLearnedMemoryKey(label) === normalizedKey);
  if (!exact) return null;
  return { question: exact[0], answer: String(exact[1] || '').trim() };
}

const MAX_PENDING_LEARNED = 25;

/**
 * Stage page-captured answers for review. Nothing captured from a page is
 * stored as a learned default until the user approves it from the extension UI.
 * @param {{ entries: Record<string, string> }} payload Question→answer pairs proposed by a page.
 * @returns {Promise<{success: true, saved: 0, pending: number}>} `pending` is the staged count.
 */
export async function handleSaveLearnedDefaults({ entries } = {}) {
  const incomingEntries = entries && typeof entries === 'object' ? entries : {};
  const data = await chrome.storage.local.get(['learnedDefaults', 'ignoredLearnedDefaults', 'pendingLearnedDefaults']);
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  const learnedDefaults = sanitizeLearnedDefaultsMap(data.learnedDefaults || {}, ignoredLearnedDefaults);
  const pending = sanitizePendingMap(data.pendingLearnedDefaults);

  for (const [label, value] of Object.entries(incomingEntries)) {
    const question = String(label || '').trim();
    const answer = String(value || '').trim();
    if (!shouldPersistLearnedValue(question, answer)) continue;
    if (isIgnoredLearnedPrompt(question, ignoredLearnedDefaults)) continue;
    const stored = findStoredLearnedEntry(learnedDefaults, question);
    if (stored && stored.answer === answer) {
      // Back to the stored answer: drop any suggestion it replaced.
      delete pending[question];
      continue;
    }

    delete pending[question];
    pending[question] = answer;
  }

  const trimmedPending = trimPendingMap(pending);
  await chrome.storage.local.set({ pendingLearnedDefaults: trimmedPending });
  return { success: true, saved: 0, pending: Object.keys(trimmedPending).length };
}

function sanitizePendingMap(map) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [question, answer] of Object.entries(map)) {
    if (typeof answer === 'string' && shouldPersistLearnedValue(question, answer)) out[question] = answer;
  }
  return out;
}

function trimPendingMap(map = {}) {
  return Object.fromEntries(Object.entries(map).slice(-MAX_PENDING_LEARNED));
}

/** Approve a staged answer (optionally edited) so it becomes a learned default. */
export async function handleApprovePendingLearnedDefault({ question, answer } = {}) {
  const key = String(question || '').trim();
  const data = await chrome.storage.local.get('pendingLearnedDefaults');
  const pending = sanitizePendingMap(data.pendingLearnedDefaults);
  if (!Object.hasOwn(pending, key)) throw new Error('That suggestion is no longer pending.');
  const value = String(answer === undefined ? pending[key] : answer).trim();
  await handleUpdateLearnedDefault({ question: key, answer: value });
  delete pending[key];
  await chrome.storage.local.set({ pendingLearnedDefaults: pending });
  return { success: true };
}

/** Drop a staged answer without saving it. */
export async function handleDiscardPendingLearnedDefault({ question } = {}) {
  const key = String(question || '').trim();
  const data = await chrome.storage.local.get('pendingLearnedDefaults');
  const pending = sanitizePendingMap(data.pendingLearnedDefaults);
  delete pending[key];
  await chrome.storage.local.set({ pendingLearnedDefaults: pending });
  return { success: true };
}

export async function handleGetLearnedDefaults() {
  const data = await chrome.storage.local.get(['learnedDefaults', 'ignoredLearnedDefaults', 'pendingLearnedDefaults']);
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  const learnedDefaults = sanitizeLearnedDefaultsMap(data.learnedDefaults || {}, ignoredLearnedDefaults);

  await chrome.storage.local.set({
    learnedDefaults,
    ignoredLearnedDefaults: trimIgnoredLearnedDefaultsMap(ignoredLearnedDefaults),
  });

  return {
    success: true,
    items: Object.entries(learnedDefaults).map(([question, answer]) => ({ question, answer })),
    pendingItems: Object.entries(sanitizePendingMap(data.pendingLearnedDefaults)).map(([question, answer]) => ({ question, answer })),
    ignoredItems: Object.values(trimIgnoredLearnedDefaultsMap(ignoredLearnedDefaults)),
  };
}

export async function handleUpdateLearnedDefault({ question, answer } = {}) {
  const key = String(question || '').trim();
  const value = String(answer || '').trim();
  if (!shouldPersistLearnedValue(key, value)) {
    throw new Error('That remembered answer is not eligible to be stored.');
  }

  const data = await chrome.storage.local.get(['learnedDefaults', 'ignoredLearnedDefaults']);
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  if (isIgnoredLearnedPrompt(key, ignoredLearnedDefaults)) {
    throw new Error('That memory entry is currently ignored. Delete it from the ignore list to re-enable it.');
  }

  const learnedDefaults = sanitizeLearnedDefaultsMap({ ...(data.learnedDefaults || {}) }, ignoredLearnedDefaults);
  learnedDefaults[key] = value;
  await chrome.storage.local.set({ learnedDefaults: trimLearnedDefaultsMap(learnedDefaults) });
  return { success: true };
}

export async function handleIgnoreLearnedDefault({ question } = {}) {
  const key = String(question || '').trim();
  if (!key) throw new Error('Memory question is required.');

  const data = await chrome.storage.local.get(['learnedDefaults', 'ignoredLearnedDefaults']);
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  const learnedDefaults = sanitizeLearnedDefaultsMap(data.learnedDefaults || {}, ignoredLearnedDefaults);
  const entry = findStoredLearnedEntry(learnedDefaults, key);
  if (!entry) {
    throw new Error('Could not find that memory entry to ignore.');
  }

  delete learnedDefaults[entry.question];
  ignoredLearnedDefaults[getLearnedMemoryKey(entry.question)] = {
    question: entry.question,
    answer: entry.answer,
    ignored_at: new Date().toISOString(),
  };

  await chrome.storage.local.set({
    learnedDefaults: trimLearnedDefaultsMap(learnedDefaults),
    ignoredLearnedDefaults: trimIgnoredLearnedDefaultsMap(ignoredLearnedDefaults),
  });
  return { success: true };
}

export async function handleDeleteLearnedDefault({ question } = {}) {
  const key = String(question || '').trim();
  const data = await chrome.storage.local.get('learnedDefaults');
  const learnedDefaults = { ...(data.learnedDefaults || {}) };
  delete learnedDefaults[key];
  await chrome.storage.local.set({ learnedDefaults: trimLearnedDefaultsMap(learnedDefaults) });
  return { success: true };
}

export async function handleDeleteIgnoredLearnedDefault({ question } = {}) {
  const key = getLearnedMemoryKey(question);
  if (!key) return { success: true };

  const data = await chrome.storage.local.get(['learnedDefaults', 'ignoredLearnedDefaults']);
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  const learnedDefaults = sanitizeLearnedDefaultsMap(data.learnedDefaults || {}, ignoredLearnedDefaults);
  const archivedEntry = ignoredLearnedDefaults[key] || null;

  delete ignoredLearnedDefaults[key];

  if (archivedEntry?.question && shouldPersistLearnedValue(archivedEntry.question, archivedEntry.answer || '')) {
    learnedDefaults[archivedEntry.question] = String(archivedEntry.answer || '').trim();
  }

  await chrome.storage.local.set({
    learnedDefaults: trimLearnedDefaultsMap(sanitizeLearnedDefaultsMap(learnedDefaults, ignoredLearnedDefaults)),
    ignoredLearnedDefaults: trimIgnoredLearnedDefaultsMap(ignoredLearnedDefaults),
  });
  return { success: true };
}
