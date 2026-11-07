import { isTerminalApplicationStatus } from '../../../lib/tracker.js';
import {
  sanitizeIgnoredLearnedDefaultsMap,
  sanitizeLearnedDefaultsMap,
  trimLearnedDefaultsMap,
  trimIgnoredLearnedDefaultsMap,
  detectAtsFromUrl,
  getProfileFromResume,
  getResumeAttachmentSummary,
  getProfileCompleteness,
} from '../helpers.js';

/** @returns {Promise<object>} */
export async function getState() {
  const data = await chrome.storage.local.get([
    'resume',
    'settings',
    'applications',
    'lastAnswers',
    'lastFillReport',
    'lastTrackedApplicationId',
    'learnedDefaults',
    'ignoredLearnedDefaults',
  ]);
  const settings = data.settings || {};
  const resume = data.resume || {};
  const applications = data.applications || [];
  const lastAnswers = data.lastAnswers || null;
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  const learnedDefaults = sanitizeLearnedDefaultsMap(data.learnedDefaults || {}, ignoredLearnedDefaults);
  const trimmedLearnedDefaults = trimLearnedDefaultsMap(learnedDefaults);
  const trimmedIgnoredDefaults = trimIgnoredLearnedDefaultsMap(ignoredLearnedDefaults);
  if (
    Object.keys(trimmedLearnedDefaults).length !== Object.keys(data.learnedDefaults || {}).length ||
    Object.keys(trimmedIgnoredDefaults).length !== Object.keys(data.ignoredLearnedDefaults || {}).length
  ) {
    await chrome.storage.local.set({
      learnedDefaults: trimmedLearnedDefaults,
      ignoredLearnedDefaults: trimmedIgnoredDefaults,
    });
  }

  const lastTrackedApplicationId = data.lastTrackedApplicationId || null;
  const lastTrackedApplication = applications.find((app) => app.id === lastTrackedApplicationId) || null;
  const lastFillReport = lastTrackedApplication && !isTerminalApplicationStatus(lastTrackedApplication.status)
    ? (data.lastFillReport || null)
    : null;

  // Try to detect ATS from the active tab URL
  let currentAts = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) currentAts = detectAtsFromUrl(tab.url);
  } catch (_) {
    // Not a tab context (e.g. options page) — ignore
  }

  const profile = getProfileFromResume(resume.structured, settings);
  const resumeAttachment = getResumeAttachmentSummary(resume);

  return {
    hasApiKey: !!settings.gemini_api_key,
    hasResume: !!resume.structured,
    apiKey: settings.gemini_api_key,
    geminiModel: settings.gemini_model || null,
    resumeName: resumeAttachment?.name || resume.structured?.name || null,
    resumeAttachment,
    settings,
    privacyConsent: !!settings.privacy_consent,
    profile,
    profileCompleteness: getProfileCompleteness(profile),
    learnedDefaultsCount: Object.keys(trimmedLearnedDefaults).length,
    applications,
    lastAnswers,
    lastFillReport,
    lastTrackedApplicationId,
    currentAts,
  };
}
