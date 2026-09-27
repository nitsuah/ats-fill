/**
 * background/modules/handlers/tracker.js - Application tracker handlers
 * Extracted from service-worker.js
 */

import {
  addApplication,
  deleteApplication,
  deriveTrackerDetailsFromText,
  importApplicationsFromCsv,
  isTerminalApplicationStatus,
  updateApplication,
  updateApplicationStatus,
} from '../../../lib/tracker.js';

export async function handleLogApplication(app) {
  const entry = await addApplication(app);
  await chrome.storage.local.set({
    lastFillReport: app.fill_report || null,
    lastTrackedApplicationId: entry.id,
  });
  return { success: true, entry };
}

export async function handleParseApplicationDraft({ text, draft } = {}) {
  return {
    success: true,
    details: deriveTrackerDetailsFromText(text, draft || {}),
  };
}

export async function handleImportApplicationsCsv({ text } = {}) {
  const csvText = String(text || '');
  if (!csvText.trim()) {
    throw new Error('Choose a CSV file to import first.');
  }

  const result = await importApplicationsFromCsv(csvText);
  if (!result.imported) {
    throw new Error(result.warnings?.[0] || 'No valid application rows were found in that CSV.');
  }

  return {
    success: true,
    imported: result.imported,
    skipped: result.skipped,
    warnings: result.warnings || [],
  };
}

export async function handleUpdateApplication({ id, patch }) {
  if (!id) throw new Error('Application id is required');
  const entry = await updateApplication(id, patch || {});
  if (!entry) {
    throw new Error('Could not find that tracked application.');
  }

  const data = await chrome.storage.local.get('lastTrackedApplicationId');
  if (data.lastTrackedApplicationId === id && isTerminalApplicationStatus(entry.status)) {
    await chrome.storage.local.set({
      lastFillReport: null,
      lastTrackedApplicationId: null,
    });
  }

  return { success: true, entry };
}

export async function handleReorderApplications({ updates } = {}) {
  const items = Array.isArray(updates) ? updates : [];
  if (!items.length) {
    return { success: true, updated: 0 };
  }

  const updatedEntries = [];
  for (const item of items) {
    if (!item?.id) continue;
    const entry = await updateApplication(item.id, {
      status: item.status,
      sort_order: item.sort_order,
    });
    if (entry) {
      updatedEntries.push(entry);
    }
  }

  return {
    success: true,
    updated: updatedEntries.length,
    entries: updatedEntries,
  };
}

export async function handleDeleteApplication({ id } = {}) {
  if (!id) throw new Error('Application id is required');
  const removed = await deleteApplication(id);
  if (!removed) {
    throw new Error('Could not find that tracked application to delete.');
  }

  const data = await chrome.storage.local.get('lastTrackedApplicationId');
  if (data.lastTrackedApplicationId === id) {
    await chrome.storage.local.set({
      lastFillReport: null,
      lastTrackedApplicationId: null,
    });
  }

  return { success: true, removed };
}

export async function handleMarkLastSubmitted() {
  const data = await chrome.storage.local.get('lastTrackedApplicationId');
  const id = data.lastTrackedApplicationId;

  if (!id) {
    throw new Error('No recent autofill session to mark as submitted yet.');
  }

  const updated = await updateApplicationStatus(id, 'submitted');
  if (!updated) {
    throw new Error('Could not find the recent application entry to update.');
  }

  await chrome.storage.local.set({
    lastFillReport: null,
    lastTrackedApplicationId: null,
  });

  return { success: true };
}
