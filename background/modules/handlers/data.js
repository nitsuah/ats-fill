/**
 * background/modules/handlers/data.js - Bulk storage operations and static data
 * Extracted from service-worker.js
 */

export async function handleClearTempData() {
  await chrome.storage.local.remove([
    'applicationDrafts',
    'lastAnswers',
    'lastFillReport',
    'lastTrackedApplicationId',
  ]);
  return { success: true };
}

export async function handleResetAllData() {
  await chrome.storage.local.clear();
  return { success: true };
}

export async function handleGetFieldMap() {
  const url = chrome.runtime.getURL('data/field-map.json');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load field map: ${response.status}`);
  return response.json();
}
