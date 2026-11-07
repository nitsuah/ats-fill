import { parseResumeWithGemini } from '../../../lib/gemini.js';
import { structureResume } from '../../../lib/resume-parser.js';
import {
  MAX_RESUME_EXCERPT_LENGTH,
  sanitizeResumeAttachment,
  mergeStructuredResume,
  hasAnyProfileData,
  buildResumePreviewText,
  buildResumeAttachment,
  getResumeAttachmentSummary,
  applyProfileOverrides,
} from '../helpers.js';

/** @param {{ settings?: object }} payload */
export async function handleSaveSettingsOnly({ settings } = {}) {
  if (!settings) throw new Error('No settings provided.');
  const data = await chrome.storage.local.get('settings');
  const existing = data.settings || {};
  // Merge, preserving privacy_consent from the existing record so the AI panel
  // (which doesn't render the consent checkbox) can't inadvertently clear it.
  const next = {
    ...existing,
    ...settings,
    privacy_consent: existing.privacy_consent === true,
    privacy_consent_at: existing.privacy_consent_at || null,
  };
  await chrome.storage.local.set({ settings: next });
  return { success: true };
}

/** @param {{ resumeRaw?: string, settings?: object, profile?: object, resumeMeta?: object }} payload */
export async function handleSaveSetup({ resumeRaw, settings, profile = {}, resumeMeta }) {
  const data = await chrome.storage.local.get(['resume', 'settings']);
  const existingResume = data.resume?.structured || null;
  const existingAttachment = sanitizeResumeAttachment(data.resume?.attachment || null);
  const hasNewResume = typeof resumeRaw === 'string' && resumeRaw.trim() !== '';
  // Merge over the stored settings so values this form does not carry
  // (custom job sources, the local-network feed setting) are kept. A field the
  // form sends empty still overwrites the stored value.
  const nextSettings = {
    ...(data.settings || {}),
    ...(settings || {}),
    privacy_consent: settings?.privacy_consent === true,
    privacy_consent_at: settings?.privacy_consent
      ? (settings?.privacy_consent_at || new Date().toISOString())
      : null,
  };

  if (!nextSettings.privacy_consent) {
    throw new Error('Please review and accept the privacy note before saving your setup.');
  }

  // Save settings first
  await chrome.storage.local.set({ settings: nextSettings });

  let structured = existingResume ? structureResume(existingResume) : null;

  if (hasNewResume) {
    if (!nextSettings.gemini_api_key) {
      throw new Error('Add a Gemini API key to parse a new resume upload, or save your core profile without parsing.');
    }
    const parsedResume = await parseResumeWithGemini(resumeRaw, nextSettings.gemini_api_key, nextSettings.gemini_model);
    const parsedStructured = structureResume(parsedResume);
    structured = structured
      ? mergeStructuredResume(structured, parsedStructured)
      : parsedStructured;
  }

  if (!structured && hasAnyProfileData(profile)) {
    structured = structureResume({});
  }

  if (!structured) {
    return {
      success: true,
      resume: null,
      settingsSavedOnly: true,
      resumeAttachment: getResumeAttachmentSummary(data.resume || {}),
    };
  }

  // Only persist sensitive fields if opted in
  const safeProfile = { ...profile };
  if (!profile.sensitive_optin) {
    safeProfile.gender = '';
    safeProfile.race = '';
    safeProfile.veteran = '';
    safeProfile.disability = '';
    safeProfile.pronouns_sensitive = '';
  }
  structured = applyProfileOverrides(structured, safeProfile, nextSettings);

  const shouldPersistResumePreview = hasNewResume || data.resume?.attachmentRemoved !== true;
  const resumePreviewText = shouldPersistResumePreview
    ? (
        hasNewResume
          ? buildResumePreviewText({
              resumeRaw,
              structured,
              fallbackPreview: data.resume?.excerpt || '',
            })
          : buildResumePreviewText({
              structured,
              fallbackPreview: data.resume?.excerpt || '',
            })
      )
    : '';

  const resumeExcerpt = resumePreviewText
    ? resumePreviewText.slice(0, MAX_RESUME_EXCERPT_LENGTH)
    : null;
  const nextAttachment = hasNewResume
    ? buildResumeAttachment({
        resumeRaw,
        resumeMeta,
        structured,
        previewText: resumePreviewText,
      })
    : existingAttachment;

  await chrome.storage.local.set({
    resume: {
      structured,
      excerpt: resumeExcerpt,
      attachment: nextAttachment,
      attachmentRemoved: hasNewResume ? false : data.resume?.attachmentRemoved === true,
    },
  });

  return {
    success: true,
    resume: structured,
    resumeAttachment: getResumeAttachmentSummary({
      structured,
      excerpt: resumeExcerpt,
      attachment: nextAttachment,
      attachmentRemoved: hasNewResume ? false : data.resume?.attachmentRemoved === true,
    }),
  };
}
