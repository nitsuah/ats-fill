/**
 * background/modules/handlers/tracker.js - Application tracker handlers
 * Extracted from service-worker.js
 */

import {
  addApplication,
  deleteApplication,
  deriveTrackerDetailsFromText,
  findDuplicateGroups,
  importApplicationsFromCsv,
  mergeDuplicateGroup,
  removeDuplicateApplications,
  isTerminalApplicationStatus,
  updateApplication,
  updateApplicationStatus,
} from '../../../lib/tracker.js';

/** @param {object} app Application fields (company, title, url, status, fill_report, ...).
 * @returns {Promise<{success: true, entry: object}>} */
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

  const trackedData = await chrome.storage.local.get('lastTrackedApplicationId');
  let lastTrackedApplicationId = trackedData.lastTrackedApplicationId;

  const updatedEntries = [];
  for (const item of items) {
    if (!item?.id) continue;
    const entry = await updateApplication(item.id, {
      status: item.status,
      sort_order: item.sort_order,
    });
    if (entry) {
      updatedEntries.push(entry);
      // Mirror handleUpdateApplication's cleanup: once the tracked entry
      // reaches a terminal status, its stale fill report should stop showing.
      if (lastTrackedApplicationId === entry.id && isTerminalApplicationStatus(entry.status)) {
        await chrome.storage.local.set({
          lastFillReport: null,
          lastTrackedApplicationId: null,
        });
        lastTrackedApplicationId = null;
      }
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

/**
 * Record an application ats-fill submitted itself (opt-in "Full auto").
 * Marks the entry from the last fill as submitted and keeps an audit record on it
 * (when, which ATS, how many fields were filled) so the user can see what was sent.
 * The caller passes the id of the entry its own fill logged.
 */
export async function handleLogAutoSubmit({ id: requestedId, url, ats, filled, resume_attached } = {}) {
  const data = await chrome.storage.local.get(['lastTrackedApplicationId', 'settings']);
  if (data.settings?.full_auto_submit !== true) throw new Error('Full auto is off.');
  // Bound to the entry the sending fill created, so a newer fill in another tab cannot redirect it.
  const id = requestedId || data.lastTrackedApplicationId;
  if (!id) throw new Error('No recent autofill session to record a submit for.');
  const updated = await updateApplication(id, { status: 'submitted' });
  if (!updated) throw new Error('Could not find the recent application entry to update.');
  const { applications = [] } = await chrome.storage.local.get('applications');
  const entry = applications.find((item) => item.id === id);
  if (entry) {
    entry.auto_submit = {
      at: new Date().toISOString(),
      ats: String(ats || '').slice(0, 40),
      url: String(url || '').slice(0, 500),
      filled: Number(filled) || 0,
      resume_attached: Number(resume_attached) || 0,
    };
    await chrome.storage.local.set({ applications });
  }
  return { success: true };
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

/**
 * Preview what "Remove duplicates" would merge, without changing anything.
 * @returns {Promise<{success: true, groups: object[]}>}
 */
export async function handleFindDuplicateApplications() {
  const data = await chrome.storage.local.get('applications');
  const groups = findDuplicateGroups(data.applications || []).map((group) => {
    const { keep, removeIds } = mergeDuplicateGroup(group);
    return { company: keep.company || '', title: keep.title || '', status: keep.status, count: group.length, removed: removeIds.length };
  });
  return { success: true, groups };
}

/** Merge each duplicate group into one tracker row. */
export async function handleRemoveDuplicateApplications() {
  const result = await removeDuplicateApplications();
  return { success: true, ...result };
}
