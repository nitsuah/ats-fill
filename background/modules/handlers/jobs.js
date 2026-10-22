/**
 * background/modules/handlers/jobs.js - Job search handlers
 * Extracted from service-worker.js
 */

import { transformJobText } from '../../../lib/gemini.js';
import { searchJobs, listJobSources } from '../../../lib/job-search.js';

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
