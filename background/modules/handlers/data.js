/**
 * background/modules/handlers/data.js - Bulk storage operations and static data
 * Extracted from service-worker.js
 */

/** Removes transient session data (drafts, last answers/fill report) while keeping settings and history.
 * @returns {Promise<{success: true}>} */
export async function handleClearTempData() {
  await chrome.storage.local.remove([
    'applicationDrafts',
    'lastAnswers',
    'lastFillReport',
    'lastTrackedApplicationId',
  ]);
  return { success: true };
}

/** Wipes all extension storage.
 * @returns {Promise<{success: true}>} */
export async function handleResetAllData() {
  await chrome.storage.local.clear();
  return { success: true };
}

/** @returns {Promise<object>} The packaged field-map JSON (no success wrapper). */
export async function handleGetFieldMap() {
  const url = chrome.runtime.getURL('data/field-map.json');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load field map: ${response.status}`);
  return response.json();
}
