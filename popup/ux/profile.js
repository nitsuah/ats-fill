// profile.js
// All profile/setup logic, rendering, and state management

import { $, sendMessage, formatSavedTimestamp, getResumeAttachmentSourceLabel } from '../../lib/utils.js';
import { setStatus, setResumeDropLabel } from './state.js';
import { syncConsentGate } from './consent.js';
import {
  readSettingsForm,
  readProfileForm,
  fillProfileForm,
  readFileAsText,
  handleResumeFileDrop,
  downloadResumeAttachment,
  renderResumeAttachment,
  syncDemoChips,
} from '../forms/forms.js';
import { renderCustomJobSourcesList, syncSettingsCardsFromState } from '../ai/ai.js';

// Re-export for consumers
export { readSettingsForm };

/**
 * Apply full state to the setup form — settings, profile, resume, consent.
 */
export function applyStateToSetupForm(state = {}) {
  const set = (id, val) => { const el = $(id); if (el) el.value = val; };

  set('api-key-input', state.apiKey || '');

  const modelSelect = $('gemini-model');
  if (modelSelect) {
    const savedModel = state.geminiModel || 'auto';
    const hasSavedOption = Array.from(modelSelect.options).some((opt) => opt.value === savedModel);
    modelSelect.value = hasSavedOption ? savedModel : 'auto';
  }

  const settings = state.settings || {};
  set('salary-min', settings.preferred_salary_min ?? '');
  set('salary-max', settings.preferred_salary_max ?? '');
  set('work-auth', settings.work_authorization || '');
  const preferRemote = $('prefer-remote');
  if (preferRemote) preferRemote.checked = settings.preferred_remote !== false;
  set('adzuna-app-id', settings.adzuna_app_id || '');
  set('adzuna-app-key', settings.adzuna_app_key || '');
  if ($('adzuna-country')) $('adzuna-country').value = settings.adzuna_country || 'us';
  set('usajobs-email', settings.usajobs_email || '');
  set('usajobs-api-key', settings.usajobs_api_key || '');
  set('reed-api-key', settings.reed_api_key || '');
  set('jooble-api-key', settings.jooble_api_key || '');
  set('linkedin-client-id', settings.linkedin_client_id || '');
  set('linkedin-client-secret', settings.linkedin_client_secret || '');
  set('google-client-id', settings.google_client_id || '');
  set('google-client-secret', settings.google_client_secret || '');
  renderCustomJobSourcesList(settings.custom_job_sources || []);
  syncSettingsCardsFromState(settings, !!state.hasApiKey);
  const privacyConsent = $('privacy-consent');
  if (privacyConsent) {
    privacyConsent.checked = settings.privacy_consent === true;
    // Remember the consent state/timestamp as loaded from storage so
    // readSettingsForm() can tell a first-time accept from re-saving an
    // already-consented profile — see the comment there for why this matters.
    privacyConsent.dataset.originalConsent = settings.privacy_consent === true ? 'true' : 'false';
    privacyConsent.dataset.originalConsentAt = settings.privacy_consent_at || '';
  }

  syncConsentGate();
  renderResumeAttachment(state.resumeAttachment || null);
  fillProfileForm(state.profile || {});
}

/**
 * Save the full profile + settings + resume.
 */
export async function handleSaveSetup() {
  const settings = readSettingsForm();
  const profile = readProfileForm();

  if (!settings.privacy_consent) {
    throw new Error('You must accept the privacy policy to save your profile.');
  }

  // Handle resume file if present
  const fileInput = $('resume-file');
  let resumeRaw = '';
  let resumeMeta = null;
  if (fileInput && fileInput.files && fileInput.files[0]) {
    try {
      resumeRaw = await readFileAsText(fileInput.files[0]);
      resumeMeta = { name: fileInput.files[0].name };
    } catch (err) {
      throw new Error(err.message || 'Could not read the resume file.');
    }
  }

  // Handle resume paste text
  const resumeText = $('resume-text')?.value?.trim() || '';
  if (!resumeRaw && resumeText) {
    resumeRaw = resumeText;
    resumeMeta = { name: 'pasted-resume.txt', source: 'paste' };
  }

  const resp = await sendMessage({
    type: 'SAVE_SETUP',
    payload: {
      settings,
      profile,
      resumeRaw,
      resumeMeta,
    },
    }, { timeout: 120_000 });
  if (!resp?.success) throw new Error(resp?.error || 'Failed to save profile.');
  return resp;
}

async function saveSetupFlow({ requireResume = false } = {}) {
  const fileInput = $('resume-file');
  const resumeText = $('resume-text')?.value?.trim() || '';
  const hasResumeInput = !!(resumeText || fileInput?.files?.[0]);

  if (requireResume && !hasResumeInput) {
    throw new Error('Add a resume file or pasted resume text before parsing.');
  }

  const result = await handleSaveSetup();
  // Refresh the form from saved state. If this fails, don't mask the save
  // success — the profile was already persisted.
  try {
    const state = await sendMessage({ type: 'GET_STATE' });
    applyStateToSetupForm(state || {});
  } catch {
    // Non-fatal: the save already succeeded.
  }
  return result;
}

/**
 * Initialize all setup screen event handlers.
 */
export async function initSetupHandlers() {
  // File drop/change
  const fileInput = $('resume-file');
  const dropZone = $('file-drop-zone');

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      setResumeDropLabel(fileInput.files[0]?.name || '');
    });
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer?.files[0];
      if (file && fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        setResumeDropLabel(file.name);
      }
    });
  }

  $('privacy-consent')?.addEventListener('change', () => {
    syncConsentGate();
    if ($('privacy-consent').checked) {
      setStatus('setup-status', '✅ Privacy accepted. Profile and Settings are now unlocked.', 'success');
    }
  });

  // Reveal the custom start-date field only when "Other" is selected.
  $('default-start-date')?.addEventListener('change', (event) => {
    $('start-date-other-wrap')?.classList.toggle('hidden', event.target.value !== 'Other');
  });

  // Collapse / expand the saved resume preview (expanded by default — full copy
  // without a scroll box).
  $('toggle-resume-preview-btn')?.addEventListener('click', (event) => {
    const preview = $('resume-attachment-preview');
    if (!preview) return;
    const collapsed = preview.classList.toggle('collapsed');
    event.currentTarget.textContent = collapsed ? '⤢ Expand' : '⤡ Collapse';
  });

  const sensitiveOptin = $('sensitive-optin');
  const sensitiveFields = $('sensitive-fields');
  if (sensitiveOptin && sensitiveFields) {
    const syncSensitiveVisibility = () => {
      sensitiveFields.classList.toggle('hidden', !sensitiveOptin.checked);
    };
    sensitiveOptin.addEventListener('change', syncSensitiveVisibility);
    syncSensitiveVisibility();

    // Demographic chips: click a chip to reveal its control; collapse on
    // change / blur with the chosen value reflected back into the chip.
    sensitiveFields.addEventListener('click', (event) => {
      const chip = event.target.closest('.demo-chip');
      if (!chip) return;
      const field = $(chip.dataset.demoFor);
      if (!field) return;
      chip.classList.add('hidden');
      field.classList.remove('hidden');
      field.focus();
    });
    const collapseDemoField = (event) => {
      const field = event.target.closest('.demo-select');
      if (!field) return;
      syncDemoChips();
      field.classList.add('hidden');
      sensitiveFields.querySelector(`.demo-chip[data-demo-for="${field.id}"]`)?.classList.remove('hidden');
    };
    sensitiveFields.addEventListener('change', collapseDemoField);
    sensitiveFields.addEventListener('focusout', collapseDemoField);
  }

  $('download-resume-attachment-btn')?.addEventListener('click', async () => {
    try {
      const resp = await sendMessage({ type: 'GET_RESUME_ATTACHMENT' });
      if (!resp?.success || !resp.attachment) {
        throw new Error(resp?.error || 'No saved resume attachment is available yet.');
      }
      downloadResumeAttachment(resp.attachment);
      setStatus('setup-status', '✅ Downloaded your saved resume copy.', 'success');
    } catch (err) {
      setStatus('setup-status', '❌ ' + err.message, 'error');
    }
  });

  $('remove-resume-attachment-btn')?.addEventListener('click', async () => {
    const confirmed = confirm('Remove the saved local resume attachment preview? Your structured profile details will stay intact.');
    if (!confirmed) return;

    try {
      const resp = await sendMessage({ type: 'REMOVE_RESUME_ATTACHMENT' });
      if (!resp?.success) {
        throw new Error(resp?.error || 'Could not remove the saved attachment.');
      }
      const state = await sendMessage({ type: 'GET_STATE' });
      applyStateToSetupForm(state || {});
      setStatus('setup-status', '✅ Saved resume attachment removed.', 'success');
    } catch (err) {
      setStatus('setup-status', '❌ ' + err.message, 'error');
    }
  });

  $('save-profile-btn')?.addEventListener('click', async () => {
    try {
      await saveSetupFlow({ requireResume: false });
      setStatus('setup-status', '✅ Profile saved!', 'success');
    } catch (err) {
      setStatus('setup-status', '❌ ' + (err.message || 'Failed to save profile'), 'error');
    }
  });

  $('parse-resume-btn')?.addEventListener('click', async () => {
    const btn = $('parse-resume-btn');
    try {
      setStatus('setup-status', '⏳ Parsing resume with AI… this can take up to a minute.', 'working');
      if (btn) btn.disabled = true;
      await saveSetupFlow({ requireResume: true });
      setStatus('setup-status', '✅ Resume parsed and profile saved!', 'success');
    } catch (err) {
      setStatus('setup-status', '❌ ' + (err.message || 'Failed to save profile'), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

/**
 * Initialize tab switching (upload vs paste).
 */
export async function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  for (const btn of tabBtns) {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      tabContents.forEach((tc) => tc.classList.add('hidden'));
      const targetContent = $('tab-' + target);
      if (targetContent) targetContent.classList.remove('hidden');
    });
  }
}
