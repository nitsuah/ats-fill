/**
 * content/form-filler.js - Form field filling and manipulation logic
 * Extracted from content.js (lines 534-897)
 */

import { qs, hasExtensionContext, isExtensionContextInvalidatedError, warnIfRelevant } from './utils.js';

/* ── Custom question collector ───────────────────────────────────────── */

export function collectCustomQuestions() {
  const STANDARD = [
    'first name', 'last name', 'full name', 'name', 'email', 'phone', 'mobile',
    'address', 'city', 'state', 'zip', 'postal', 'linkedin', 'github', 'portfolio',
    'website', 'resume', 'cv', 'cover letter', 'salary', 'compensation', 'start date',
    'available', 'work authorization', 'visa', 'sponsorship', 'years of experience',
  ];
  const SENSITIVE = ['gender', 'race', 'ethnic', 'disability', 'veteran', 'military', 'lgbt', 'transgender', 'demographic'];
  const QUESTION_STARTERS = ['why', 'what', 'how', 'describe', 'tell us', 'explain', 'share', 'please provide'];
  const questions = [];

  for (const label of document.querySelectorAll('label, legend, [data-label]')) {
    const text = label.textContent?.trim();
    if (!text || text.length < 10 || text.length > 500) continue;
    const lower = text.toLowerCase();
    if (STANDARD.some((s) => lower.includes(s))) continue;
    if (SENSITIVE.some((s) => lower.includes(s))) continue;
    if (text.endsWith('?') || QUESTION_STARTERS.some((s) => lower.startsWith(s))) {
      questions.push(text);
    }
  }
  return [...new Set(questions)];
}

/* ── Load field-map.json ──────────────────────────────────────────────── */

export async function loadFieldMap() {
  try {
    const url = chrome.runtime.getURL('data/field-map.json');
    const res = await fetch(url);
    return await res.json();
  } catch {
    return {};
  }
}

/* ── Form filler ──────────────────────────────────────────────────────── */

export function getFillableInputs() {
  return Array.from(document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]), textarea, select'
  )).filter((el) => {
    if (el.disabled || el.readOnly) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

export function fillForm(answers, fieldMap) {
  const inputs = getFillableInputs();

  let filled = 0;
  let preserved = 0;
  const unresolved = [];

  for (const input of inputs) {
    const key = resolveFieldKey(input, fieldMap, answers);
    if (!key) {
      unresolved.push(describeUnresolvedField(input, 'No matching saved answer yet'));
      continue;
    }

    const value = answers[key];
    if (value === undefined || value === null || value === '' || (typeof value === 'string' && !value.trim())) {
      unresolved.push(describeUnresolvedField(input, 'Answer still needs manual input'));
      continue;
    }

    if (hasMeaningfulValue(input)) {
      preserved++;
      continue;
    }

    const didFill = setFieldValue(input, String(value));
    if (didFill) {
      filled++;
      highlightField(input);
    } else {
      unresolved.push(describeUnresolvedField(input, 'Review the available choices manually'));
    }
  }

  const uniqueUnresolved = dedupeUnresolvedFields(unresolved);
  const skipped = preserved + uniqueUnresolved.length;
  console.info(`[apply-bot] Filled ${filled} field(s), preserved ${preserved}, unresolved ${uniqueUnresolved.length}.`);
  queueDraftSave();
  return { filled, preserved, skipped, unresolved: uniqueUnresolved };
}

function resolveFieldKey(el, fieldMap, answers = {}) {
  const candidates = [
    el.name,
    el.id,
    el.getAttribute('placeholder'),
    el.getAttribute('aria-label'),
    el.getAttribute('data-label'),
    getAssociatedLabelText(el),
    getFieldContextText(el),
  ].filter(Boolean);

  return resolveAnswerKeyFromCandidates(candidates, fieldMap, answers);
}

function resolveAnswerKeyFromCandidates(candidates, fieldMap = {}, answers = {}) {
  const normalizedCandidates = candidates
    .map((value) => normalizeLookupText(value))
    .filter(Boolean);

  for (const candidate of normalizedCandidates) {
    for (const key of Object.keys(answers || {})) {
      const normalizedKey = normalizeLookupText(key);
      if (!normalizedKey || normalizedKey.length < 4) continue;
      if (candidate === normalizedKey) return key;
    }
  }

  const sortedEntries = Object.entries(fieldMap).sort((a, b) => b[0].length - a[0].length);
  for (const candidate of normalizedCandidates) {
    for (const [pattern, key] of sortedEntries) {
      if (pattern.startsWith('//')) continue;
      if (candidate.includes(normalizeLookupText(pattern))) return key;
    }
  }

  for (const candidate of normalizedCandidates) {
    for (const key of Object.keys(answers || {})) {
      const normalizedKey = normalizeLookupText(key);
      if (!normalizedKey || normalizedKey.length < 4) continue;
      if (candidate.includes(normalizedKey) || normalizedKey.includes(candidate)) return key;
    }
  }

  return null;
}

function normalizeLookupText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAssociatedLabelText(el) {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent;
  }
  return el.closest('label')?.textContent || null;
}

function getFieldContextText(el) {
  const containers = [
    el.closest('fieldset'),
    el.closest('[role="radiogroup"]'),
    el.closest('[role="group"]'),
    el.closest('section'),
    el.parentElement,
  ].filter(Boolean);

  for (const container of containers) {
    const text = container.innerText?.trim();
    if (text && text.length <= 300) return text;
  }

  return null;
}

export function setFieldValue(el, value) {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();

  if (tag === 'select') return setSelectValue(el, value);

  if (type === 'checkbox') {
    const checked = /true|yes|1|agree|understand/i.test(value);
    if (el.checked !== checked) { el.checked = checked; fireEvents(el, ['input', 'change', 'click']); }
    return true;
  }

  if (type === 'radio') {
    if (!el.name) return false;
    const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`));
    const match = findBestSelectOptionValue(radios.map((radio) => ({
      value: radio.value,
      text: `${radio.value} ${getRadioOptionText(radio)}`,
      option: radio,
    })), value);

    if (match?.option) {
      match.option.checked = true;
      fireEvents(match.option, ['input', 'change', 'click']);
      return true;
    }

    return false;
  }

  // text / textarea / number / email / tel / url
  const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  fireEvents(el, ['input', 'change', 'blur']);
  return true;
}

function getRadioOptionText(radio) {
  if (radio.id) {
    const label = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
    if (label) return label.textContent || '';
  }
  return radio.closest('label')?.textContent || radio.parentElement?.textContent || '';
}

export function hasMeaningfulValue(el) {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();

  if (type === 'radio' && el.name) {
    return Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
      .some((radio) => radio.checked);
  }

  if (type === 'checkbox') {
    return getCheckboxGroupMembers(el).some((checkbox) => checkbox.checked);
  }

  if (tag === 'select') return !!String(el.value || '').trim();
  return !!String(el.value || '').trim();
}

export function describeField(el) {
  return (
    getAssociatedLabelText(el) ||
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.name ||
    el.id ||
    'unlabeled field'
  ).trim();
}

function describeUnresolvedField(el, reason = '') {
  return {
    label: describeField(el),
    draftKey: getDraftFieldKey(el),
    type: (el.getAttribute('type') || el.tagName || '').toLowerCase(),
    reason: String(reason || '').trim(),
  };
}

function dedupeUnresolvedFields(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const label = typeof item === 'string' ? item : (item?.label || '');
    const key = typeof item === 'string' ? item : (item?.draftKey || label);
    if (!label || !key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findFieldForReviewTarget(target = {}) {
  const fields = collectDraftableFields();
  const requestedKey = String(target?.draftKey || '').trim();
  if (requestedKey) {
    const byKey = fields.find((field) => getDraftFieldKey(field) === requestedKey);
    if (byKey) return byKey;
  }

  const label = normalizeLookupText(target?.label || target?.question || target?.field || target || '');
  if (!label) return null;

  return fields.find((field) => normalizeLookupText(describeField(field)) === label)
    || fields.find((field) => {
      const combined = normalizeLookupText(`${describeField(field)} ${getFieldContextText(field) || ''}`);
      return combined.includes(label) || label.includes(normalizeLookupText(describeField(field)));
    })
    || null;
}

function matchesPositiveChoice(text) {
  return /(yes|true|authorized|eligible|immediate|immediately|available now|open to relocate|remote|hybrid|agree|understand|will require|need sponsorship)/.test(text);
}

function matchesNegativeChoice(text) {
  return /(no|false|not now|do not|don't|without|none|prefer not|on site|onsite|will not require|do not require)/.test(text);
}

function findBestSelectOptionValue(options = [], value = '') {
  const desired = normalizeLookupText(value);
  if (!desired) return null;

  const normalizedOptions = Array.from(options || []).map((option) => ({
    ...option,
    value: String(option?.value ?? ''),
    text: String(option?.text ?? option?.label ?? option?.innerText ?? option?.value ?? '').trim(),
    normalizedValue: normalizeLookupText(option?.value ?? ''),
    normalizedText: normalizeLookupText(option?.text ?? option?.label ?? option?.innerText ?? option?.value ?? ''),
  })).filter((option) => option.normalizedValue || option.normalizedText);

  for (const option of normalizedOptions) {
    if (option.normalizedValue === desired || option.normalizedText === desired) return option;
  }

  const directMatch = normalizedOptions.find((option) => (
    option.normalizedText.includes(desired) || desired.includes(option.normalizedText) ||
    option.normalizedValue.includes(desired) || desired.includes(option.normalizedValue)
  ));
  if (directMatch) return directMatch;

  const wantsNegative = matchesNegativeChoice(desired) || /no sponsorship|required sponsorship|without sponsorship|do not require/.test(desired);
  const wantsPositive = matchesPositiveChoice(desired) || /require sponsorship|need sponsorship|visa sponsorship/.test(desired);
  const wantsImmediate = /immediate|asap|right away|available now/.test(desired);

  let best = null;
  let bestScore = 0;

  for (const option of normalizedOptions) {
    const text = `${option.normalizedValue} ${option.normalizedText}`.trim();
    let score = 0;

    if (wantsNegative && matchesNegativeChoice(text)) score += 5;
    if (wantsPositive && matchesPositiveChoice(text)) score += 5;
    if (wantsImmediate && /immediate|asap|right away|available now/.test(text)) score += 5;

    if (/2 week|two week/.test(desired) && /2 week|two week/.test(text)) score += 6;
    if (/month|30 day/.test(desired) && /month|30 day/.test(text)) score += 4;
    if (/remote/.test(desired) && /remote/.test(text)) score += 4;
    if (/hybrid/.test(desired) && /hybrid/.test(text)) score += 4;
    if (/on site|onsite/.test(desired) && /on site|onsite/.test(text)) score += 4;
    if (/prefer not/.test(desired) && /prefer not/.test(text)) score += 6;

    const overlapTokens = desired.split(' ').filter((token) => token.length > 2 && text.includes(token)).length;
    score += overlapTokens;

    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

function setSelectValue(el, value) {
  const match = findBestSelectOptionValue(Array.from(el.options).map((opt) => ({
    value: opt.value,
    text: opt.text,
    option: opt,
  })), value);

  if (!match?.option) return false;

  el.value = match.option.value; fireEvents(el, ['change']); return true;
}

function fireEvents(el, events) {
  for (const type of events) el.dispatchEvent(new Event(type, { bubbles: true }));
}

export function highlightField(el) {
  const orig = el.style.outline;
  el.style.outline = '2px solid #4ade80';
  el.style.outlineOffset = '2px';
  setTimeout(() => { el.style.outline = orig; el.style.outlineOffset = ''; }, 3000);
}

/* ── Draft caching / restoration ───────────────────────────────────────── */

const DRAFT_STORAGE_KEY = 'applicationDrafts';
let draftSaveTimer = null;
let draftRestoreTimer = null;
let draftPersistenceStarted = false;

function initDraftPersistence() {
  if (draftPersistenceStarted) return;
  draftPersistenceStarted = true;

  const handleFieldEvent = (event) => {
    const target = event.target;
    if (isDraftableField(target)) {
      queueDraftSave();
    }
  };

  document.addEventListener('input', handleFieldEvent, true);
  document.addEventListener('change', handleFieldEvent, true);
  document.addEventListener('blur', handleFieldEvent, true);
  window.addEventListener('beforeunload', saveDraftNow);
  window.addEventListener('pageshow', scheduleDraftRestore);

  const observer = new MutationObserver((mutations) => {
    const addedFormFields = mutations.some((mutation) =>
      Array.from(mutation.addedNodes || []).some((node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node.matches?.('input, textarea, select') || node.querySelector?.('input, textarea, select'))
      )
    );

    if (addedFormFields) {
      scheduleDraftRestore();
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });

  scheduleDraftRestore();
}

function isDraftableField(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName?.toLowerCase();
  if (!['input', 'textarea', 'select'].includes(tag)) return false;

  const type = (el.getAttribute('type') || '').toLowerCase();
  if (['hidden', 'submit', 'button', 'reset', 'file', 'password'].includes(type)) return false;
  if (el.disabled) return false;
  return true;
}

const DRAFT_TRACKING_PARAMS = /^(utm_.*|gclid|dclid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|gh_src|li_fat_id|igshid|session(_?id)?|sid|jsessionid|token|nonce|timestamp|ts|_t)$/i;

/** Page key without the query string (format used before queries were keyed). */
function getLegacyDraftPageKey() {
  try {
    const url = new URL(location.href);
    return `${url.origin}${url.pathname}`.replace(/\/$/, '') || url.origin;
  } catch {
    return location.href.split('#')[0].split('?')[0];
  }
}

/**
 * Draft for this page. Old drafts were keyed without the query, which is the
 * same key as today's when the normalised query is empty, so no extra lookup
 * is needed and drafts for other query variants are never shown.
 */
function findDraftForPage(drafts) {
  return drafts?.[getDraftPageKey()];
}

/** Page key including a normalised query: sorted params, tracking params dropped. */
function getDraftPageKey() {
  const base = getLegacyDraftPageKey();
  try {
    const url = new URL(location.href);
    const params = [...url.searchParams.entries()]
      .filter(([name]) => !DRAFT_TRACKING_PARAMS.test(name))
      .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
    if (!params.length) return base;
    return `${base}?${new URLSearchParams(params).toString()}`;
  } catch {
    return base;
  }
}

export function getDraftFieldKey(el) {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const base = normalizeLookupText([
    el.name,
    el.id,
    el.getAttribute('placeholder'),
    el.getAttribute('aria-label'),
    el.getAttribute('data-label'),
    getAssociatedLabelText(el),
    getFieldContextText(el),
  ].filter(Boolean).join(' | '));

  if (type === 'radio' || type === 'checkbox') {
    return `${type}:${base || el.name || el.id || 'field'}`;
  }

  return `${tag}:${type || tag}:${base || el.name || el.id || 'field'}`;
}

function getChoiceIdentity(el) {
  return String(getRadioOptionText(el) || el.value || el.id || '').trim();
}

function getCheckboxGroupMembers(el) {
  if (!el) return [];
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type !== 'checkbox') return [el];

  if (el.name) {
    return Array.from(document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(el.name)}"]`));
  }

  const groupKey = getDraftFieldKey(el);
  return collectDraftableFields().filter((field) => getDraftFieldKey(field) === groupKey);
}

function collectDraftableFields() {
  return Array.from(document.querySelectorAll('input, textarea, select')).filter(isDraftableField);
}

function queueDraftSave() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    saveDraftNow().catch((err) => warnIfRelevant('[apply-bot] Failed to save page draft.', err));
  }, 150);
}

async function saveDraftNow() {
  if (!hasExtensionContext()) return;

  try {
    const fields = {};
    const processedGroups = new Set();

    for (const el of collectDraftableFields()) {
      const key = getDraftFieldKey(el);
      if (!key) continue;

      const type = (el.getAttribute('type') || '').toLowerCase();
      if ((type === 'radio' || type === 'checkbox') && processedGroups.has(key)) continue;

      if (type === 'radio') {
        processedGroups.add(key);
        const radios = el.name
          ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
          : [el];
        const checked = radios.find((radio) => radio.checked);
        if (checked) fields[key] = getChoiceIdentity(checked);
        continue;
      }

      if (type === 'checkbox') {
        processedGroups.add(key);
        const members = getCheckboxGroupMembers(el);
        if (members.length > 1) {
          const selected = members.filter((member) => member.checked).map(getChoiceIdentity).filter(Boolean);
          if (selected.length) fields[key] = selected;
        } else {
          fields[key] = el.checked;
        }
        continue;
      }

      const value = String(el.value || '');
      if (value.trim()) {
        fields[key] = value;
      }
    }

    const data = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
    const drafts = data[DRAFT_STORAGE_KEY] || {};
    drafts[getDraftPageKey()] = {
      updatedAt: new Date().toISOString(),
      fields,
    };

    const entries = Object.entries(drafts).sort((a, b) =>
      String(b[1]?.updatedAt || '').localeCompare(String(a[1]?.updatedAt || ''))
    );
    const trimmedDrafts = Object.fromEntries(entries.slice(0, 50));

    await chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: trimmedDrafts });

    const learnedEntries = collectLearnedAnswerEntries();
    if (Object.keys(learnedEntries).length) {
      chrome.runtime.sendMessage({
        type: 'SAVE_LEARNED_DEFAULTS',
        payload: { entries: learnedEntries },
      }).catch(() => {});
    }
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return;
    throw err;
  }
}

function collectLearnedAnswerEntries() {
  const entries = {};
  const processedGroups = new Set();

  for (const el of collectDraftableFields()) {
    const label = describeField(el);
    const key = getDraftFieldKey(el);
    if (!label || label === 'unlabeled field' || !key || processedGroups.has(key)) continue;

    const type = (el.getAttribute('type') || '').toLowerCase();

    if (type === 'radio') {
      processedGroups.add(key);
      const radios = el.name
        ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
        : [el];
      const checked = radios.find((radio) => radio.checked);
      if (checked) entries[label] = getChoiceIdentity(checked);
      continue;
    }

    if (type === 'checkbox') {
      processedGroups.add(key);
      const members = getCheckboxGroupMembers(el);
      if (members.length > 1) {
        const selected = members.filter((member) => member.checked).map(getChoiceIdentity).filter(Boolean);
        if (selected.length) entries[label] = selected.join(', ');
      } else if (el.checked) {
        entries[label] = 'Yes';
      }
      continue;
    }

    const value = String(el.value || '').trim();
    if (value) entries[label] = value;
  }

  return entries;
}

function scheduleDraftRestore() {
  if (draftRestoreTimer) clearTimeout(draftRestoreTimer);
  draftRestoreTimer = setTimeout(() => {
    restoreDraftValues().catch((err) => warnIfRelevant('[apply-bot] Failed to restore page draft.', err));
  }, 120);
}

async function restoreDraftValues() {
  if (!hasExtensionContext()) return;

  try {
    const data = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
    const draft = findDraftForPage(data[DRAFT_STORAGE_KEY]);
    if (!draft?.fields) return;

    const processedGroups = new Set();

    for (const el of collectDraftableFields()) {
      const key = getDraftFieldKey(el);
      if (!key || processedGroups.has(key) || !(key in draft.fields)) continue;
      if (hasMeaningfulValue(el)) continue;

      const type = (el.getAttribute('type') || '').toLowerCase();
      const storedValue = draft.fields[key];

      if (type === 'radio') {
        processedGroups.add(key);
        if (storedValue) setFieldValue(el, String(storedValue));
        continue;
      }

      if (type === 'checkbox') {
        processedGroups.add(key);
        if (Array.isArray(storedValue)) {
          const selected = storedValue.map((value) => normalizeLookupText(value));
          for (const member of getCheckboxGroupMembers(el)) {
            const shouldCheck = selected.includes(normalizeLookupText(getChoiceIdentity(member)));
            if (member.checked !== shouldCheck) {
              member.checked = shouldCheck;
              fireEvents(member, ['input', 'change', 'click']);
            }
          }
        } else if (typeof storedValue === 'boolean') {
          if (el.checked !== storedValue) {
            el.checked = storedValue;
            fireEvents(el, ['input', 'change', 'click']);
          }
        }
        continue;
      }

      if (storedValue) {
        setFieldValue(el, String(storedValue));
      }
    }
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return;
    throw err;
  }
}