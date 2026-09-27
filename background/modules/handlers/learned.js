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

/** @param {{ entries: Record<string, string> }} payload Question→answer pairs to remember.
 * @returns {Promise<{success: true, saved: number}>} `saved` counts entries that survive trimming to the cap. */
export async function handleSaveLearnedDefaults({ entries } = {}) {
  const incomingEntries = entries && typeof entries === 'object' ? entries : {};
  const data = await chrome.storage.local.get(['learnedDefaults', 'ignoredLearnedDefaults']);
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  const learnedDefaults = sanitizeLearnedDefaultsMap({
    ...(data.learnedDefaults || {}),
  }, ignoredLearnedDefaults);

  const acceptedQuestions = [];
  for (const [label, value] of Object.entries(incomingEntries)) {
    const question = String(label || '').trim();
    const answer = String(value || '').trim();
    if (!shouldPersistLearnedValue(question, answer)) continue;
    if (isIgnoredLearnedPrompt(question, ignoredLearnedDefaults)) continue;

    delete learnedDefaults[question];
    learnedDefaults[question] = answer;
    acceptedQuestions.push(question);
  }

  const trimmedLearnedDefaults = trimLearnedDefaultsMap(sanitizeLearnedDefaultsMap(learnedDefaults, ignoredLearnedDefaults));
  await chrome.storage.local.set({
    learnedDefaults: trimmedLearnedDefaults,
    ignoredLearnedDefaults: trimIgnoredLearnedDefaultsMap(ignoredLearnedDefaults),
  });
  // Count only entries that actually survived trimming to the retention cap,
  // not just the ones accepted before trimming.
  const saved = acceptedQuestions.filter((q) => Object.hasOwn(trimmedLearnedDefaults, q)).length;
  return { success: true, saved };
}

export async function handleGetLearnedDefaults() {
  const data = await chrome.storage.local.get(['learnedDefaults', 'ignoredLearnedDefaults']);
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  const learnedDefaults = sanitizeLearnedDefaultsMap(data.learnedDefaults || {}, ignoredLearnedDefaults);

  await chrome.storage.local.set({
    learnedDefaults,
    ignoredLearnedDefaults: trimIgnoredLearnedDefaultsMap(ignoredLearnedDefaults),
  });

  return {
    success: true,
    items: Object.entries(learnedDefaults).map(([question, answer]) => ({ question, answer })),
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
