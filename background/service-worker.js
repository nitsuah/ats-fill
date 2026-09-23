/**
 * apply-bot — service-worker.js
 * Handles storage, Gemini API calls, and message routing.
 */

import { parseResumeWithGemini, generateAnswers, transformJobText } from '../lib/gemini.js';
import {
  findLearnedAnswer,
  getLearnedMemoryKey,
  isIgnoredLearnedPrompt,
  shouldPersistLearnedValue,
} from '../lib/form-filler.js';
import { structureResume } from '../lib/resume-parser.js';
import { searchJobs, listJobSources } from '../lib/job-search.js';
import {
  mapLinkedInProfileToFields,
  buildLinkedInAuthUrl,
  LINKEDIN_TOKEN_URL,
  LINKEDIN_USERINFO_URL,
  mapGoogleProfileToFields,
  buildGoogleAuthUrl,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
} from '../lib/oauth.js';
import {
  addApplication,
  deleteApplication,
  deriveTrackerDetailsFromText,
  importApplicationsFromCsv,
  isTerminalApplicationStatus,
  updateApplication,
  updateApplicationStatus,
} from '../lib/tracker.js';
import { handleSaveSettingsOnly, handleSaveSetup, getState } from './modules/handlers/index.js';

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages originating from this extension. Content scripts,
  // popup pages, and the service worker itself all carry this extension ID;
  // rejecting other senders prevents another extension from invoking the
  // privileged message router directly.
  if (sender?.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Unauthorized message sender.' });
    return false;
  }

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    sendResponse({ success: false, error: 'Invalid message.' });
    return false;
  }

  handleMessage(msg).then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'SAVE_SETUP':
      return handleSaveSetup(msg.payload);
    case 'SAVE_SETTINGS_ONLY':
      return handleSaveSettingsOnly(msg.payload);
    case 'GET_STATE':
      return getState();
    case 'GET_RESUME_ATTACHMENT':
      return handleGetResumeAttachment();
    case 'REMOVE_RESUME_ATTACHMENT':
      return handleRemoveResumeAttachment();
    case 'GENERATE_ANSWERS':
      return handleGenerateAnswers(msg.payload);
    case 'GET_LAST_ANSWERS':
      return getLastAnswers();
    case 'SEARCH_JOBS':
      return handleSearchJobs(msg.payload);
    case 'GET_JOB_SOURCES':
      return handleGetJobSources();
    case 'GET_OAUTH_INFO':
      return handleGetOauthInfo();
    case 'LINKEDIN_CONNECT':
      return handleLinkedInConnect();
    case 'GOOGLE_CONNECT':
      return handleGoogleConnect();
    case 'SUMMARIZE_JD':
      return handleSummarizeJd(msg.payload);
    case 'LOG_APPLICATION':
      return handleLogApplication(msg.payload);
    case 'PARSE_APPLICATION_DRAFT':
      return handleParseApplicationDraft(msg.payload);
    case 'IMPORT_APPLICATIONS_CSV':
      return handleImportApplicationsCsv(msg.payload);
    case 'UPDATE_APPLICATION':
      return handleUpdateApplication(msg.payload);
    case 'REORDER_APPLICATIONS':
      return handleReorderApplications(msg.payload);
    case 'DELETE_APPLICATION':
      return handleDeleteApplication(msg.payload);
    case 'MARK_LAST_SUBMITTED':
      return handleMarkLastSubmitted();
    case 'SAVE_LEARNED_DEFAULTS':
      return handleSaveLearnedDefaults(msg.payload);
    case 'GET_LEARNED_DEFAULTS':
      return handleGetLearnedDefaults();
    case 'UPDATE_LEARNED_DEFAULT':
      return handleUpdateLearnedDefault(msg.payload);
    case 'IGNORE_LEARNED_DEFAULT':
      return handleIgnoreLearnedDefault(msg.payload);
    case 'DELETE_LEARNED_DEFAULT':
      return handleDeleteLearnedDefault(msg.payload);
    case 'DELETE_IGNORED_LEARNED_DEFAULT':
      return handleDeleteIgnoredLearnedDefault(msg.payload);
    case 'CLEAR_TEMP_DATA':
      return handleClearTempData();
    case 'RESET_ALL_DATA':
      return handleResetAllData();
    case 'ATS_DETECTED':
      return { success: true }; // acknowledged — no action needed
    case 'GET_INTERVIEW_PREP':
      return handleGetInterviewPrep(msg.payload);
    case 'SAVE_INTERVIEW_PREP':
      return handleSaveInterviewPrep(msg.payload);
    case 'GENERATE_INTERVIEW_QUESTIONS':
      return handleGenerateInterviewQuestions(msg.payload);
    case 'GENERATE_INTERVIEW_ANSWER':
      return handleGenerateInterviewAnswer(msg.payload);
    default:
      throw new Error('Unknown message type: ' + msg.type);
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// Maximum plain-text excerpt length stored alongside the structured resume.
// A lightweight preview/downloadable copy can also be kept locally for the
// Profile workspace without disturbing the main popup flow.
const MAX_RESUME_EXCERPT_LENGTH = 1000;
const MAX_RESUME_ATTACHMENT_PREVIEW_LENGTH = 1200;
const MAX_RESUME_ATTACHMENT_DATA_LENGTH = 1_500_000;
const MAX_RESUME_ATTACHMENT_TEXT_LENGTH = 200_000;

async function handleGenerateAnswers({ jd, customQuestions, pageUrl }) {
  const data = await chrome.storage.local.get(['resume', 'settings', 'learnedDefaults', 'ignoredLearnedDefaults']);
  const settings = data.settings || {};
  const resume = data.resume || {};
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  const learnedDefaults = sanitizeLearnedDefaultsMap(data.learnedDefaults || {}, ignoredLearnedDefaults);

  if (!resume.structured) throw new Error('Profile not set up yet');

  const deterministicAnswers = buildDeterministicAnswers({
    resume: resume.structured,
    settings,
    pageUrl,
    customQuestions: customQuestions || [],
    learnedDefaults,
  });

  let answers = { ...deterministicAnswers };
  let warning = null;

  const shouldUseAi = !!settings.gemini_api_key && (String(jd || '').trim() || (customQuestions || []).length);
  if (shouldUseAi) {
    try {
      const aiAnswers = await generateAnswers({
        resume: sanitizeResumeForAi(resume.structured),
        jd,
        customQuestions: customQuestions || [],
        settings,
        apiKey: settings.gemini_api_key,
        model: settings.gemini_model,
      });
      answers = {
        ...deterministicAnswers,
        ...aiAnswers,
      };
    } catch (err) {
      warning = `AI fallback unavailable: ${err.message}. Filled the core profile fields only.`;
      console.warn('[apply-bot] Falling back to deterministic answers only.', err);
    }
  }

  // Persist last answers for preview
  await chrome.storage.local.set({ lastAnswers: answers });

  return { success: true, answers, warning, usedAi: shouldUseAi && !warning };
}

async function getLastAnswers() {
  const data = await chrome.storage.local.get(['lastAnswers', 'lastFillReport']);
  return {
    answers: data.lastAnswers || null,
    report: data.lastFillReport || null,
  };
}

async function handleGetResumeAttachment() {
  const data = await chrome.storage.local.get('resume');
  const attachment = getSavedResumeAttachment(data.resume || {});
  if (!attachment) {
    throw new Error('No saved resume attachment is available yet.');
  }

  return { success: true, attachment };
}

async function handleRemoveResumeAttachment() {
  const data = await chrome.storage.local.get('resume');
  const resume = data.resume || {};

  await chrome.storage.local.set({
    resume: {
      ...resume,
      excerpt: null,
      attachment: null,
      attachmentRemoved: true,
    },
  });

  return { success: true };
}

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

async function handleSearchJobs({ query, sources } = {}) {
  const data = await chrome.storage.local.get('settings');
  const config = await buildJobSearchConfig(data.settings || {});
  const result = await searchJobs(query, { config, sources, chrome });
  return { success: true, jobs: result.jobs, sources: result.sources };
}

async function handleGetJobSources() {
  const data = await chrome.storage.local.get('settings');
  const config = await buildJobSearchConfig(data.settings || {});
  return { success: true, sources: listJobSources(config) };
}

// ── OAuth (LinkedIn / Google profile bootstrap) ───────────────────────────────

function getOauthRedirectUri() {
  try {
    return chrome.identity?.getRedirectURL ? chrome.identity.getRedirectURL() : '';
  } catch {
    return '';
  }
}

async function handleGetOauthInfo() {
  const data = await chrome.storage.local.get('settings');
  const settings = data.settings || {};
  return {
    success: true,
    redirectUri: getOauthRedirectUri(),
    linkedinConfigured: !!(settings.linkedin_client_id && settings.linkedin_client_secret),
    googleConfigured: !!(settings.google_client_id && settings.google_client_secret),
  };
}

async function handleLinkedInConnect() {
  if (!chrome.identity?.launchWebAuthFlow) {
    throw new Error('Browser identity API is unavailable in this context.');
  }
  const data = await chrome.storage.local.get('settings');
  const settings = data.settings || {};
  const clientId = settings.linkedin_client_id;
  const clientSecret = settings.linkedin_client_secret;
  if (!clientId || !clientSecret) {
    throw new Error('Add your LinkedIn app Client ID and Client Secret in the AI panel first.');
  }

  const redirectUri = getOauthRedirectUri();
  const state = crypto.randomUUID();
  const authUrl = buildLinkedInAuthUrl({ clientId, redirectUri, state });

  const redirectResponse = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const responseUrl = new URL(redirectResponse);
  const code = responseUrl.searchParams.get('code');
  const returnedState = responseUrl.searchParams.get('state');
  const oauthError = responseUrl.searchParams.get('error_description') || responseUrl.searchParams.get('error');
  if (oauthError) throw new Error(`LinkedIn sign-in failed: ${oauthError}`);
  if (returnedState !== state) throw new Error('OAuth state mismatch — please try again.');
  if (!code) throw new Error('LinkedIn did not return an authorization code.');

  const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`LinkedIn token exchange failed (${tokenRes.status}). Check your Client Secret and redirect URI.`);
  }
  const token = await tokenRes.json();
  if (!token.access_token) throw new Error('LinkedIn did not return an access token.');

  const userRes = await fetch(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) {
    throw new Error(`Could not read LinkedIn profile (${userRes.status}).`);
  }
  const userinfo = await userRes.json();
  return { success: true, profile: mapLinkedInProfileToFields(userinfo) };
}

async function handleGoogleConnect() {
  if (!chrome.identity?.launchWebAuthFlow) {
    throw new Error('Browser identity API is unavailable in this context.');
  }
  const data = await chrome.storage.local.get('settings');
  const settings = data.settings || {};
  const clientId = settings.google_client_id;
  const clientSecret = settings.google_client_secret;
  if (!clientId || !clientSecret) {
    throw new Error('Add your Google OAuth Client ID and Client Secret in the AI panel first.');
  }

  const redirectUri = getOauthRedirectUri();
  const state = crypto.randomUUID();
  const authUrl = buildGoogleAuthUrl({ clientId, redirectUri, state });

  const redirectResponse = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const responseUrl = new URL(redirectResponse);
  const code = responseUrl.searchParams.get('code');
  const returnedState = responseUrl.searchParams.get('state');
  const oauthError = responseUrl.searchParams.get('error_description') || responseUrl.searchParams.get('error');
  if (oauthError) throw new Error(`Google sign-in failed: ${oauthError}`);
  if (returnedState !== state) throw new Error('OAuth state mismatch — please try again.');
  if (!code) throw new Error('Google did not return an authorization code.');

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed (${tokenRes.status}). Check your Client Secret and redirect URI.`);
  }
  const token = await tokenRes.json();
  if (!token.access_token) throw new Error('Google did not return an access token.');

  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) {
    throw new Error(`Could not read Google profile (${userRes.status}).`);
  }
  const userinfo = await userRes.json();
  return { success: true, profile: mapGoogleProfileToFields(userinfo) };
}

async function handleSummarizeJd({ text, mode } = {}) {
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

async function handleLogApplication(app) {
  const entry = await addApplication(app);
  await chrome.storage.local.set({
    lastFillReport: app.fill_report || null,
    lastTrackedApplicationId: entry.id,
  });
  return { success: true, entry };
}

async function handleParseApplicationDraft({ text, draft } = {}) {
  return {
    success: true,
    details: deriveTrackerDetailsFromText(text, draft || {}),
  };
}

async function handleImportApplicationsCsv({ text } = {}) {
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

async function handleUpdateApplication({ id, patch }) {
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

async function handleReorderApplications({ updates } = {}) {
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

async function handleDeleteApplication({ id } = {}) {
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

async function handleMarkLastSubmitted() {
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

async function handleSaveLearnedDefaults({ entries } = {}) {
  const incomingEntries = entries && typeof entries === 'object' ? entries : {};
  const data = await chrome.storage.local.get(['learnedDefaults', 'ignoredLearnedDefaults']);
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  const learnedDefaults = sanitizeLearnedDefaultsMap({
    ...(data.learnedDefaults || {}),
  }, ignoredLearnedDefaults);

  let saved = 0;
  for (const [label, value] of Object.entries(incomingEntries)) {
    const question = String(label || '').trim();
    const answer = String(value || '').trim();
    if (!shouldPersistLearnedValue(question, answer)) continue;
    if (isIgnoredLearnedPrompt(question, ignoredLearnedDefaults)) continue;

    delete learnedDefaults[question];
    learnedDefaults[question] = answer;
    saved++;
  }

  const trimmedLearnedDefaults = trimLearnedDefaultsMap(sanitizeLearnedDefaultsMap(learnedDefaults, ignoredLearnedDefaults));
  await chrome.storage.local.set({
    learnedDefaults: trimmedLearnedDefaults,
    ignoredLearnedDefaults: trimIgnoredLearnedDefaultsMap(ignoredLearnedDefaults),
  });
  return { success: true, saved };
}

async function handleGetLearnedDefaults() {
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

async function handleUpdateLearnedDefault({ question, answer } = {}) {
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

async function handleIgnoreLearnedDefault({ question } = {}) {
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

async function handleDeleteLearnedDefault({ question } = {}) {
  const key = String(question || '').trim();
  const data = await chrome.storage.local.get('learnedDefaults');
  const learnedDefaults = { ...(data.learnedDefaults || {}) };
  delete learnedDefaults[key];
  await chrome.storage.local.set({ learnedDefaults: trimLearnedDefaultsMap(learnedDefaults) });
  return { success: true };
}

async function handleDeleteIgnoredLearnedDefault({ question } = {}) {
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

async function handleClearTempData() {
  await chrome.storage.local.remove([
    'applicationDrafts',
    'lastAnswers',
    'lastFillReport',
    'lastTrackedApplicationId',
  ]);
  return { success: true };
}

async function handleResetAllData() {
  await chrome.storage.local.clear();
  return { success: true };
}

// ── ATS detection from URL ────────────────────────────────────────────────────

/**
 * Check if a hostname exactly matches a domain or any of its subdomains.
 * @param {string} hostname
 * @param {string} domain
 * @returns {boolean}
 */
function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

function detectAtsFromUrl(url) {
  if (!url) return null;
  try {
    const { hostname, pathname, search } = new URL(url);
    const path = `${pathname} ${search}`.toLowerCase();

    if (matchesDomain(hostname, 'greenhouse.io') && /\/jobs\/|job_app|application/.test(path)) return 'Greenhouse';
    if ((matchesDomain(hostname, 'ashbyhq.com') || matchesDomain(hostname, 'ashby.io')) && /\/application|\/jobs\/|\/job\//.test(path)) return 'Ashby';
    if (matchesDomain(hostname, 'lever.co') && /\/postings\/|\/jobs\/|\/apply/.test(path)) return 'Lever';
    if (matchesDomain(hostname, 'linkedin.com') && /\/jobs\/view\//.test(path)) return 'LinkedIn Easy Apply';
    if (matchesDomain(hostname, 'workday.com') && /\/job\/|requisition|\/apply/.test(path)) return 'Workday';
    if (matchesDomain(hostname, 'icims.com') && /\/jobs\/|\/job\//.test(path)) return 'iCIMS';
      if (matchesDomain(hostname, 'jobvite.com') && /\/job\/|\/apply/.test(path)) return 'Jobvite';
      if ((matchesDomain(hostname, 'circle.com') || matchesDomain(hostname, 'phenompeople.com')) && /\/apply|step=|\/en\//.test(path)) return 'Phenom';
  } catch {
    // Invalid URL — ignore
  }
  return null;
}

function hasAnyProfileData(profile = {}) {
  return Object.entries(profile || {}).some(
    ([key, value]) => key !== 'sensitive_optin' && String(value || '').trim()
  );
}

function sanitizeResumeAttachment(attachment = null) {
  if (!attachment || typeof attachment !== 'object') return null;

  const name = String(attachment.name || '').trim();
  const preview = String(attachment.preview || '').trim().slice(0, MAX_RESUME_ATTACHMENT_PREVIEW_LENGTH);
  const data = typeof attachment.data === 'string' ? attachment.data : '';
  const text = typeof attachment.text === 'string' ? attachment.text : '';
  const downloadMode = attachment.downloadMode === 'data-url' && data ? 'data-url' : 'text';

  if (!name && !preview && !data && !text) {
    return null;
  }

  return {
    name: name || 'resume-preview.txt',
    mimeType: String(attachment.mimeType || '').trim() || (downloadMode === 'data-url' ? 'application/octet-stream' : 'text/plain'),
    source: String(attachment.source || 'saved').trim() || 'saved',
    updatedAt: attachment.updatedAt || null,
    preview,
    downloadMode,
    data: downloadMode === 'data-url' ? data : '',
    text: downloadMode === 'text' ? text.slice(0, MAX_RESUME_ATTACHMENT_TEXT_LENGTH) : '',
  };
}

function extractDataUrlMimeType(dataUrl = '') {
  const match = String(dataUrl || '').match(/^data:([^;,]+)[;,]/i);
  return match?.[1] || '';
}

function buildResumeDownloadText(structured = {}, previewText = '') {
  const experience = Array.isArray(structured?.experience) ? structured.experience : [];
  const education = Array.isArray(structured?.education) ? structured.education : [];
  const skills = Array.isArray(structured?.skills) ? structured.skills : [];

  const lines = [
    structured?.name || '',
    [structured?.email, structured?.phone, structured?.location].filter(Boolean).join(' • '),
    structured?.summary || '',
    structured?.current_title
      ? `${structured.current_title}${structured?.current_company ? ` @ ${structured.current_company}` : ''}`
      : '',
    skills.length ? `Skills: ${skills.slice(0, 16).join(', ')}` : '',
    experience.length ? 'Experience:' : '',
    ...experience.slice(0, 3).map((item) => [item?.title, item?.company].filter(Boolean).join(' — ')),
    education.length ? 'Education:' : '',
    ...education.slice(0, 2).map((item) => [item?.degree, item?.institution || item?.school].filter(Boolean).join(' — ')),
    previewText || '',
  ].filter(Boolean);

  return lines.join('\n').trim().slice(0, MAX_RESUME_ATTACHMENT_TEXT_LENGTH);
}

function buildResumePreviewText({ resumeRaw = '', structured = {}, fallbackPreview = '' } = {}) {
  const raw = String(resumeRaw || '').trim();
  if (raw && !raw.startsWith('data:')) {
    return raw.replace(/\r\n/g, '\n').slice(0, MAX_RESUME_ATTACHMENT_PREVIEW_LENGTH);
  }

  const preview = String(fallbackPreview || buildResumeDownloadText(structured, '') || '').trim();
  return preview.slice(0, MAX_RESUME_ATTACHMENT_PREVIEW_LENGTH);
}

function getSavedResumeAttachment(resume = {}) {
  if (resume?.attachmentRemoved === true) {
    return null;
  }

  const storedAttachment = sanitizeResumeAttachment(resume?.attachment || null);
  if (storedAttachment) {
    return storedAttachment;
  }

  const preview = buildResumePreviewText({
    structured: resume?.structured || {},
    fallbackPreview: resume?.excerpt || '',
  });
  if (!preview) {
    return null;
  }

  return sanitizeResumeAttachment({
    name: 'resume-preview.txt',
    mimeType: 'text/plain',
    source: 'saved',
    updatedAt: null,
    preview,
    downloadMode: 'text',
    text: buildResumeDownloadText(resume?.structured || {}, preview),
  });
}

function buildResumeAttachment({ resumeRaw = '', resumeMeta = {}, structured = {}, previewText = '' } = {}) {
  const raw = String(resumeRaw || '');
  if (!raw.trim()) {
    return null;
  }

  const meta = resumeMeta && typeof resumeMeta === 'object' ? resumeMeta : {};
  const isDataUrl = raw.startsWith('data:');
  const source = meta.source === 'paste' ? 'paste' : 'upload';
  const attachment = {
    name: String(meta.name || (source === 'paste' ? 'resume-paste.txt' : 'resume-upload')).trim() || 'resume-preview.txt',
    mimeType: isDataUrl
      ? (extractDataUrlMimeType(raw) || String(meta.type || '').trim() || 'application/octet-stream')
      : (String(meta.type || '').trim() || 'text/plain'),
    source,
    updatedAt: new Date().toISOString(),
    preview: String(previewText || '').trim().slice(0, MAX_RESUME_ATTACHMENT_PREVIEW_LENGTH),
    downloadMode: 'text',
    data: '',
    text: '',
  };

  if (isDataUrl && raw.length <= MAX_RESUME_ATTACHMENT_DATA_LENGTH) {
    attachment.downloadMode = 'data-url';
    attachment.data = raw;
    return sanitizeResumeAttachment(attachment);
  }

  attachment.text = (
    !isDataUrl && raw.length <= MAX_RESUME_ATTACHMENT_TEXT_LENGTH
      ? raw
      : buildResumeDownloadText(structured, previewText)
  ).slice(0, MAX_RESUME_ATTACHMENT_TEXT_LENGTH);

  return sanitizeResumeAttachment(attachment);
}

function getResumeAttachmentSummary(resume = {}) {
  const attachment = getSavedResumeAttachment(resume);
  if (!attachment) {
    return null;
  }

  return {
    name: attachment.name,
    source: attachment.source,
    updatedAt: attachment.updatedAt,
    preview: attachment.preview,
    hasDownload: !!(attachment.data || attachment.text || attachment.preview),
    downloadLabel: attachment.downloadMode === 'data-url' ? 'Download copy' : 'Download preview',
  };
}

function sanitizeLearnedDefaultsMap(map = {}, ignoredMap = {}) {
  return Object.fromEntries(
    Object.entries(map || {}).filter(([label, value]) => {
      return shouldPersistLearnedValue(label, value) && !isIgnoredLearnedPrompt(label, ignoredMap);
    })
  );
}

function sanitizeIgnoredLearnedDefaultsMap(map = {}) {
  return Object.fromEntries(
    Object.entries(map || {}).map(([key, value]) => {
      const question = String(value?.question || key || '').trim();
      const answer = String(value?.answer || value || '').trim();
      const normalizedKey = getLearnedMemoryKey(question);
      return [normalizedKey, {
        question,
        answer,
        ignored_at: value?.ignored_at || null,
      }];
    }).filter(([key, value]) => key && value.question)
  );
}

function trimLearnedDefaultsMap(map = {}) {
  return Object.fromEntries(Object.entries(map || {}).slice(-75));
}

function trimIgnoredLearnedDefaultsMap(map = {}) {
  return Object.fromEntries(
    Object.entries(map || {})
      .sort((a, b) => String(b[1]?.ignored_at || '').localeCompare(String(a[1]?.ignored_at || '')))
      .slice(0, 100)
  );
}

function findStoredLearnedEntry(map = {}, question = '') {
  const normalizedKey = getLearnedMemoryKey(question);
  const exact = Object.entries(map || {}).find(([label]) => getLearnedMemoryKey(label) === normalizedKey);
  if (!exact) return null;
  return { question: exact[0], answer: String(exact[1] || '').trim() };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function firstNonEmptyNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function mergeStructuredResume(existingResume, incomingResume) {
  const existing = structureResume(existingResume || {});
  const incoming = structureResume(incomingResume || {});

  return {
    ...existing,
    ...incoming,
    name: firstNonEmpty(incoming.name, existing.name),
    email: firstNonEmpty(incoming.email, existing.email),
    phone: firstNonEmpty(incoming.phone, existing.phone),
    location: firstNonEmpty(incoming.location, existing.location),
    address_line1: firstNonEmpty(incoming.address_line1, existing.address_line1),
    city: firstNonEmpty(incoming.city, existing.city),
    state_region: firstNonEmpty(incoming.state_region, existing.state_region),
    postal_code: firstNonEmpty(incoming.postal_code, existing.postal_code),
    linkedin: firstNonEmpty(incoming.linkedin, existing.linkedin),
    github: firstNonEmpty(incoming.github, existing.github),
    portfolio: firstNonEmpty(incoming.portfolio, existing.portfolio),
    pronouns: firstNonEmpty(incoming.pronouns, existing.pronouns),
    current_company: firstNonEmpty(incoming.current_company, existing.current_company),
    current_title: firstNonEmpty(incoming.current_title, existing.current_title),
    summary: firstNonEmpty(incoming.summary, existing.summary),
    years_of_experience: Math.max(Number(existing.years_of_experience) || 0, Number(incoming.years_of_experience) || 0),
    skills: incoming.skills?.length ? incoming.skills : existing.skills,
    experience: incoming.experience?.length ? incoming.experience : existing.experience,
    education: incoming.education?.length ? incoming.education : existing.education,
    certifications: incoming.certifications?.length ? incoming.certifications : existing.certifications,
    languages: incoming.languages?.length ? incoming.languages : existing.languages,
  };
}

function applyProfileOverrides(resume, profile = {}, settings = {}) {
  const next = structureResume({ ...(resume || {}) });
  next.name = firstNonEmpty(profile.full_name, profile.name, next.name);
  next.email = firstNonEmpty(profile.email, next.email);
  next.phone = firstNonEmpty(profile.phone, next.phone);
  next.location = firstNonEmpty(profile.location, next.location);
  next.address_line1 = firstNonEmpty(profile.address_line1, next.address_line1, next.address);
  next.city = firstNonEmpty(profile.city, next.city);
  next.state_region = firstNonEmpty(profile.state_region, profile.state, next.state_region, next.state);
  next.postal_code = firstNonEmpty(profile.postal_code, profile.zip, next.postal_code, next.zip);
  next.linkedin = firstNonEmpty(profile.linkedin, next.linkedin);
  next.github = firstNonEmpty(profile.github, next.github);
  next.portfolio = firstNonEmpty(profile.portfolio, next.portfolio);
  next.pronouns = firstNonEmpty(profile.pronouns, profile.pronouns_sensitive, next.pronouns);
  next.sensitive_optin = profile.sensitive_optin === true;
  next.gender = next.sensitive_optin ? firstNonEmpty(profile.gender, next.gender) : '';
  next.race = next.sensitive_optin ? firstNonEmpty(profile.race, next.race) : '';
  next.veteran = next.sensitive_optin ? firstNonEmpty(profile.veteran, next.veteran) : '';
  next.disability = next.sensitive_optin ? firstNonEmpty(profile.disability, next.disability) : '';
  next.pronouns_sensitive = next.sensitive_optin ? firstNonEmpty(profile.pronouns_sensitive, next.pronouns_sensitive) : '';
  next.current_company = firstNonEmpty(profile.current_company, next.current_company, next.experience?.[0]?.company);
  next.current_title = firstNonEmpty(profile.current_title, next.current_title, next.experience?.[0]?.title);
  next.years_of_experience = firstNonEmptyNumber(profile.years_of_experience, next.years_of_experience);
  next.why_company_default = firstNonEmpty(profile.why_company_default, next.why_company_default);
  next.why_role_default = firstNonEmpty(profile.why_role_default, next.why_role_default);
  next.additional_info_default = firstNonEmpty(profile.additional_info_default, next.additional_info_default);
  next.start_date = firstNonEmpty(profile.start_date, next.start_date);
  next.availability = firstNonEmpty(profile.availability, next.availability);
  next.requires_sponsorship = firstNonEmpty(profile.requires_sponsorship, next.requires_sponsorship);

  if (!Array.isArray(next.experience)) next.experience = [];
  if (next.current_company || next.current_title) {
    if (!next.experience[0]) next.experience[0] = { company: '', title: '', start: '', end: 'Present', description: '' };
    next.experience[0].company = firstNonEmpty(next.current_company, next.experience[0].company);
    next.experience[0].title = firstNonEmpty(next.current_title, next.experience[0].title);
  }

  if (settings.work_authorization && !next.work_authorization) {
    next.work_authorization = settings.work_authorization;
  }

  return next;
}

function getProfileFromResume(resume = {}, settings = {}) {
  const currentExperience = Array.isArray(resume?.experience) ? resume.experience[0] || {} : {};
  const base = {
    full_name: resume?.name || '',
    email: resume?.email || '',
    phone: resume?.phone || '',
    location: resume?.location || '',
    address_line1: resume?.address_line1 || '',
    city: resume?.city || '',
    state_region: resume?.state_region || '',
    postal_code: resume?.postal_code || '',
    linkedin: resume?.linkedin || '',
    github: resume?.github || '',
    portfolio: resume?.portfolio || '',
    current_company: resume?.current_company || currentExperience.company || '',
    current_title: resume?.current_title || currentExperience.title || '',
    years_of_experience: resume?.years_of_experience ? String(resume.years_of_experience) : '',
    pronouns: resume?.pronouns || '',
    why_company_default: resume?.why_company_default || '',
    why_role_default: resume?.why_role_default || '',
    additional_info_default: resume?.additional_info_default || '',
    start_date: resume?.start_date || '',
    availability: resume?.availability || '',
    requires_sponsorship: resume?.requires_sponsorship || '',
    work_authorization: settings.work_authorization || '',
  };
  // Only surface sensitive fields if opted in
  if (resume?.sensitive_optin) {
    base.sensitive_optin = true;
    base.gender = resume.gender || '';
    base.race = resume.race || '';
    base.veteran = resume.veteran || '';
    base.disability = resume.disability || '';
    base.pronouns_sensitive = resume.pronouns_sensitive || '';
  } else {
    base.sensitive_optin = false;
    base.gender = '';
    base.race = '';
    base.veteran = '';
    base.disability = '';
    base.pronouns_sensitive = '';
  }
  return base;
}

function getProfileCompleteness(profile = {}) {
  const requiredKeys = ['full_name', 'email', 'phone', 'location', 'linkedin', 'current_company', 'current_title', 'work_authorization'];
  const completed = requiredKeys.filter((key) => String(profile[key] || '').trim()).length;
  return { completed, total: requiredKeys.length };
}

function buildDeterministicAnswers({ resume, settings, customQuestions = [], learnedDefaults = {} }) {
  const profile = getProfileFromResume(resume, settings);
  const fullName = profile.full_name;
  const salaryMin = settings.preferred_salary_min ? String(settings.preferred_salary_min) : '';
  const salaryMax = settings.preferred_salary_max ? String(settings.preferred_salary_max) : '';
  const safeLearnedDefaults = Object.fromEntries(
    Object.entries(learnedDefaults || {}).filter(([label, value]) => shouldPersistLearnedValue(label, value))
  );

  const baseAnswers = {
    first_name: fullName.split(' ')[0] || '',
    last_name: fullName.split(' ').slice(1).join(' ') || '',
    full_name: fullName,
    name: fullName,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    address: profile.address_line1,
    address_line1: profile.address_line1,
    city: profile.city,
    state: profile.state_region,
    state_region: profile.state_region,
    zip: profile.postal_code,
    postal_code: profile.postal_code,
    linkedin: profile.linkedin,
    github: profile.github,
    portfolio: profile.portfolio,
    current_company: profile.current_company,
    current_title: profile.current_title,
    years_of_experience: profile.years_of_experience || '',
    pronouns: profile.pronouns,
    // Only include sensitive fields if opted in
    ...(profile.sensitive_optin ? {
      gender: profile.gender,
      race: profile.race,
      veteran: profile.veteran,
      disability: profile.disability,
      pronouns_sensitive: profile.pronouns_sensitive,
    } : {}),
    work_authorization: settings.work_authorization || '',
    preferred_location: profile.location,
    salary_expectation: [salaryMin, salaryMax].filter(Boolean).join(' - '),
    desired_salary_min: salaryMin,
    desired_salary_max: salaryMax,
    remote_preference: settings.preferred_remote ? 'Remote' : '',
    start_date: profile.start_date || '',
    availability: profile.availability || profile.start_date || '',
    why_company: profile.why_company_default || '',
    why_role: profile.why_role_default || '',
    additional_information: profile.additional_info_default || '',
    accommodations: profile.additional_info_default || '',
    sponsorship: profile.requires_sponsorship || '',
    requires_sponsorship: profile.requires_sponsorship || '',
  };

  return {
    ...baseAnswers,
    ...safeLearnedDefaults,
    custom_answers: buildDefaultCustomAnswers(customQuestions, baseAnswers, safeLearnedDefaults),
  };
}

function buildDefaultCustomAnswers(customQuestions = [], baseAnswers = {}, learnedDefaults = {}) {
  const customAnswers = {};

  for (const question of customQuestions) {
    const text = String(question || '').trim();
    const lower = text.toLowerCase();
    let answer = findLearnedAnswer(text, learnedDefaults);

    if (answer) {
      customAnswers[text] = answer;
      continue;
    }

    if (/legally authorized|authorized to work|eligible to work|work authorization/.test(lower)) {
      answer = wantsBinaryAnswer(lower) ? 'Yes' : baseAnswers.work_authorization;
    } else if (/sponsorship|sponsor|visa transfer|relocation assistance/.test(lower)) {
      const needsSponsorship = /^yes$/i.test(baseAnswers.requires_sponsorship || '');
      answer = wantsBinaryAnswer(lower) ? (needsSponsorship ? 'Yes' : 'No') : (baseAnswers.requires_sponsorship || 'No');
    } else if (/beginning of .*salary|salary range.*beginning|minimum salary/.test(lower)) {
      answer = baseAnswers.desired_salary_min;
    } else if (/end of .*salary|salary range.*end|maximum salary/.test(lower)) {
      answer = baseAnswers.desired_salary_max;
    } else if (/salary|compensation|annual base/.test(lower)) {
      answer = baseAnswers.salary_expectation;
    } else if (/why .*company|what makes you excited|why 1password|why do you want to work/.test(lower)) {
      answer = baseAnswers.why_company;
    } else if (/why .*role|good fit|why this role|strong candidate/.test(lower)) {
      answer = baseAnswers.why_role;
    } else if (/years? of (professional )?experience|how many years/.test(lower)) {
      answer = baseAnswers.years_of_experience;
    } else if (/gender|gender identity|sex at birth/.test(lower)) {
      answer = baseAnswers.gender || '';
    } else if (/race|ethnicity|ethnic background/.test(lower)) {
      answer = baseAnswers.race || '';
    } else if (/veteran|protected veteran|military service/.test(lower)) {
      answer = baseAnswers.veteran || '';
    } else if (/disability|disability status/.test(lower)) {
      answer = baseAnswers.disability || '';
    } else if (/cybersecurity saas/.test(lower)) {
      answer = wantsBinaryAnswer(lower) ? 'Yes' : baseAnswers.why_role;
    } else if (/size of company|most recently worked for/.test(lower)) {
      answer = '101-999';
    } else if (/what brought you to this job posting|how did you hear/.test(lower)) {
      answer = 'Company careers page';
    } else if (/current job title|job title/.test(lower)) {
      answer = baseAnswers.current_title;
    } else if (/current company|current employer|most recently/.test(lower)) {
      answer = baseAnswers.current_company;
    } else if (/when can you start|start date/.test(lower)) {
      answer = baseAnswers.start_date || baseAnswers.availability;
    } else if (/availability|notice period/.test(lower)) {
      answer = baseAnswers.availability || baseAnswers.start_date;
    } else if (/pronouns/.test(lower)) {
      answer = baseAnswers.pronouns;
    } else if (/additional information|accommodations/.test(lower)) {
      answer = baseAnswers.additional_information;
    } else if (/background check|recruiting privacy|i understand|i agree/.test(lower)) {
      answer = wantsBinaryAnswer(lower) ? 'Yes' : 'I understand';
    }

    if (answer) {
      customAnswers[text] = answer;
    }
  }

  return customAnswers;
}

function sanitizeResumeForAi(resume = {}) {
  const safeResume = { ...(resume || {}) };
  delete safeResume.sensitive_optin;
  delete safeResume.gender;
  delete safeResume.race;
  delete safeResume.veteran;
  delete safeResume.disability;
  delete safeResume.pronouns_sensitive;
  return safeResume;
}

async function getGeminiApiKey() {
  const data = await chrome.storage.local.get('settings');
  const settings = data.settings || {};
  return settings.gemini_api_key || null;
}

// ── Interview Prep Handlers ──────────────────────────────────────────────────

// ── Interview Prep Handlers ──────────────────────────────────────────────────

async function handleGetInterviewPrep(payload) {
  const { applicationId } = payload || {};
  if (!applicationId) throw new Error('applicationId required');

  const data = await chrome.storage.local.get(`interview_prep_${applicationId}`);
  return { success: true, data: data[`interview_prep_${applicationId}`] || { questions: [] } };
}

async function handleSaveInterviewPrep(payload) {
  const { applicationId, questions } = payload || {};
  if (!applicationId) throw new Error('applicationId required');
  if (!Array.isArray(questions)) throw new Error('questions must be an array');

  await chrome.storage.local.set({
    [`interview_prep_${applicationId}`]: { questions, updatedAt: Date.now() },
  });
  return { success: true };
}

async function handleGenerateInterviewQuestions(payload) {
  const { job, profile, resume } = payload || {};
  if (!job) throw new Error('job context required');

  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Gemini API key not configured. Add it in AI settings.');

  const prompt = buildInterviewQuestionsPrompt(job, profile, resume);
  const response = await callGeminiWithRetry(apiKey, prompt);
  const questions = parseInterviewQuestionsResponse(response);

  return { success: true, questions };
}

async function handleGenerateInterviewAnswer(payload) {
  const { question, type, profile, resume, job } = payload || {};
  if (!question) throw new Error('question required');

  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Gemini API key not configured. Add it in AI settings.');

  const prompt = buildInterviewAnswerPrompt(question, type, profile, resume, job);
  const response = await callGeminiWithRetry(apiKey, prompt);
  const suggestion = parseInterviewAnswerResponse(response);

  return { success: true, suggestion };
}

// ── Interview Prep Prompt Builders ────────────────────────────────────────────

function buildInterviewQuestionsPrompt(job, profile, resume) {
  const profileSummary = buildProfileSummary(profile, resume);

  return `You are an expert career coach helping a candidate prepare for a job interview.

JOB DETAILS:
Company: ${job.company || 'Unknown'}
Title: ${job.title || 'Unknown'}
Location: ${job.location || 'Not specified'}
Employment Type: ${job.employment_type || 'Not specified'}
Remote: ${job.remote ? 'Yes' : 'No'}
Description: ${job.description || job.jd_snippet || 'Not provided'}

CANDIDATE PROFILE:
${profileSummary}

Generate 8-10 likely interview questions tailored to this specific role and company. Include a mix of:
- Behavioral questions (STAR format)
- Technical/role-specific questions
- Situational/hypothetical questions
- Questions about motivation and cultural fit

For each question, provide:
1. The question text
2. The question type (behavioral, technical, situational, motivation)
3. A brief hint about what the interviewer is looking for

Return as JSON array:
[
  {"question": "...", "type": "behavioral", "hint": "..."},
  ...
]`;
}

function buildInterviewAnswerPrompt(question, type, profile, resume, job) {
  const profileSummary = buildProfileSummary(profile, resume);
  const jobSummary = buildJobSummary(job);

  return `You are an expert career coach helping a candidate draft an interview answer.

QUESTION: "${question}"
QUESTION TYPE: ${type || 'general'}

JOB CONTEXT:
${jobSummary}

CANDIDATE PROFILE:
${profileSummary}

Draft a strong answer using the STAR method (Situation, Task, Action, Result) where applicable.
Focus on specific, measurable achievements from the candidate's background.
Keep it concise (2-3 paragraphs max) and conversational.
Do NOT invent false experience - only use what's in the profile.
If the profile lacks relevant experience, suggest how to frame transferable skills.

Return ONLY the suggested answer text, no JSON, no extra commentary.`;
}

function buildProfileSummary(profile, resume) {
  const parts = [];

  if (profile) {
    if (profile.current_title) parts.push(`Current Title: ${profile.current_title}`);
    if (profile.current_company) parts.push(`Current Company: ${profile.current_company}`);
    if (profile.years_of_experience) parts.push(`Years of Experience: ${profile.years_of_experience}`);
    if (profile.skills?.length) parts.push(`Skills: ${profile.skills.join(', ')}`);
  }

  if (resume?.experience?.length) {
    parts.push('Experience:');
    for (const exp of resume.experience.slice(0, 3)) {
      const title = exp.title || '';
      const company = exp.company || '';
      const start = exp.start || '';
      const end = exp.end || 'Present';
      const desc = exp.description?.slice(0, 200) || '';
      parts.push(`  - ${title} at ${company} (${start} – ${end}): ${desc}`);
    }
  }

  if (resume?.skills?.length) {
    parts.push(`Key Skills: ${resume.skills.slice(0, 15).join(', ')}`);
  }

  return parts.length ? parts.join('\n') : 'Profile not fully configured.';
}

function buildJobSummary(job) {
  if (!job) return 'Not specified';
  const parts = [];
  if (job.company) parts.push(`Company: ${job.company}`);
  if (job.title) parts.push(`Role: ${job.title}`);
  const jd = (job.description || job.jd_snippet || 'Not specified').slice(0, 500);
  parts.push(`JD: ${jd}`);
  if (job.employment_type) parts.push(`Type: ${job.employment_type}`);
  if (job.remote) parts.push('Remote: Yes');
  return parts.join('\n');
}

// ── Interview Response Parsing ────────────────────────────────────────────────

function parseInterviewQuestionsResponse(response) {
  // 1. Try raw JSON
  try {
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}

  // 2. Try fenced JSON
  try {
    const fencedMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (fencedMatch) {
      const parsed = JSON.parse(fencedMatch[1]);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}

  // 3. Try bracketed array
  try {
    const bracketMatch = response.match(/\[[\s\S]*\]/);
    if (bracketMatch) {
      const parsed = JSON.parse(bracketMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}

  // 4. Last resort: fallback or throw
  const fallback = parseQuestionsFallback(response);
  if (Array.isArray(fallback) && fallback.length > 0) return fallback;

  throw new Error('Could not parse interview questions from AI response.');
}

function parseQuestionsFallback(text) {
  const questions = [];
  const lines = text.split('\n').filter(l => l.trim());
  let current = {};

  for (const line of lines) {
    if (/^\d+\./.test(line.trim())) {
      if (current.question) questions.push(current);
      current = { question: line.replace(/^\d+\.\s*/, '').trim(), type: 'general' };
    } else if (/type:/i.test(line)) {
      current.type = line.split(':')[1]?.trim() || 'general';
    } else if (/hint:/i.test(line)) {
      current.hint = line.split(':')[1]?.trim();
    }
  }
  if (current.question) questions.push(current);
  return questions.slice(0, 10);
}

function parseInterviewAnswerResponse(response) {
  const trimmed = response.trim();
  if (!trimmed) throw new Error('Empty AI response.');
  return trimmed;
}
