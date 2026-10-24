/**
 * content/message-listener.js - Chrome runtime message handling for content script
 * Extracted from content.js (lines ~43-89)
 */

import { handleFillForm, handleInjectAnswers, handleGetJobInfo, handleFocusField, handleFetchLinkedInJobs } from './job-processor.js';
import { detectAts } from './ats-detector.js';
import { matchesExpectedFillDocument } from './fill-url-guard.js';
import { getFillableInputs, findFieldForReviewTarget } from './form-filler.js';

/**
 * Setup Chrome runtime message listener for content script
 * Registers listener that delegates to handleMessage with error normalization
 */
export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!frameOwnsMessage(msg)) return false;
    handleMessage(msg, sendResponse).then((result) => {
      if (result !== undefined) sendResponse(result);
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  });
}

async function handleMessage(msg, sendResponse) {
  switch (msg.type) {
    case 'FILL_FORM':
      if (!matchesExpectedFillDocument(msg)) {
        throw new Error('The application page navigated or changed. Reopen the intended application tab and try again.');
      }
      return handleFillForm();
    case 'INJECT_ANSWERS':
      return handleInjectAnswers(msg.payload);
    case 'GET_JOB_INFO':
      return handleGetJobInfo();
    case 'DETECT_ATS':
      return { ats: detectAts() };
    case 'FOCUS_FIELD':
      return handleFocusField(msg.payload);
    case 'FETCH_LINKEDIN_JOBS':
      return handleFetchLinkedInJobs(msg.payload, sendResponse);
    default:
      throw new Error('Unknown message: ' + msg.type);
  }
}

// ── Helper functions (extracted from content.js) ────────────────────────────

const IS_TOP_FRAME = (() => { try { return window.top === window; } catch { return false; } })();

function frameOwnsMessage(msg) {
  switch (msg?.type) {
    case 'FILL_FORM':
    case 'INJECT_ANSWERS':
      return getFillableInputs().length > 0;
    case 'FOCUS_FIELD':
      return !!findFieldForReviewTarget(msg.payload || {});
    case 'GET_JOB_INFO':
    case 'DETECT_ATS':
    case 'FETCH_LINKEDIN_JOBS':
      return IS_TOP_FRAME;
    default:
      return IS_TOP_FRAME;
  }
}
