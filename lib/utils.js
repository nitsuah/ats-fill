// lib/utils.js — Shared utility functions for DOM, escaping, messaging, and general helpers

/**
 * Strip HTML tags and entities from a string.
 */
export function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

/**
 * Shorthand for document.getElementById
 */
export function $(id) {
  return document.getElementById(id);
}

/**
 * Escape HTML for text content
 */
export function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape HTML for attribute values
 */
export function escAttr(str) {
  return esc(str).replace(/'/g, '&#39;');
}

/**
 * Truncate text to a max length, adding ellipsis if needed
 */
export function truncateText(text, maxLength = 96) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

// ── Date helpers ────────────────────────────────────────────────────────────

/**
 * Format a date string or Date object as YYYY-MM-DD.
 */
export function formatDate(value) {
  if (!value) return '';
  const d = parseLocalDateValue(value);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Format a date for an <input type="date"> value (YYYY-MM-DD).
 */
export function formatDateInput(value) {
  if (!value) return '';
  const d = parseLocalDateValue(value);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toIso(value) {
  if (value == null || value === '') return '';
  // Arbeitnow uses unix seconds; Remotive uses an ISO/date string.
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const numValue = Number(value);
    // Treat as seconds if magnitude is less than a typical millisecond timestamp (e.g., before 2000-01-01)
    const ms = numValue < 2000000000 ? numValue * 1000 : numValue;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function parseLocalDateValue(value) {
  if (value instanceof Date) return value;
  const text = String(value || '').trim();
  const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    return new Date(year, month - 1, day);
  }
  return new Date(text);
}

export function formatSavedTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'recently';
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── Badge / status row helpers ──────────────────────────────────────────────

/**
 * Return CSS class for badge tone
 */
export function badgeToneClass(tone) {
  switch (tone) {
    case 'ok': return 'badge-ok';
    case 'success': return 'badge-success';
    case 'error': return 'badge-error';
    case 'warn': return 'badge-warn';
    case 'warning': return 'badge-warning';
    case 'memory': return 'badge-memory';
    case 'info':
    default: return 'badge-info';
  }
}

/**
 * Set a badge element's text, tone class, and tooltip.
 */
export function setBadgeState(elId, text, tone, tooltip = '') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.className = 'badge ' + badgeToneClass(tone);
  if (tooltip) el.title = tooltip;
}

/**
 * Set the title / tooltip of a status row.
 */
export function setStatusRowMeta(elId, tooltip = '') {
  const el = document.getElementById(elId);
  if (!el) return;
  if (tooltip) el.title = tooltip;
}

// ── ATS detection (pure logic) ──────────────────────────────────────────────

const ATS_META = {
  greenhouse: { label: 'Greenhouse', hint: 'Greenhouse ATS detected — full autofill support.', tone: 'ok', tip: 'Greenhouse detected.' },
  lever: { label: 'Lever', hint: 'Lever ATS detected — full autofill support.', tone: 'ok', tip: 'Lever detected.' },
  ashby: { label: 'Ashby', hint: 'Ashby ATS detected — full autofill support.', tone: 'ok', tip: 'Ashby detected.' },
  workday: { label: 'Workday', hint: 'Workday ATS detected — multi-step forms expected.', tone: 'ok', tip: 'Workday detected.' },
  icims: { label: 'iCIMS', hint: 'iCIMS ATS detected.', tone: 'ok', tip: 'iCIMS detected.' },
  jobvite: { label: 'Jobvite', hint: 'Jobvite ATS detected.', tone: 'ok', tip: 'Jobvite detected.' },
  phenom: { label: 'Phenom', hint: 'Phenom ATS detected.', tone: 'ok', tip: 'Phenom detected.' },
  circle: { label: 'Circle Careers', hint: 'Circle careers flow detected.', tone: 'ok', tip: 'Circle careers detected.' },
  linkedin: { label: 'LinkedIn', hint: 'LinkedIn Easy Apply detected.', tone: 'ok', tip: 'LinkedIn detected.' },
  'linkedin easy apply': { label: 'LinkedIn', hint: 'LinkedIn Easy Apply detected.', tone: 'ok', tip: 'LinkedIn detected.' },
};

/**
 * Get ATS metadata from an ATS key string (from GET_STATE currentAts).
 */
export function getAtsMeta(atsKey) {
  if (!atsKey) {
    return { label: 'No job page', hint: '', tone: 'info', tip: 'Navigate to a supported job application page to detect the ATS.' };
  }
  const key = String(atsKey).toLowerCase().trim();
  if (ATS_META[key]) return ATS_META[key];
  return { label: atsKey, hint: `${atsKey} detected`, tone: 'info', tip: `${atsKey} detected.` };
}

/**
 * Get a short ATS hint string.
 */
export function getAtsHint(atsKey) {
  return getAtsMeta(atsKey).hint;
}

export const ANNUAL_HOURS = 2080;

// ── Chrome messaging ────────────────────────────────────────────────────────

/**
 * Send a message to the background service worker.
 * Resolves with null on error so callers that use `resp || {}` degrade gracefully
 * instead of causing an unhandled rejection that leaves the popup blank.
 * @param {object} msg
 * @param {{ timeout?: number }} [opts] — override the default 10s timeout for
 *   long-running operations (e.g. AI resume parsing).
 */
export async function sendMessage(msg, { timeout = 10_000 } = {}) {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout);
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        clearTimeout(timer);
        resolve(chrome.runtime.lastError ? null : response);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * Send a message to the content script in the active tab.
 */
export async function sendToActiveTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');

  try {
    return await sendMessageToTab(tab.id, msg);
  } catch (err) {
    const details = String(err?.message || err || '');

    // No frame claimed the message (e.g. FILL_FORM but no fillable fields are
    // present in any frame yet). Surface a clear, actionable hint instead of the
    // raw Chrome port error.
    if (/message port closed/i.test(details)) {
      throw new Error('No fillable fields were found on this page. Open the actual application form (it may be on the next step or inside an embedded panel), then try again.');
    }

    const needsInjection = /Receiving end does not exist|Could not establish connection/i.test(details);
    if (!needsInjection) {
      throw err;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js'],
      });
      return await sendMessageToTab(tab.id, msg);
    } catch {
      throw new Error('Could not establish connection to this job page. Refresh the tab once, then try again.');
    }
  }
}

function sendMessageToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

// ── Tracker option renderers ────────────────────────────────────────────────

import { normalizeApplicationStatus } from './tracker.js';

const STATUS_OPTIONS = [
  { value: 'drafted', label: 'Drafted', hint: 'saved lead / not sent', tone: 'drafted', emoji: '🟡' },
  { value: 'filled', label: 'Filled', hint: 'answers drafted / review before submit', tone: 'filled', emoji: '📝' },
  { value: 'submitted', label: 'Submitted', hint: 'application sent', tone: 'submitted', emoji: '✅' },
  { value: 'pending', label: 'Pending', hint: 'awaiting response', tone: 'pending', emoji: '⏳' },
  { value: 'interview', label: 'Interview', hint: 'talking with the team', tone: 'interview', emoji: '📅' },
  { value: 'offer', label: 'Offer', hint: 'final stage / decision time', tone: 'offer', emoji: '🎉' },
  { value: 'rejected', label: 'Rejected', hint: 'closed out / archived', tone: 'rejected', emoji: '❌' },
  { value: 'retired', label: 'Retired', hint: 'job unlisted / no reply', tone: 'retired', emoji: '⬜' },
];

export function renderStatusOptions(currentStatus, options = {}) {
  const { verbose = false } = options;
  const normalized = normalizeApplicationStatus(currentStatus);
  return STATUS_OPTIONS.map(opt => {
    const selected = opt.value === normalized ? ' selected' : '';
    const label = verbose
      ? `${opt.label} — ${opt.hint}`
      : opt.label;
    return `<option value="${escAttr(opt.value)}" data-status-tone="${escAttr(opt.tone)}"${selected}>${esc(label)}</option>`;
  }).join('');
}

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'];

export function renderEmploymentTypeOptions(currentType) {
  const normalized = String(currentType || 'Full-time').trim();
  return EMPLOYMENT_TYPES.map(type => {
    const selected = type === normalized ? ' selected' : '';
    return `<option value="${escAttr(type)}"${selected}>${esc(type)}</option>`;
  }).join('');
}

// ── Text normalization helpers ──────────────────────────────────────────────

export function normalizeLookupText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSensitiveMemoryQuestion(question = '') {
  const text = normalizeLookupText(question);
  return /gender|pronoun|sex|sexual orientation|orientation|race|ethnic|ethnicity|hispanic|latino|asian|white|black|african american|native american|pacific islander|non binary|nonbinary|trans|veteran|military|active duty|reserve force|disability|disabled|religion|faith|marital|spouse/.test(text);
}

export function getReviewItemLabel(item) {
  if (typeof item === 'string') return item;
  const label = item?.label || item?.question || item?.field || 'Field to review';
  const reason = String(item?.reason || '').trim();
  if (!reason) return label;
  return `${label} — ${reason}`;
}

// ── Resume attachment helpers ───────────────────────────────────────────────

export function getResumeAttachmentSourceLabel(source = '') {
  switch (source) {
    case 'paste': return 'Pasted text';
    case 'upload': return 'Uploaded file';
    default: return 'Saved preview';
  }
}

export function getResumeAttachmentDownloadName(attachment = {}) {
  if (attachment.fileName) return attachment.fileName;
  const ext = (attachment.mimeType || '').includes('pdf') ? '.pdf' : '.txt';
  return `resume-preview${ext}`;
}
