/**
 * apply-bot — form-filler.js
 * Injects generated answers into form fields on the current page.
 * NOTE: This module is used by the background service worker for reference.
 * The content script (content/content.js) has its own inlined version
 * to avoid ES module import constraints in classic content scripts.
 */

// Field map is passed in as a parameter (loaded via fetch in the caller).

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fill form fields with the provided answers.
 *
 * @param {object} answers   Map of semantic key → answer string (from Gemini).
 * @param {object} fieldMap  The field-map.json contents (pattern → key).
 * @param {object} [opts]
 * @param {boolean} [opts.highlight] Visually highlight filled fields.
 * @returns {{ filled: number, preserved: number, skipped: number, unresolved: object[] }}
 */
export function fillForm(answers, fieldMap = {}, opts = {}) {
  const inputs = collectFormFields();
  let filled = 0;
  let preserved = 0;
  const unresolved = [];

  for (const input of inputs) {
    // "Other: please specify" boxes belong to an Other choice; the choice
    // itself carries the answer, so never pour that answer into the box too.
    if (isOtherSpecifyField(input)) continue;

    const key = resolveFieldKey(input, fieldMap, answers);
    if (!key) {
      unresolved.push(describeUnresolvedField(input, 'No matching saved answer yet'));
      continue;
    }

    const value = answers[key];
    if (value === undefined || value === null || value === '' || isNonAnswer(value)) {
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
      if (opts.highlight !== false) highlightField(input);
    } else {
      unresolved.push(describeUnresolvedField(input, 'Review the available choices manually'));
    }
  }

  const yesNo = fillYesNoButtonGroups(answers, fieldMap);
  filled += yesNo.filled;
  preserved += yesNo.preserved;
  unresolved.push(...yesNo.unresolved);

  const uniqueUnresolved = dedupeUnresolvedFields(unresolved);
  const skipped = preserved + uniqueUnresolved.length;
  console.info(`[apply-bot] Filled ${filled} field(s), preserved ${preserved}, unresolved ${uniqueUnresolved.length}.`);
  return { filled, preserved, skipped, unresolved: uniqueUnresolved };
}

/**
 * Collect custom (open-ended text) questions from the page.
 * Returns an array of question strings so we can send them to Gemini.
 *
 * @returns {string[]}
 */
export function collectCustomQuestions() {
  const questions = [];
  const labels = document.querySelectorAll('label, legend, [data-label]');
  const sensitivePatterns = ['gender', 'race', 'ethnic', 'disability', 'veteran', 'military', 'lgbt', 'transgender', 'demographic'];

  for (const label of labels) {
    const text = label.textContent?.trim();
    if (!text) continue;
    if (text.length < 10 || text.length > 500) continue;
    if (isStandardField(text)) continue;
    if (sensitivePatterns.some((p) => text.toLowerCase().includes(p))) continue;
    if (text.endsWith('?') || isQuestionLike(text)) {
      questions.push(text);
    }
  }

  return [...new Set(questions)]; // deduplicate
}

// ── Field collection ──────────────────────────────────────────────────────────

function collectFormFields() {
  return Array.from(
    document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]), textarea, select'
    )
  ).filter((el) => {
    // Skip disabled / readonly
    if (el.disabled || el.readOnly) return false;
    // Skip invisible
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // Yes/No button groups keep a hidden checkbox in sync; answer them by
    // clicking the button instead (see fillYesNoButtonGroups).
    if (el.closest(YES_NO_GROUP_SELECTOR)) return false;
    return true;
  });
}

/**
 * Placeholders an AI writes when it has no answer ("Not specified in the
 * provided information.", "N/A"). They are neither filled nor learned; the
 * field is left for the user.
 */
export function isNonAnswer(value) {
  const text = normalizeLookupText(value);
  return /^(not specified|not provided|not mentioned|not available|not applicable|no answer|unknown|tbd|to be determined)\b/.test(text)
    || /^(n a|na|none)$/.test(text);
}

function isOtherSpecifyField(el) {
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'radio' || type === 'checkbox' || el.tagName.toLowerCase() === 'select') return false;
  const ownLabel = normalizeLookupText(getAssociatedLabelText(el) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');
  return /^(other|other please specify|please specify|if other please specify|specify)$/.test(ownLabel);
}

// ── Yes/No button groups (Ashby) ──────────────────────────────────────────────

const YES_NO_GROUP_SELECTOR = '.ashby-application-form-input-yesno';

export function fillYesNoButtonGroups(answers = {}, fieldMap = {}) {
  let filled = 0;
  let preserved = 0;
  const unresolved = [];

  for (const group of document.querySelectorAll(YES_NO_GROUP_SELECTOR)) {
    const buttons = Array.from(group.querySelectorAll('button'));
    const label = getYesNoGroupLabel(group);
    if (!buttons.length || !label) continue;

    if (buttons.some((button) => button.getAttribute('aria-pressed') === 'true')) {
      preserved++;
      continue;
    }

    const key = resolveAnswerKeyFromCandidates([label], fieldMap, answers);
    const value = key ? answers[key] : '';
    if (!value) {
      unresolved.push({ label, reason: key ? 'Answer still needs manual input' : 'No matching saved answer yet', type: 'yesno' });
      continue;
    }

    const choice = parseYesNoAnswer(value);
    const button = choice && buttons.find((b) => getYesNoButtonOption(b) === choice);
    if (!button) {
      unresolved.push({ label, reason: 'Review the available choices manually', type: 'yesno' });
      continue;
    }

    button.click();
    filled++;
  }

  return { filled, preserved, unresolved };
}

function getYesNoGroupLabel(group) {
  const entry = group.closest('.ashby-application-form-field-entry') || group.parentElement;
  return (entry?.querySelector('label, legend')?.textContent || '').trim();
}

function getYesNoButtonOption(button) {
  return String(button.dataset?.option || button.textContent || '').trim().toLowerCase();
}

/**
 * Map an answer to 'yes' / 'no' only when it starts with an explicit yes or no.
 * Anything else ("Not specified.", "It depends") returns null so the question
 * is left for the user instead of guessing.
 */
export function parseYesNoAnswer(value) {
  const text = String(value || '').trim().toLowerCase();
  if (/^(yes|y|true)\b/.test(text)) return 'yes';
  if (/^(no|n|false)\b/.test(text)) return 'no';
  return null;
}

// ── Field key resolution ──────────────────────────────────────────────────────

/**
 * Resolve a semantic key for a form field by inspecting its attributes and labels.
 * Returns null if no match found.
 *
 * @param {HTMLElement} el
 * @param {object} fieldMap  The field-map.json contents.
 * @returns {string|null}
 */
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

export function resolveAnswerKeyFromCandidates(candidates, fieldMap = {}, answers = {}) {
  const normalizedCandidates = candidates
    .map((value) => normalizeLookupText(value))
    .filter(Boolean);

  for (const candidate of normalizedCandidates) {
    for (const key of Object.keys(answers || {})) {
      const normalizedKey = normalizeLookupText(key);
      if (!normalizedKey || normalizedKey.length < 4) continue;
      if (candidate === normalizedKey) {
        return key;
      }
    }
  }

  const sortedEntries = Object.entries(fieldMap).sort((a, b) => b[0].length - a[0].length);

  for (const candidate of normalizedCandidates) {
    for (const [pattern, key] of sortedEntries) {
      if (pattern.startsWith('//')) continue;
      if (labelContainsPattern(candidate, normalizeLookupText(pattern))) return key;
    }
  }

  for (const candidate of normalizedCandidates) {
    for (const key of Object.keys(answers || {})) {
      const normalizedKey = normalizeLookupText(key);
      if (!normalizedKey || normalizedKey.length < 4) continue;
      if (candidate.includes(normalizedKey) || normalizedKey.includes(candidate)) {
        return key;
      }
    }
  }

  return null;
}

export function findLearnedAnswer(question, learnedAnswers = {}) {
  const target = normalizeLookupText(question);
  if (!target) return '';

  let bestMatch = { score: 0, value: '' };

  for (const [label, value] of Object.entries(learnedAnswers || {})) {
    const safeValue = String(value || '').trim();
    if (!shouldPersistLearnedValue(label, safeValue)) continue;

    const normalizedLabel = normalizeLookupText(label);
    if (!normalizedLabel) continue;
    if (normalizedLabel === target) return safeValue;

    const score = scoreCandidateSimilarity(target, normalizedLabel);
    if (score > bestMatch.score) {
      bestMatch = { score, value: safeValue };
    }
  }

  return bestMatch.score >= 0.55 ? bestMatch.value : '';
}

export function getLearnedMemoryKey(label) {
  return normalizeLookupText(label).slice(0, 180);
}

export function isIgnoredLearnedPrompt(label, ignoredEntries = {}) {
  const key = getLearnedMemoryKey(label);
  if (!key) return false;

  if (Array.isArray(ignoredEntries)) {
    return ignoredEntries.some((entry) => getLearnedMemoryKey(entry?.question || entry) === key);
  }

  if (ignoredEntries && typeof ignoredEntries === 'object') {
    if (key in ignoredEntries) return true;
    return Object.values(ignoredEntries).some((entry) => getLearnedMemoryKey(entry?.question || entry) === key);
  }

  return false;
}

export function shouldPersistLearnedValue(label, value) {
  const normalizedLabel = normalizeLookupText(label);
  const safeValue = String(value || '').trim();
  const normalizedValue = normalizeLookupText(safeValue);
  const legalPattern = /agreement|arbitration|terms|conditions|policy|privacy notice|privacy policy|consent|acknowledge|acknowledgement|waiver|release|certify|attest|i confirm|i acknowledge|i understand|have read|read the above|legal/i;
  const genericPromptPattern = /^(start typing|not listed|prefer not to say|select one|choose one|other|n a)$/i;
  const freeformPattern = /briefly|describe|outline|tell us|share|what experience|why do you|why are you|additional information|details/i;

  if (!normalizedLabel || normalizedLabel.length < 2) return false;
  if (!safeValue || safeValue.length > 500) return false;
  if (isNonAnswer(safeValue)) {
    return false;
  }
  if (/ssn|social security|date of birth|dob|birthday|age/.test(normalizedLabel)) {
    return false;
  }
  if (genericPromptPattern.test(normalizedLabel)) return false;
  if (/password|resume|cover letter|upload|attach/.test(normalizedLabel)) return false;
  if (/first name|last name|full name|email|phone|mobile|address|city|state|zip|postal|linkedin|github|portfolio|website|twitter|x formerly twitter|\burl\b/.test(normalizedLabel)) {
    return false;
  }
  if (/^\d{7,}$/.test(safeValue)) return false;
  if (freeformPattern.test(normalizedLabel) && normalizedValue.length < 8) {
    return false;
  }
  if (legalPattern.test(normalizedLabel) || legalPattern.test(normalizeLookupText(safeValue))) {
    return false;
  }

  return true;
}

function scoreCandidateSimilarity(left, right) {
  const leftTokens = new Set(normalizeLookupText(left).split(' ').filter((token) => token.length > 2));
  const rightTokens = new Set(normalizeLookupText(right).split(' ').filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }

  const jaccard = overlap / Math.max(leftTokens.size, rightTokens.size);
  const containsBoost = left.includes(right) || right.includes(left) ? 0.25 : 0;
  const overlapBoost = overlap >= 2 ? 0.2 : 0;
  const keyBoost = /(clearance|sponsorship|authorization|timezone|salary|relocate|notice|start date|availability)/.test(`${left} ${right}`) && overlap >= 1
    ? 0.15
    : 0;

  return Math.min(1, jaccard + containsBoost + overlapBoost + keyBoost);
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
  const parent = el.closest('label');
  if (parent) return parent.textContent;
  return null;
}

function describeField(el) {
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
    reason: String(reason || '').trim(),
    type: (el.getAttribute('type') || el.tagName || '').toLowerCase(),
  };
}

function dedupeUnresolvedFields(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const label = typeof item === 'string' ? item : (item?.label || '');
    const reason = typeof item === 'string' ? '' : (item?.reason || '');
    const key = `${label}::${reason}`;
    if (!label || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchesPositiveChoice(text) {
  return /(yes|true|authorized|eligible|immediate|immediately|available now|open to relocate|remote|hybrid|agree|understand|will require|need sponsorship)/.test(text);
}

function matchesNegativeChoice(text) {
  return /(no|false|not now|do not|don't|without|none|prefer not|on site|onsite|will not require|do not require)/.test(text);
}

export function findBestSelectOptionValue(options = [], value = '') {
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
    if (option.normalizedValue === desired || option.normalizedText === desired) {
      return option;
    }
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

// ── Field value injection ─────────────────────────────────────────────────────

/**
 * Set the value of a form field and trigger the appropriate events.
 *
 * @param {HTMLElement} el
 * @param {string} value
 * @returns {boolean} true if the value was set
 */
function setFieldValue(el, value) {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();

  if (tag === 'select') {
    return setSelectValue(el, value);
  }

  if (type === 'checkbox') {
    const checked = /true|yes|1|agree|understand/i.test(value);
    if (el.checked !== checked) {
      el.checked = checked;
      dispatchEvents(el, ['input', 'change', 'click']);
    }
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
      dispatchEvents(match.option, ['input', 'change', 'click']);
      return true;
    }

    return false;
  }

  // text / textarea / number / email / tel / url
  setNativeInputValue(el, value);
  dispatchEvents(el, ['input', 'change', 'blur']);
  return true;
}

/**
 * Use React/Vue-compatible native input value setter to trigger framework
 * change detection (e.g., React controlled components).
 */
function setNativeInputValue(el, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
    'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }
}

function setSelectValue(el, value) {
  const match = findBestSelectOptionValue(Array.from(el.options).map((opt) => ({
    value: opt.value,
    text: opt.text,
    option: opt,
  })), value);

  if (!match?.option) return false;

  el.value = match.option.value;
  dispatchEvents(el, ['change']);
  return true;
}

function getRadioOptionText(radio) {
  if (radio.id) {
    const label = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
    if (label) return label.textContent || '';
  }
  return radio.closest('label')?.textContent || radio.parentElement?.textContent || '';
}

function hasMeaningfulValue(el) {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();

  if (type === 'radio' && el.name) {
    return Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
      .some((radio) => radio.checked);
  }

  if (type === 'checkbox') {
    const group = el.name
      ? Array.from(document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(el.name)}"]`))
      : [el];
    return group.some((checkbox) => checkbox.checked);
  }

  if (tag === 'select') return !!String(el.value || '').trim();
  return !!String(el.value || '').trim();
}

function dispatchEvents(el, events) {
  for (const type of events) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }
}

// ── Visual feedback ───────────────────────────────────────────────────────────

function highlightField(el) {
  const original = el.style.outline;
  el.style.outline = '2px solid #4ade80';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = original;
    el.style.outlineOffset = '';
  }, 3000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STANDARD_FIELD_PATTERNS = [
  'first name', 'last name', 'full name', 'name',
  'email', 'phone', 'mobile', 'address', 'city', 'state', 'zip', 'postal',
  'linkedin', 'github', 'portfolio', 'website',
  'resume', 'cv', 'cover letter',
  'salary', 'compensation',
  'start date', 'available',
  'work authorization', 'visa', 'sponsorship',
  'years of experience',
];

function isStandardField(text) {
  const normalized = normalizeLookupText(text);
  return STANDARD_FIELD_PATTERNS.some((p) => labelContainsPattern(normalized, normalizeLookupText(p)));
}

// Single words that name a field in a short label ("Address", "State") but are
// ordinary words inside a long question ("solutions to address recurring
// challenges", "Are you located within the United States?"). Match them only
// as whole words, and only in label-sized text.
const AMBIGUOUS_LABEL_WORDS = new Set(['address', 'state', 'name', 'available']);
const MAX_WORDS_FOR_AMBIGUOUS_LABEL = 8;

/** Both arguments are already normalized with normalizeLookupText. */
export function labelContainsPattern(text, pattern) {
  if (!text || !pattern) return false;
  if (!AMBIGUOUS_LABEL_WORDS.has(pattern)) return text.includes(pattern);
  return text.split(' ').length <= MAX_WORDS_FOR_AMBIGUOUS_LABEL
    && ` ${text} `.includes(` ${pattern} `);
}

function isQuestionLike(text) {
  const questionStarters = ['why', 'what', 'how', 'describe', 'tell us', 'explain', 'share', 'please provide'];
  const lower = text.toLowerCase();
  return questionStarters.some((s) => lower.startsWith(s));
}
