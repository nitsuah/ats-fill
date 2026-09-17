// forms.js
// Handles all form reading, writing, validation, and resume attachment logic

import { $ } from '../../lib/utils.js';

const KNOWN_START_DATES = ['Immediately', '2 weeks', '2–4 weeks', '1 month', '2 months', '3+ months'];

function readStartDate() {
  const sel = $('default-start-date')?.value || '';
  if (sel === 'Other') return $('default-start-date-other')?.value.trim() || '';
  return sel;
}

/** Update the demographic "bubble" chips to show each field's current value. */
export function syncDemoChips() {
  document.querySelectorAll('.demo-chip').forEach((chip) => {
    const target = document.getElementById(chip.dataset.demoFor);
    const value = String(target?.value || '').trim();
    const valueEl = chip.querySelector('.demo-chip-value');
    if (valueEl) {
      valueEl.textContent = value || 'Not set';
      valueEl.dataset.empty = value ? 'false' : 'true';
    }
  });
}

/** Reflect a stored start-date value onto the dropdown (+ Other freeform). */
export function applyStartDateValue(value = '') {
  const startVal = String(value || '').trim();
  const select = $('default-start-date');
  const wrap = $('start-date-other-wrap');
  const other = $('default-start-date-other');
  const isKnown = !startVal || KNOWN_START_DATES.includes(startVal);
  if (select) select.value = startVal && isKnown ? startVal : (startVal ? 'Other' : '');
  if (other) other.value = isKnown ? '' : startVal;
  if (wrap) wrap.classList.toggle('hidden', select?.value !== 'Other');
}

/**
 * Read settings form values (API key, privacy, etc)
 *
 * Consent timestamp handling: the checkbox alone can't distinguish "signing
 * consent for the first time" from "already consented, just saving other
 * profile edits." `applyStateToSetupForm` stamps the checkbox with the
 * previously-recorded consent state via `data-original-*` attributes when it
 * hydrates the form; we reuse that original timestamp here whenever consent
 * was already accepted, and only mint a new one on a genuine first-time
 * accept. Without this, every unrelated "Save Profile" click would silently
 * overwrite the user's original consent date.
 */
export function readSettingsForm() {
  const consentEl = $('privacy-consent');
  const consentChecked = consentEl?.checked === true;
  const hadPriorConsent = consentEl?.dataset.originalConsent === 'true';
  const priorConsentAt = consentEl?.dataset.originalConsentAt || '';
  const consentAt = consentChecked
    ? ((hadPriorConsent && priorConsentAt) ? priorConsentAt : new Date().toISOString())
    : null;

  return {
    gemini_api_key: $('api-key-input')?.value.trim() || '',
    gemini_model: $('gemini-model')?.value || 'auto',
    preferred_salary_min: Number($('salary-min')?.value) || null,
    preferred_salary_max: Number($('salary-max')?.value) || null,
    work_authorization: $('work-auth')?.value || null,
    preferred_remote: $('prefer-remote')?.checked,
    adzuna_app_id: $('adzuna-app-id')?.value.trim() || '',
    adzuna_app_key: $('adzuna-app-key')?.value.trim() || '',
    adzuna_country: $('adzuna-country')?.value || 'us',
    usajobs_email: $('usajobs-email')?.value.trim() || '',
    usajobs_api_key: $('usajobs-api-key')?.value.trim() || '',
    linkedin_client_id: $('linkedin-client-id')?.value.trim() || '',
    linkedin_client_secret: $('linkedin-client-secret')?.value.trim() || '',
    privacy_consent: consentChecked,
    privacy_consent_at: consentAt,
  };
}

/**
 * Read profile form values — all 25+ fields matching the original
 */
export function readProfileForm() {
  const sensitiveOptin = $('sensitive-optin')?.checked;
  return {
    full_name: $('profile-full-name')?.value.trim() || '',
    email: $('profile-email')?.value.trim() || '',
    phone: $('profile-phone')?.value.trim() || '',
    location: $('profile-location')?.value.trim() || '',
    address_line1: $('profile-address-line1')?.value.trim() || '',
    city: $('profile-city')?.value.trim() || '',
    state_region: $('profile-state-region')?.value.trim() || '',
    postal_code: $('profile-postal-code')?.value.trim() || '',
    linkedin: $('profile-linkedin')?.value.trim() || '',
    github: $('profile-github')?.value.trim() || '',
    portfolio: $('profile-portfolio')?.value.trim() || '',
    current_company: $('profile-current-company')?.value.trim() || '',
    current_title: $('profile-current-title')?.value.trim() || '',
    years_of_experience: $('profile-years-of-experience')?.value.trim() || '',
    pronouns: $('profile-pronouns')?.value.trim() || '',
    why_company_default: $('default-why-company')?.value.trim() || '',
    why_role_default: $('default-why-role')?.value.trim() || '',
    additional_info_default: $('default-additional-info')?.value.trim() || '',
    start_date: readStartDate(),
    availability: $('default-availability')?.value.trim() || '',
    requires_sponsorship: $('default-sponsorship')?.value || '',
    sensitive_optin: sensitiveOptin,
    gender: sensitiveOptin ? ($('profile-gender')?.value || '') : '',
    race: sensitiveOptin ? ($('profile-race')?.value || '') : '',
    veteran: sensitiveOptin ? ($('profile-veteran')?.value || '') : '',
    disability: sensitiveOptin ? ($('profile-disability')?.value || '') : '',
    pronouns_sensitive: sensitiveOptin ? ($('profile-pronouns-sensitive')?.value.trim() || '') : '',
  };
}

/**
 * Fill profile form from profile object — all 25+ fields
 */
export function fillProfileForm(profile = {}) {
  const set = (id, val) => { const el = $(id); if (el) el.value = val; };

  set('profile-full-name', profile.full_name || profile.name || '');
  set('profile-email', profile.email || '');
  set('profile-phone', profile.phone || '');
  set('profile-location', profile.location || '');
  set('profile-address-line1', profile.address_line1 || '');
  set('profile-city', profile.city || '');
  set('profile-state-region', profile.state_region || profile.state || '');
  set('profile-postal-code', profile.postal_code || profile.zip || '');
  set('profile-linkedin', profile.linkedin || '');
  set('profile-github', profile.github || '');
  set('profile-portfolio', profile.portfolio || '');
  set('profile-current-company', profile.current_company || '');
  set('profile-current-title', profile.current_title || '');
  set('profile-years-of-experience', profile.years_of_experience || '');
  set('profile-pronouns', profile.pronouns || '');
  set('default-why-company', profile.why_company_default || '');
  set('default-why-role', profile.why_role_default || '');
  set('default-additional-info', profile.additional_info_default || '');
  applyStartDateValue(profile.start_date || '');
  set('default-availability', profile.availability || '');
  set('default-sponsorship', profile.requires_sponsorship || '');

  const sensitiveEnabled = !!profile.sensitive_optin;
  const sensitiveOptin = $('sensitive-optin');
  if (sensitiveOptin) sensitiveOptin.checked = sensitiveEnabled;
  $('sensitive-fields')?.classList.toggle('hidden', !sensitiveEnabled);
  set('profile-gender', sensitiveEnabled ? (profile.gender || '') : '');
  set('profile-race', sensitiveEnabled ? (profile.race || '') : '');
  set('profile-veteran', sensitiveEnabled ? (profile.veteran || '') : '');
  set('profile-disability', sensitiveEnabled ? (profile.disability || '') : '');
  set('profile-pronouns-sensitive', sensitiveEnabled ? (profile.pronouns_sensitive || '') : '');
  syncDemoChips();
}

/**
 * Check if any meaningful profile value is set
 */
export function hasAnyProfileValue(profile = {}) {
  return Object.entries(profile).some(([key, value]) => key !== 'sensitive_optin' && String(value || '').trim());
}

/**
 * Read a File object as plain text or, for binary formats (PDF/DOCX), as a
 * base64 data URL for Gemini to parse. Legacy .doc files are rejected.
 */
export async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const isPdf = file.type === 'application/pdf';
    const lowerName = file.name.toLowerCase();
    const isDocx = lowerName.endsWith('.docx');
    const isPdfByExt = !isPdf && lowerName.endsWith('.pdf');

    if (isPdf || isPdfByExt || isDocx) {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    } else if (lowerName.endsWith('.doc')) {
      reject(new Error('Legacy .doc files are not supported. Please upload a PDF or DOCX file.'));
    } else {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    }
  });
}

/**
 * Resume file drop handler — returns { content, name } or { error }
 */
export async function handleResumeFileDrop(file) {
  if (!file) return { error: 'No file' };
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'doc') return { error: 'Legacy .doc files are not supported. Please upload a PDF or DOCX file.' };
  try {
    const content = await readFileAsText(file);
    return { content, name: file.name };
  } catch (err) {
    return { error: err.message || 'Could not read the file.' };
  }
}

export function removeResumeAttachment() {
  const dropLabel = $('file-drop-label');
  if (dropLabel) dropLabel.textContent = '📄 Drop PDF / DOCX / TXT here or click to browse';
}

export function downloadResumeAttachment(attachment = {}) {
  const fileName = attachment.fileName || attachment.name || 'resume-preview.txt';
  let href = '';

  if (attachment.downloadMode === 'data-url' && attachment.data) {
    href = attachment.data;
  } else {
    const text = String(attachment.text || attachment.preview || '').trim();
    if (!text) {
      throw new Error('No saved resume preview is available to download yet.');
    }
    const blob = new Blob([text], { type: attachment.mimeType || 'text/plain;charset=utf-8' });
    href = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Render the resume attachment card UI.
 */
export function renderResumeAttachment(attachment) {
  const card = $('resume-attachment-card');
  if (!card) return;

  if (!attachment || !attachment.preview) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  const nameEl = $('resume-attachment-name');
  if (nameEl) nameEl.textContent = attachment.name || attachment.fileName || 'resume-preview.txt';
  const metaEl = $('resume-attachment-meta');
  if (metaEl) {
    const sourceLabel = attachment.source === 'paste' ? 'Pasted text' : attachment.source === 'upload' ? 'Uploaded file' : 'Saved preview';
    metaEl.textContent = `${sourceLabel} — stored locally only for this browser profile.`;
  }
  const previewEl = $('resume-attachment-preview');
  if (previewEl) previewEl.textContent = String(attachment.preview || '').slice(0, 2000);
}

// ── Tracker draft form helpers ──────────────────────────────────────────────

export function fillTrackerDraftForm(draft = {}) {
  const set = (id, val) => { const el = $(id); if (el) el.value = val; };
  set('new-application-company', draft.company || '');
  set('new-application-title', draft.title || '');
  set('new-application-url', draft.url || '');
  set('new-application-status', draft.status || 'drafted');
  set('new-application-location', draft.location || '');
  set('new-application-employment-type', draft.employment_type || 'Full-time');
  const remoteEl = $('new-application-remote');
  if (remoteEl) remoteEl.checked = !!draft.remote;
  set('new-application-salary-range', draft.salary_range || '');
  set('new-application-description', draft.description || draft.jd || '');
}

export function readTrackerDraftForm() {
  return {
    company: $('new-application-company')?.value.trim() || '',
    title: $('new-application-title')?.value.trim() || '',
    url: $('new-application-url')?.value.trim() || '',
    status: $('new-application-status')?.value || 'drafted',
    location: $('new-application-location')?.value.trim() || '',
    employment_type: $('new-application-employment-type')?.value || 'Full-time',
    remote: $('new-application-remote')?.checked || false,
    salary_range: $('new-application-salary-range')?.value.trim() || '',
    description: $('new-application-description')?.value.trim() || '',
  };
}

export function resetTrackerDraftForm() {
  const set = (id, val) => { const el = $(id); if (el) el.value = val; };
  set('new-application-company', '');
  set('new-application-title', '');
  set('new-application-url', '');
  set('new-application-status', 'drafted');
  set('new-application-location', '');
  set('new-application-employment-type', 'Full-time');
  const remoteEl = $('new-application-remote');
  if (remoteEl) remoteEl.checked = false;
  set('new-application-salary-range', '');
  set('new-application-description', '');
}
