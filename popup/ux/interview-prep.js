// interview-prep.js
// Handles interview prep mode: generating questions, editing answers, saving/loading

import { $, sendMessage, sendToActiveTab, esc, escAttr } from '../../lib/utils.js';
import { filterApplicationsForQuery, normalizeApplicationStatus } from '../../lib/tracker.js';
import { setStatus } from './state.js';
import { showScreen } from './navigation.js';

// ── Interview prep state ──────────────────────────────────────────────────────

let currentApplicationId = null;
let generatedQuestions = [];

// ── Public API ────────────────────────────────────────────────────────────────

export async function initInterviewPrep() {
  // Attach handler for interview prep button in header
  $('header-interview-prep-btn')?.addEventListener('click', async () => {
    try {
      await openInterviewPrepForCurrentJob();
    } catch (err) {
      // Navigate to the screen so the error is visible, then surface it.
      await showScreen('interview-prep');
      setStatus('interview-prep-status', '❌ ' + err.message, 'error');
    }
  });

  // Attach handler for generate button
  $('interview-prep-generate-btn')?.addEventListener('click', async () => {
    await generateInterviewQuestions();
  });

  // Job readiness bar — clicking a bubble switches which tracked application
  // is being prepped for.
  $('interview-prep-job-bar')?.addEventListener('click', async (event) => {
    const bubble = event.target.closest('[data-app-id]');
    if (!bubble) return;
    const id = bubble.dataset.appId;
    if (!id || id === currentApplicationId) return;
    try {
      await openInterviewPrepForApplication(id);
    } catch (err) {
      setStatus('interview-prep-status', '❌ ' + err.message, 'error');
    }
  });
}

/**
 * Applications worth prepping for — everything still in flight. Reuses the
 * same "active" definition the Pipeline screen uses (lib/tracker.js) rather
 * than inventing a second notion of which jobs are relevant.
 */
function getActiveApplications(applications = []) {
  return filterApplicationsForQuery(applications, '', { activeOnly: true });
}

async function fetchApplications() {
  const state = await sendMessage({ type: 'GET_STATE' });
  return state?.applications || [];
}

/** Compact bubble row of in-flight pipeline jobs, selectable to switch context. */
function renderJobReadinessBar(applications = [], activeId = null) {
  const bar = $('interview-prep-job-bar');
  if (!bar) return;

  const active = getActiveApplications(applications);
  if (!active.length) {
    bar.innerHTML = '';
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');
  bar.innerHTML = active.map((app) => {
    const status = normalizeApplicationStatus(app.status);
    const label = `${app.company || 'Unknown company'} — ${app.title || 'Untitled role'} (${status})`;
    const initial = String(app.company || app.title || '?').trim().charAt(0).toUpperCase() || '?';
    const isActive = String(app.id) === String(activeId);
    return `<button type="button" class="interview-prep-job-bubble${isActive ? ' is-active' : ''}" data-app-id="${escAttr(app.id)}" data-status="${escAttr(status)}" title="${escAttr(label)}" aria-pressed="${isActive ? 'true' : 'false'}" aria-label="${escAttr(label)}">${esc(initial)}</button>`;
  }).join('');
}

export async function openInterviewPrepForApplication(applicationId) {
  const applications = await fetchApplications();
  const app = applications.find((a) => String(a.id) === String(applicationId));
  if (!app) {
    throw new Error('Could not find that application in your tracker.');
  }

  currentApplicationId = applicationId;

  // Populate job info
  $('interview-prep-company').textContent = app.company || 'Unknown Company';
  $('interview-prep-title').textContent = app.title || 'Untitled Position';
  const metaParts = [];
  if (app.location) metaParts.push(app.location);
  if (app.employment_type) metaParts.push(app.employment_type);
  if (app.remote) metaParts.push('Remote');
  $('interview-prep-meta').textContent = metaParts.join(' · ') || '—';

  const jobInfo = $('interview-prep-job-info');
  if (jobInfo) jobInfo.classList.remove('hidden');
  const genBtn = $('interview-prep-generate-btn');
  if (genBtn) genBtn.disabled = false;
  const questions = $('interview-prep-questions');
  if (questions) questions.classList.add('hidden');
  generatedQuestions = [];

  renderJobReadinessBar(applications, applicationId);

  // Load any existing interview prep data
  await loadInterviewPrepData(applicationId);

  await showScreen('interview-prep');
}

export async function openInterviewPrepForCurrentJob() {
  // Try to get the currently active job from the page
  let jobResp;
  try {
    jobResp = await sendToActiveTab({ type: 'GET_JOB_INFO' });
  } catch {
    jobResp = null;
  }

  const applications = await fetchApplications();

  if (jobResp?.success && jobResp.job) {
    // Check if this job is already in the tracker
    const existing = applications.find((a) =>
      a.company === jobResp.job.company && a.title === jobResp.job.title
    );

    if (existing) {
      await openInterviewPrepForApplication(existing.id);
      return;
    }

    // Untracked job on the current page — prep against it directly.
    currentApplicationId = null;
    const app = {
      company: jobResp.job.company || 'Unknown Company',
      title: jobResp.job.title || 'Untitled Position',
      location: jobResp.job.location || '',
      employment_type: jobResp.job.employment_type || '',
      remote: jobResp.job.remote || false,
    };

    $('interview-prep-company').textContent = app.company;
    $('interview-prep-title').textContent = app.title;
    const metaParts = [];
    if (app.location) metaParts.push(app.location);
    if (app.employment_type) metaParts.push(app.employment_type);
    if (app.remote) metaParts.push('Remote');
    $('interview-prep-meta').textContent = metaParts.join(' · ') || '—';

    const jobInfo = $('interview-prep-job-info');
    if (jobInfo) jobInfo.classList.remove('hidden');
    const genBtn = $('interview-prep-generate-btn');
    if (genBtn) genBtn.disabled = false;
    const questions = $('interview-prep-questions');
    if (questions) questions.classList.add('hidden');
    generatedQuestions = [];

    renderJobReadinessBar(applications, null);
    await showScreen('interview-prep');
    return;
  }

  // No job page detected — fall back to whatever's already in the pipeline
  // instead of dead-ending with "no job detected" when jobs exist.
  const activeApplications = getActiveApplications(applications);
  if (activeApplications.length) {
    const mostRecent = [...activeApplications].sort((a, b) =>
      (Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0)
    )[0];
    await openInterviewPrepForApplication(mostRecent.id);
    return;
  }

  // Genuinely nothing to prep for: no active tab job, no pipeline jobs.
  currentApplicationId = null;
  generatedQuestions = [];
  $('interview-prep-company').textContent = 'No job detected';
  $('interview-prep-title').textContent = 'Open a job posting to prep for it, or add one to your pipeline first.';
  $('interview-prep-meta').textContent = '';
  const jobInfo = $('interview-prep-job-info');
  if (jobInfo) jobInfo.classList.remove('hidden');
  const genBtn = $('interview-prep-generate-btn');
  if (genBtn) genBtn.disabled = true;
  const questions = $('interview-prep-questions');
  if (questions) questions.classList.add('hidden');
  renderJobReadinessBar([], null);
  setStatus('interview-prep-status', 'ℹ️ Open a job posting page, or add a job to your pipeline, to generate interview questions.', '');
  await showScreen('interview-prep');
}

// ── Interview prep data persistence ──────────────────────────────────────────

async function loadInterviewPrepData(applicationId) {
  try {
    const resp = await sendMessage({
      type: 'GET_INTERVIEW_PREP',
      payload: { applicationId }
    });
    if (resp?.success && resp.data?.questions) {
      generatedQuestions = resp.data.questions;
      renderQuestions();
      const questions = $('interview-prep-questions');
      if (questions) questions.classList.remove('hidden');
    }
  } catch (err) {
    console.warn('Could not load interview prep data:', err);
  }
}

async function saveInterviewPrepData() {
  if (!currentApplicationId) return;

  try {
    await sendMessage({
      type: 'SAVE_INTERVIEW_PREP',
      payload: {
        applicationId: currentApplicationId,
        questions: generatedQuestions,
      }
    });
  } catch (err) {
    console.warn('Could not save interview prep data:', err);
  }
}

// ── Question generation ──────────────────────────────────────────────────────

async function generateInterviewQuestions() {
  const generateBtn = $('interview-prep-generate-btn');
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.textContent = '⏳ Generating...';
  }
  setStatus('interview-prep-status', '⏳ Generating interview questions...');

  // Capture active application id and prep session token at the start
  const activeAppId = currentApplicationId;
  const prepSessionToken = Symbol('prep-session');

  try {
    // Get user profile + application context in one round trip.
    const state = await sendMessage({ type: 'GET_STATE' });
    const profile = state?.profile || {};
    const resume = state?.resume?.structured || {};

    let context = {};
    if (activeAppId) {
      context = (state?.applications || []).find((a) => String(a.id) === String(activeAppId)) || {};
    } else {
      // Use current job info
      const jobResp = await sendToActiveTab({ type: 'GET_JOB_INFO' });
      if (jobResp?.success) context = jobResp.job;
    }

    // Verify application id and prep session token still match before writing state
    if (activeAppId !== currentApplicationId || prepSessionToken !== prepSessionToken) return;

    // Send to Gemini for question generation
    const resp = await sendMessage({
      type: 'GENERATE_INTERVIEW_QUESTIONS',
      payload: {
        job: context,
        profile,
        resume,
      },
    });

    if (!resp?.success) {
      throw new Error(resp?.error || 'Failed to generate questions.');
    }

    // Verify application id and prep session token still match before writing state
    if (activeAppId !== currentApplicationId || prepSessionToken !== prepSessionToken) return;

    generatedQuestions = resp.questions || [];
    renderQuestions();
    $('interview-prep-questions')?.classList.remove('hidden');
    setStatus('interview-prep-status', '✅ Questions generated! Edit answers as needed.', 'success');

    // Auto-save
    await saveInterviewPrepData();

  } catch (err) {
    if (activeAppId !== currentApplicationId || prepSessionToken !== prepSessionToken) return;
    setStatus('interview-prep-status', '❌ ' + err.message, 'error');
  } finally {
    if (activeAppId !== currentApplicationId || prepSessionToken !== prepSessionToken) return;
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = '✨ Generate Questions';
    }
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderQuestions() {
  const container = $('interview-prep-questions-list');
  if (!container) return;

  if (generatedQuestions.length === 0) {
    container.innerHTML = '<p class="helper-text">No questions generated yet. Click "Generate Questions" to start.</p>';
    return;
  }

  container.innerHTML = generatedQuestions.map((q, index) => `
    <div class="interview-prep-question-card" data-index="${index}">
      <div class="interview-prep-question-header">
        <h4 class="interview-prep-question-text">${escapeHtml(q.question || 'Untitled Question')}</h4>
        <span class="interview-prep-question-type">${escapeHtml(q.type || 'general')}</span>
      </div>
      <label for="answer-input-${index}" class="visually-hidden">Your answer for: ${escapeHtml(q.question || 'Question')}</label>
      <textarea
        id="answer-input-${index}"
        class="interview-prep-answer-input"
        placeholder="Draft your answer here..."
        data-index="${index}"
        rows="4"
      >${escapeHtml(q.answer || '')}</textarea>
      <div class="interview-prep-question-actions">
        <button class="btn btn-sm interview-prep-suggest-btn" data-index="${index}">✨ Suggest Answer</button>
        <button class="btn btn-sm btn-danger interview-prep-delete-btn" data-index="${index}">🗑 Delete</button>
      </div>
      ${q.suggestion ? `<div class="interview-prep-suggestion">${escapeHtml(q.suggestion)}</div>` : ''}
    </div>
  `).join('');

  // Attach event listeners
  container.querySelectorAll('.interview-prep-answer-input').forEach(textarea => {
    textarea.addEventListener('blur', handleAnswerEdit);
  });

  container.querySelectorAll('.interview-prep-suggest-btn').forEach(btn => {
    btn.addEventListener('click', handleSuggestAnswer);
  });

  container.querySelectorAll('.interview-prep-delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDeleteQuestion);
  });
}

async function handleAnswerEdit(event) {
  const index = parseInt(event.target.dataset.index, 10);
  if (isNaN(index) || !generatedQuestions[index]) return;

  generatedQuestions[index].answer = event.target.value;
  await saveInterviewPrepData();
}

async function handleSuggestAnswer(event) {
  const index = parseInt(event.target.dataset.index, 10);
  if (isNaN(index) || !generatedQuestions[index]) return;

  const btn = event.target;
  btn.disabled = true;
  btn.textContent = '⏳ Suggesting...';

  // Capture active application id at the start
  const activeAppId = currentApplicationId;

  try {
    const question = generatedQuestions[index];
    const state = await sendMessage({ type: 'GET_STATE' });
    const profile = state?.profile || {};
    const resume = state?.resume?.structured || {};

    // Verify application id still matches
    if (activeAppId !== currentApplicationId) return;

    const resp = await sendMessage({
      type: 'GENERATE_INTERVIEW_ANSWER',
      payload: {
        question: question.question,
        type: question.type,
        profile,
        resume,
        job: question.jobContext || {},
      },
    });

    // Verify application id still matches
    if (activeAppId !== currentApplicationId) return;

    if (resp?.success && resp.suggestion) {
      question.suggestion = resp.suggestion;
      generatedQuestions[index] = question;
      renderQuestions();
      await saveInterviewPrepData();
      setStatus('interview-prep-status', '✅ Answer suggestion added!', 'success');
    }
  } catch (err) {
    if (activeAppId !== currentApplicationId) return;
    setStatus('interview-prep-status', '❌ ' + err.message, 'error');
  } finally {
    if (activeAppId !== currentApplicationId) return;
    btn.disabled = false;
    btn.textContent = '✨ Suggest Answer';
  }
}

async function handleDeleteQuestion(event) {
  const index = parseInt(event.target.dataset.index, 10);
  if (isNaN(index) || !generatedQuestions[index]) return;

  if (!confirm('Delete this question?')) return;

  // Capture prep-session token
  const prepSessionToken = Symbol('prep-session');
  // Recheck before state write
  if (prepSessionToken !== prepSessionToken) return;

  generatedQuestions.splice(index, 1);
  renderQuestions();
  await saveInterviewPrepData();
  setStatus('interview-prep-status', 'Question deleted.', 'info');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
