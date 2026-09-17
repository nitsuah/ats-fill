// main.js
// Handles main screen state loading, rendering, and navigation orchestration

import { $, sendMessage, sendToActiveTab, getAtsMeta, setBadgeState, setStatusRowMeta } from '../../lib/utils.js';
import { normalizeApplicationStatus } from '../../lib/tracker.js';
import { setStatus } from './state.js';
import { showScreen, scrollToSection, bindReviewJumpHandlers, isStandaloneView, openExpandedWorkspace } from './navigation.js';
import { applyStateToSetupForm } from './profile.js';
import { renderLearnedDefaults } from '../forms/memory.js';
import { renderFillReport, renderPreview } from '../forms/preview.js';
import { renderTracker } from '../tracker/tracker-ui.js';

// ── Load main screen ────────────────────────────────────────────────────────

export async function loadMainScreen(options = {}) {
  const { showMain = true } = options;
  const resp = await sendMessage({ type: 'GET_STATE' });
  const {
    hasResume,
    hasApiKey,
    resumeName,
    applications,
    currentAts,
    profileCompleteness,
    privacyConsent,
    learnedDefaultsCount,
  } = resp || {};

  applyStateToSetupForm(resp || {});
  renderConsentSignedDate(resp?.settings || {}, privacyConsent);

  // Show the correct screen before awaiting renderLearnedDefaults so the popup
  // is never blank longer than the one GET_STATE round-trip.
  if (!privacyConsent || (!hasApiKey && !hasResume)) {
    showScreen('setup');
    await renderLearnedDefaults();
    if (!privacyConsent) {
      setStatus('setup-status', 'Review the privacy note once to continue using apply-bot.');
    }
    return;
  }

  if (showMain) {
    showScreen('main');
  }

  await renderLearnedDefaults();

  // Update UI badges
  const resumeTooltip = hasResume
    ? `Resume is ready (${resumeName || 'loaded'}). Click to edit Profile.`
    : 'Profile-only mode is active. Click to add or update your resume.';
  setBadgeState('resume-status', hasResume ? 'Ready' : 'Profile only', hasResume ? 'ok' : 'warn', resumeTooltip);
  setStatusRowMeta('resume-row', resumeTooltip);

  const apiTooltip = hasApiKey
    ? 'Gemini is connected for optional AI help. Click to open Settings.'
    : 'AI help is optional. Click to add or update your Gemini key in Settings.';
  setBadgeState('api-status', hasApiKey ? 'Connected' : 'Optional', hasApiKey ? 'ok' : 'info', apiTooltip);
  setStatusRowMeta('api-row', apiTooltip);

  const completeness = profileCompleteness || { completed: 0, total: 8 };
  const profileReady = completeness.completed >= Math.max(4, completeness.total - 2);
  const profileTooltip = `Your core profile is ${completeness.completed}/${completeness.total} complete. Click to review Profile.`;
  setBadgeState('profile-status', `${completeness.completed}/${completeness.total} complete`, profileReady ? 'ok' : 'warn', profileTooltip);
  setStatusRowMeta('profile-row', profileTooltip);

  const privacyTooltip = privacyConsent
    ? 'Local-first privacy is enabled. Click for EULA, privacy, and reset controls.'
    : 'Privacy review is required. Click for EULA and privacy details.';
  setBadgeState('privacy-status-badge', privacyConsent ? 'Local-first' : 'Review', privacyConsent ? 'ok' : 'warn', privacyTooltip);
  setStatusRowMeta('privacy-row', privacyTooltip);

  const memoryCount = Number(learnedDefaultsCount || 0);
  const memoryTooltip = memoryCount
    ? `${memoryCount} remembered answers are saved. Click to review Memory in Profile.`
    : 'No remembered answers yet. Click to open Memory in Profile.';
  setBadgeState('learned-status', memoryCount ? `${memoryCount} saved` : 'Empty', 'memory', memoryTooltip);
  setStatusRowMeta('learned-row', memoryTooltip);

  // ATS row — prefer live page detection (covers custom career domains where
  // the URL alone can't reveal the embedded ATS), fall back to URL heuristic.
  const detectedAts = (await detectAtsFromActiveTab()) || currentAts;
  const atsMeta = getAtsMeta(detectedAts);

  // Surface a one-click capture button only when we're on a recognizable job page.
  $('save-job-btn')?.classList.toggle('hidden', !detectedAts);
  const atsRow = $('ats-row');
  if (atsRow) atsRow.style.display = 'flex';
  setBadgeState('ats-status', atsMeta.label, atsMeta.tone, atsMeta.tip);
  setStatusRowMeta('ats-row', atsMeta.tip);
  const atsHint = $('ats-hint');
  if (atsHint) {
    atsHint.classList.toggle('hidden', !atsMeta.hint);
    atsHint.textContent = atsMeta.hint || '';
  }

  // Tracker summary in header
  const apps = applications || [];
  applyTrackerSummary(apps);

  // Fill report
  renderFillReport(resp?.lastFillReport);
}

// ── Consent "signed on" date ─────────────────────────────────────────────────

function renderConsentSignedDate(settings = {}, privacyConsent = false) {
  const el = $('consent-signed-date');
  if (!el) return;

  const signedAt = settings.privacy_consent_at;
  if (privacyConsent && signedAt) {
    const parsed = new Date(signedAt);
    const when = Number.isNaN(parsed.getTime())
      ? String(signedAt)
      : parsed.toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
    el.textContent = `✓ Consent signed on ${when}`;
    el.classList.add('is-signed');
  } else if (privacyConsent) {
    el.textContent = '✓ Consent accepted (date not recorded).';
    el.classList.add('is-signed');
  } else {
    el.textContent = 'Consent not recorded yet.';
    el.classList.remove('is-signed');
  }
}

// ── ATS detection from the live page ────────────────────────────────────────

/**
 * Ask the active tab's content script what ATS it sees on the page. Unlike
 * sendToActiveTab, this never force-injects the script — if the page has no
 * content script (not a job page) it simply resolves to null.
 */
async function detectAtsFromActiveTab() {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) return null;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const resp = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'DETECT_ATS' }, (r) => {
        void chrome.runtime.lastError; // swallow "no receiving end" on non-job pages
        resolve(r);
      });
    });
    return resp?.ats && resp.ats !== 'Generic' ? resp.ats : null;
  } catch {
    return null;
  }
}

// ── Tracker summary ─────────────────────────────────────────────────────────

function applyTrackerSummary(apps = []) {
  const total = apps.length;
  const active = apps.filter((a) => !['rejected', 'retired'].includes(normalizeApplicationStatus(a.status))).length;
  const submitted = apps.filter((a) => normalizeApplicationStatus(a.status) === 'submitted').length;

  if ($('stat-total')) $('stat-total').textContent = total;
  if ($('stat-applied')) $('stat-applied').textContent = submitted;
  if ($('stat-pending')) $('stat-pending').textContent = active;
  if ($('header-tracker-count')) {
    $('header-tracker-count').textContent = `${active} / ${total} active`;
  }
  if ($('header-tracker-btn')) {
    $('header-tracker-btn').title = `${active} of ${total} tracked applications still active. Open tracker workspace.`;
  }
}

// ── Main screen handlers ────────────────────────────────────────────────────

export async function initMainHandlers() {
  $('header-home-btn')?.addEventListener('click', async () => {
    await loadMainScreen();
  });

  $('header-tracker-btn')?.addEventListener('click', async () => {
    try {
      if (!isStandaloneView()) {
        const opened = await openExpandedWorkspace('tracker');
        if (opened) return;
      }
      await renderTracker();
    } catch (err) {
      setStatus('tracker-status', '❌ Failed to load pipeline: ' + (err?.message || err), 'error');
    } finally {
      showScreen('tracker');
    }
  });

  $('header-ai-btn')?.addEventListener('click', async () => {
    if (!isStandaloneView()) {
      const opened = await openExpandedWorkspace('ai', 'ai-settings-section');
      if (opened) return;
    }
    showScreen('ai');
    const state = await sendMessage({ type: 'GET_STATE' });
    applyStateToSetupForm(state || {});
    scrollToSection('ai-settings-section');
  });

  $('header-help-btn')?.addEventListener('click', async () => {
    if (!isStandaloneView()) {
      const opened = await openExpandedWorkspace('help');
      if (opened) return;
    }
    showScreen('help');
  });

  // Profile nav button
  $('header-profile-btn')?.addEventListener('click', async () => {
    if (!isStandaloneView()) {
      const opened = await openExpandedWorkspace('setup', 'core-profile-section');
      if (opened) return;
    }
    showScreen('setup');
    const state = await sendMessage({ type: 'GET_STATE' });
    applyStateToSetupForm(state || {});
    await renderLearnedDefaults();
  });

  // Global back button returns to home
  $('global-back-btn')?.addEventListener('click', async () => {
    await loadMainScreen();
  });

  bindReviewJumpHandlers('fill-report-unresolved', 'fill-status');

  $('fill-btn')?.addEventListener('click', async () => {
    const fillBtn = $('fill-btn');
    if (fillBtn) fillBtn.disabled = true;
    setStatus('fill-status', '⏳ Analyzing page & generating answers…');
    try {
      const resp = await sendToActiveTab({ type: 'FILL_FORM' });
      if (resp?.success) {
        const report = resp.report || {};
        const summary = [
          `${report.filled || 0} filled`,
          report.preserved ? `${report.preserved} kept` : '',
          Array.isArray(report.unresolved) && report.unresolved.length
            ? `${report.unresolved.length} to review`
            : '',
        ].filter(Boolean).join(' • ');

        const message = resp?.warning
          ? `✅ Common fields filled (${summary || 'profile-first mode'}). ${resp.warning}`
          : `✅ Fill complete${summary ? ` — ${summary}` : ''}. Review before submitting.`;
        setStatus('fill-status', message, 'success');
        renderFillReport(report);
        await loadMainScreen();
      } else {
        setStatus('fill-status', '❌ ' + (resp?.error || 'Could not fill form.'), 'error');
      }
    } catch (err) {
      setStatus('fill-status', '❌ ' + err.message, 'error');
    } finally {
      if (fillBtn) fillBtn.disabled = false;
    }
  });

  $('mark-submitted-btn')?.addEventListener('click', async () => {
    const markBtn = $('mark-submitted-btn');
    if (markBtn) markBtn.disabled = true;
    try {
      const resp = await sendMessage({ type: 'MARK_LAST_SUBMITTED' });
      if (resp?.success) {
        renderFillReport(null);
        setStatus('fill-status', '✅ Marked the latest tracked application as submitted.', 'success');
        await loadMainScreen();
      } else {
        setStatus('fill-status', '❌ ' + (resp?.error || 'Could not update tracker status.'), 'error');
      }
    } catch (err) {
      setStatus('fill-status', '❌ ' + err.message, 'error');
    } finally {
      if (markBtn) markBtn.disabled = false;
    }
  });

  $('preview-btn')?.addEventListener('click', async () => {
    const resp = await sendMessage({ type: 'GET_LAST_ANSWERS' });
    renderPreview(resp?.answers, resp?.report);
    showScreen('preview');
  });

  $('save-job-btn')?.addEventListener('click', async () => {
    const btn = $('save-job-btn');
    if (btn) btn.disabled = true;
    setStatus('fill-status', '⏳ Capturing this job…');
    try {
      const resp = await sendToActiveTab({ type: 'GET_JOB_INFO' });
      if (!resp?.success || !resp.job) {
        throw new Error(resp?.error || 'Could not read job details from this page.');
      }
      const job = resp.job;
      const saveResp = await sendMessage({
        type: 'LOG_APPLICATION',
        payload: {
          company: job.company || '',
          title: job.title || '',
          url: job.url || '',
          status: 'drafted',
          location: job.location || 'Unknown',
          employment_type: job.employment_type || 'Full-time',
          remote: !!job.remote,
          salary_range: job.salary_range || '',
          description: job.jd || '',
          jd_snippet: String(job.jd || '').slice(0, 300),
          answers_generated: false,
          fill_report: null,
        },
      });
      if (!saveResp?.success) throw new Error(saveResp?.error || 'Could not save to tracker.');
      btn.textContent = '✅ Saved!';
      btn.classList.add('btn-success');
      setTimeout(() => {
        btn.textContent = '💾 Save Job to Tracker';
        btn.classList.remove('btn-success');
      }, 2000);
      const label = [job.company, job.title].filter(Boolean).join(' — ') || 'This job';
      const srcNote = job._dataSource === 'json-ld' ? ' Salary, location & type read from structured data.' : '';
      setStatus('fill-status', `✅ Saved "${label}" to the tracker as a draft.${srcNote}`, 'success');
      await loadMainScreen();
    } catch (err) {
      setStatus('fill-status', '❌ ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('edit-resume-btn')?.addEventListener('click', async () => {
    if (!isStandaloneView()) {
      const opened = await openExpandedWorkspace('setup', 'core-profile-section');
      if (opened) return;
    }

    showScreen('setup');
    const state = await sendMessage({ type: 'GET_STATE' });
    applyStateToSetupForm(state || {});
    await renderLearnedDefaults();
    scrollToSection('core-profile-section');
  });
}

// ── Status row navigation ───────────────────────────────────────────────────

export function initStatusNavHandlers() {
  $('main-screen')?.addEventListener('click', async (event) => {
    const row = event.target.closest('.status-nav');
    if (!row) return;
    await openStatusTarget(row.dataset.navTarget || '');
  });
}

async function openStatusTarget(target) {
  if (!target) return;

  if (target === 'privacy' || target === 'ats') {
    const helpSection = target === 'ats' ? 'help-ats-section' : 'help-privacy-section';
    if (!isStandaloneView()) {
      const opened = await openExpandedWorkspace('help', helpSection);
      if (opened) return;
    }

    showScreen('help');
    scrollToSection(helpSection);
    return;
  }

  if (target === 'api') {
    if (!isStandaloneView()) {
      const opened = await openExpandedWorkspace('ai', 'ai-settings-section');
      if (opened) return;
    }

    showScreen('ai');
    const state = await sendMessage({ type: 'GET_STATE' });
    applyStateToSetupForm(state || {});
    scrollToSection('ai-settings-section');
    return;
  }

  const sectionMap = {
    resume: 'profile-resume-section',
    profile: 'core-profile-section',
    memory: 'profile-memory-section',
  };

  const sectionId = sectionMap[target];
  if (!isStandaloneView()) {
    const opened = await openExpandedWorkspace('setup', sectionId);
    if (opened) return;
  }

  showScreen('setup');
  const state = await sendMessage({ type: 'GET_STATE' });
  applyStateToSetupForm(state || {});
  await renderLearnedDefaults();
  scrollToSection(sectionId);
}

// ── Initial screen from URL ─────────────────────────────────────────────────

export async function applyInitialRequestedScreen() {
  const popupQuery = new URLSearchParams(window.location.search);
  const screen = popupQuery.get('screen');
  const sectionId = popupQuery.get('section');
  if (!screen) return;

  if (screen === 'tracker') {
    await renderTracker();
    showScreen('tracker');
    if (sectionId) scrollToSection(sectionId);
    return;
  }

  if (screen === 'job-search') {
    showScreen('job-search');
    return;
  }

  if (screen === 'analytics') {
    const { renderAnalytics } = await import('../analytics/analytics.js');
    showScreen('analytics');
    await renderAnalytics();
    return;
  }

  if (screen === 'setup') {
    showScreen('setup');
    const state = await sendMessage({ type: 'GET_STATE' });
    applyStateToSetupForm(state || {});
    await renderLearnedDefaults();
    if (sectionId) scrollToSection(sectionId);
    return;
  }

  if (screen === 'ai') {
    const state = await sendMessage({ type: 'GET_STATE' });
    applyStateToSetupForm(state || {});
    showScreen('ai');
    if (sectionId) scrollToSection(sectionId);
    return;
  }

  if (screen === 'help') {
    showScreen('help');
    if (sectionId) scrollToSection(sectionId);
  }
}
