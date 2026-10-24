/**
 * background/modules/handlers/jobs.js - Job search handlers
 * Extracted from service-worker.js
 */

import { transformJobText } from '../../../lib/gemini.js';
import { searchJobs, listJobSources } from '../../../lib/job-search.js';
import { sendFillFormToVerifiedTab } from '../../../lib/utils.js';

async function buildJobSearchConfig(settings = {}) {
  const config = {};
  if (settings.adzuna_app_id && settings.adzuna_app_key) {
    config.adzuna = {
      appId: settings.adzuna_app_id,
      appKey: settings.adzuna_app_key,
      country: settings.adzuna_country || 'us',
    };
  }
  if (settings.usajobs_email && settings.usajobs_api_key) {
    config.usajobs = {
      email: settings.usajobs_email,
      apiKey: settings.usajobs_api_key,
    };
  }
  if (settings.reed_api_key) {
    config.reed = {
      apiKey: settings.reed_api_key,
    };
  }
  if (settings.jooble_api_key) {
    config.jooble = {
      apiKey: settings.jooble_api_key,
    };
  }
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    config.linkedin = { sessionActive: tabs.length > 0 };
  } catch {
    config.linkedin = { sessionActive: false };
  }
  if (Array.isArray(settings.custom_job_sources)) {
    config.customSources = settings.custom_job_sources;
  }
  return config;
}

export async function handleSearchJobs({ query, sources } = {}) {
  const data = await chrome.storage.local.get('settings');
  const config = await buildJobSearchConfig(data.settings || {});
  const result = await searchJobs(query, { config, sources, chrome });
  return { success: true, jobs: result.jobs, sources: result.sources };
}

/**
 * Open a job's application page in a new background-free tab so the candidate
 * can review it and submit it themselves. Only http(s) URLs; never clicks,
 * fills or submits anything on the page.
 */
export async function handleOpenApplicationTab({ url } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    throw new Error('OPEN_APPLICATION_TAB needs a valid URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('OPEN_APPLICATION_TAB only opens http(s) URLs.');
  }
  const tab = await chrome.tabs.create({ url: parsed.href, active: true });
  return { success: true, tabId: tab.id };
}

/**
 * Fill an application tab that is already open, with the candidate's saved
 * answers. Runs the same content-script fill as the popup's Fill button. The
 * fill only sets fields and never submits; the candidate reviews and submits.
 * Only a tab already open on this exact page is filled.
 */
export async function handleFillApplicationTab({ url } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    throw new Error('FILL_APPLICATION_TAB needs a valid URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('FILL_APPLICATION_TAB only fills http(s) pages.');
  }
  const tabs = await chrome.tabs.query({ url: `${parsed.origin}/*` });
  // Exact match on the whole URL, query and fragment included: the query can
  // be what identifies the job, so a different job must never be filled.
  const tab = tabs.find((t) => {
    try {
      return new URL(t.url).href === parsed.href;
    } catch {
      return false;
    }
  });
  if (!tab) throw new Error('No open tab on that application page. Open it with OPEN_APPLICATION_TAB first.');
  // Re-read the browser-owned URL immediately before delivery. A tab can navigate
  // after tabs.query, so never send a fill request based only on the stale snapshot.
  const currentTab = await chrome.tabs.get(tab.id);
  let currentUrl;
  try { currentUrl = new URL(currentTab.url).href; } catch { currentUrl = ''; }
  if (currentUrl !== parsed.href) {
    throw new Error('The application page navigated or changed. Reopen the intended application tab and try again.');
  }
  const resp = await sendFillFormToVerifiedTab(tab.id, parsed.href);
  // No response means no frame on the page owns an application form (for
  // example, an overview page). Say so instead of reporting a silent success.
  if (!resp) throw new Error('No application form on that page. Open the application tab (the /application URL) and try again.');
  if (!resp.success) throw new Error(resp.error || 'The page could not be filled.');
  const filled = resp.filled?.length ?? 0;
  // Zero fields means nothing was set; usually the profile or saved answers are empty.
  if (filled === 0) throw new Error('Filled 0 fields. Check the ats-fill profile and saved answers, then try the popup Fill on this tab.');
  return { success: true, tabId: tab.id, filled, warning: resp.warning || null };
}

export async function handleGetJobSources() {
  const data = await chrome.storage.local.get('settings');
  const config = await buildJobSearchConfig(data.settings || {});
  return { success: true, sources: listJobSources(config) };
}

export async function handleSummarizeJd({ text, mode } = {}) {
  const data = await chrome.storage.local.get('settings');
  const settings = data.settings || {};
  if (!settings.gemini_api_key) {
    throw new Error('Add a Gemini API key in the AI panel to use AI summarize / clean-up.');
  }
  const result = await transformJobText({
    text,
    mode: mode === 'cleanup' ? 'cleanup' : 'summary',
    apiKey: settings.gemini_api_key,
    model: settings.gemini_model,
  });
  if (!result) throw new Error('The AI returned an empty result.');
  return { success: true, text: result };
}
