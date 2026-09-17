import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Regression coverage for two Interview Prep bugs:
//   1. Opening interview prep for any already-tracked application sent a
//      'GET_APPLICATION' message with no registered background handler, so
//      it always failed (see background/message-router.js — no such type).
//   2. When the active browser tab had no detectable job posting, Interview
//      Prep showed "No job detected" even when the pipeline had active jobs,
//      instead of falling back to them.
// Both are fixed by reading applications from the existing 'GET_STATE'
// payload (the same source Pipeline uses) rather than a second code path.

function setupDom() {
  const dom = new JSDOM(`
    <div class="screen" id="interview-prep-screen"></div>
    <div id="interview-prep-job-bar" class="hidden"></div>
    <div id="interview-prep-job-info" class="hidden">
      <h3 id="interview-prep-company"></h3>
      <p id="interview-prep-title"></p>
      <p id="interview-prep-meta"></p>
    </div>
    <button id="interview-prep-generate-btn" disabled>Generate</button>
    <div id="interview-prep-questions" class="hidden"></div>
    <div id="interview-prep-questions-list"></div>
    <div id="interview-prep-status"></div>
  `, { url: 'https://example.com/popup' });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom;
}

const SAMPLE_APPLICATIONS = [
  { id: 'a1', company: 'Old Co', title: 'Engineer', status: 'submitted', updated_at: '2026-01-01T00:00:00.000Z' },
  { id: 'a2', company: 'New Co', title: 'Senior Engineer', status: 'interview', updated_at: '2026-06-01T00:00:00.000Z' },
  { id: 'a3', company: 'Gone Co', title: 'Retired role', status: 'rejected', updated_at: '2026-09-01T00:00:00.000Z' },
];

function installChromeMock({ applications }) {
  global.chrome = {
    tabs: {
      // No active tab job available — this is what drives "no job detected"
      // on the current page, forcing the pipeline fallback.
      query: async () => [],
    },
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        if (msg?.type === 'GET_STATE') {
          cb({ applications });
        } else {
          cb({ success: false });
        }
      },
    },
  };
}

test('openInterviewPrepForCurrentJob falls back to the most recently updated active pipeline job', async () => {
  setupDom();
  installChromeMock({ applications: SAMPLE_APPLICATIONS });

  const { openInterviewPrepForCurrentJob } = await import('../popup/ux/interview-prep.js?case=fallback');
  await openInterviewPrepForCurrentJob();

  // a2 ("New Co") is the most recently updated non-rejected/retired job —
  // a3 is newer but excluded because it's rejected.
  assert.equal(document.getElementById('interview-prep-company').textContent, 'New Co');
  assert.equal(document.getElementById('interview-prep-generate-btn').disabled, false);
  assert.equal(document.getElementById('interview-prep-job-info').classList.contains('hidden'), false);
});

test('openInterviewPrepForApplication loads a tracked application via GET_STATE (no GET_APPLICATION handler required)', async () => {
  setupDom();
  installChromeMock({ applications: SAMPLE_APPLICATIONS });

  const { openInterviewPrepForApplication } = await import('../popup/ux/interview-prep.js?case=byid');
  await openInterviewPrepForApplication('a1');

  assert.equal(document.getElementById('interview-prep-company').textContent, 'Old Co');
  assert.equal(document.getElementById('interview-prep-generate-btn').disabled, false);
});

test('openInterviewPrepForCurrentJob shows the empty state only when there is truly nothing to prep for', async () => {
  setupDom();
  installChromeMock({ applications: [] });

  const { openInterviewPrepForCurrentJob } = await import('../popup/ux/interview-prep.js?case=empty');
  await openInterviewPrepForCurrentJob();

  assert.equal(document.getElementById('interview-prep-company').textContent, 'No job detected');
  assert.equal(document.getElementById('interview-prep-generate-btn').disabled, true);
});
