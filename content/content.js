/**
 * apply-bot — content.js
 * Classic (non-module) content script. Runs on job pages.
 * All JD extraction and form-filling logic is inlined here so no
 * ES module imports are needed (Chrome MV3 content scripts run as
 * classic scripts and do not support top-level import/export).
 */

const DRAFT_STORAGE_KEY = 'applicationDrafts';
let draftSaveTimer = null;
let draftRestoreTimer = null;
let draftPersistenceStarted = false;

function hasExtensionContext() {
  return !!(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local);
}

function isExtensionContextInvalidatedError(error) {
  const message = error?.message || String(error || '');
  return /Extension context invalidated/i.test(message);
}

function warnIfRelevant(prefix, error) {
  if (isExtensionContextInvalidatedError(error)) return;
  console.warn(prefix, error);
}

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Check if a hostname matches a domain or any of its subdomains.
 * E.g. matchesDomain('boards.greenhouse.io', 'greenhouse.io') → true
 *      matchesDomain('evil-greenhouse.io.attacker.com', 'greenhouse.io') → false
 *
 * @param {string} hostname
 * @param {string} domain
 * @returns {boolean}
 */
function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

// ── Message listener ──────────────────────────────────────────────────────────

const IS_TOP_FRAME = (() => {
  try { return window.top === window; } catch { return false; }
})();

/**
 * Validate the browser-verified application URL in the receiving frame.
 * Cross-origin referrers can be reduced to an origin by Referrer-Policy; in
 * that case the background has already verified the exact tab URL and targets
 * this specific documentId rather than broadcasting to a replacement document.
 */
function matchesExpectedFillDocument(expectedUrl) {
  if (typeof expectedUrl !== 'string') return false;
  let expected;
  try { expected = new URL(expectedUrl); } catch { return false; }
  if (expected.protocol !== 'https:' && expected.protocol !== 'http:') return false;
  if (IS_TOP_FRAME) return location.href === expected.href;
  if (expected.hash) return false;
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin !== expected.origin) return false;
    const originOnly = referrer.pathname === '/' && referrer.search === '';
    return originOnly || (referrer.pathname === expected.pathname && referrer.search === expected.search);
  } catch {
    return false;
  }
}

/**
 * With `all_frames: true`, the same content script runs in the top document and
 * in every (same- or cross-origin) iframe — e.g. the iCIMS application form,
 * which lives inside an iframe. `chrome.tabs.sendMessage` delivers to all of
 * them but only the first `sendResponse` wins, so each frame must decide whether
 * it owns a given message. Frames that don't own it return `false` (decline the
 * channel) and stay silent, letting the right frame answer.
 *
 * @param {object} msg
 * @returns {boolean}
 */
function frameOwnsMessage(msg) {
  switch (msg?.type) {
    case 'FILL_FORM':
      // Reject stale or unbound fill messages before reading questions or writing fields.
      if (!matchesExpectedFillDocument(msg.expectedUrl)) return false;
      return getFillableInputs().length > 0 && (!IS_TOP_FRAME || !pageEmbedsAtsFrame());
    case 'INJECT_ANSWERS':
      // The frame that actually contains the application fields fills them. A
      // host page that embeds an ATS form defers to that iframe, so the fill
      // (and its tracker entry) comes from one frame only.
      return getFillableInputs().length > 0 && (!IS_TOP_FRAME || !pageEmbedsAtsFrame());
    case 'FOCUS_FIELD':
      return !!findFieldForReviewTarget(msg.payload || {});
    case 'GET_JOB_INFO':
    case 'DETECT_ATS':
      // The embedded ATS form knows its own job; the host page only answers when
      // it has no embedded form.
      return IS_TOP_FRAME ? !pageEmbedsAtsFrame() : isEmbeddedAtsFormFrame();
    case 'FETCH_LINKEDIN_JOBS':
      return IS_TOP_FRAME;
    default:
      return IS_TOP_FRAME;
  }
}

// Hosts whose application form is commonly embedded in a career page's iframe.
const ATS_EMBED_HOST_RE = /greenhouse\.io|ashbyhq\.com|lever\.co|myworkdayjobs|icims\.com|jobvite\.com|phenompeople|phenom\.com/i;

/** True when this page shows a third-party ATS form inside one of its iframes. */
function pageEmbedsAtsFrame() {
  // An ATS's own page is never the host of an embed, even if it frames itself.
  if (ATS_EMBED_HOST_RE.test(location.hostname)) return false;
  return Array.from(document.querySelectorAll('iframe[src]'))
    .some((frame) => ATS_EMBED_HOST_RE.test(frame.getAttribute('src') || ''));
}

/** True for an embedded iframe that is an ATS page with fields to fill. */
function isEmbeddedAtsFormFrame() {
  return !IS_TOP_FRAME && detectAts() !== 'Generic' && getFillableInputs().length > 0;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!frameOwnsMessage(msg)) return false;
  handleMessage(msg, sendResponse).then((result) => {
    // Only call sendResponse here if handleMessage returned a value
    // (FETCH_LINKEDIN_JOBS calls sendResponse directly and returns undefined)
    if (result !== undefined) sendResponse(result);
  }).catch((err) => {
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

async function handleMessage(msg, sendResponse) {
  switch (msg.type) {
    case 'FILL_FORM':
      return handleFillForm(msg.expectedUrl);
    case 'INJECT_ANSWERS':
      return handleInjectAnswers(msg.payload);
    case 'GET_JOB_INFO':
      return handleGetJobInfo();
    case 'DETECT_ATS':
      return { ats: detectAts() };
    case 'FOCUS_FIELD':
      return handleFocusField(msg.payload);
    case 'FETCH_LINKEDIN_JOBS': {
      const { query, csrfToken } = msg.payload || {};
      const params = new URLSearchParams({
        keywords: query || '',
        start: '0',
        count: '25',
        origin: 'GLOBAL_SEARCH_HEADER',
        q: 'all',
      });
      const res = await fetch(`/voyager/api/jobs/search?${params}`, {
        headers: {
          'Csrf-Token': csrfToken || '',
          'X-Restli-Protocol-Version': '2.0.0',
          'Accept': 'application/vnd.linkedin.normalized+json+2.1',
        },
      });
      if (!res.ok) {
        sendResponse({ success: false, error: `LinkedIn responded ${res.status}` });
        return;
      }
      const data = await res.json();
      sendResponse({ success: true, data });
      return;
    }
    default:
      throw new Error('Unknown message: ' + msg.type);
  }
}

// ── Fill form flow ────────────────────────────────────────────────────────────

async function handleFillForm(expectedUrl) {
  if (!matchesExpectedFillDocument(expectedUrl)) throw new Error('The application page navigated or changed. Try Fill again on the intended tab.');
  // 1. Extract JD + job meta
  const { jd, company, title, location: jobLocation, employment_type, remote, salary_range } = extractJobInfo();

  // 2. Collect any custom open-ended questions
  const customQuestions = collectCustomQuestions();

  // 3. Ask service worker to generate answers via Gemini
  const resp = await chrome.runtime.sendMessage({
    type: 'GENERATE_ANSWERS',
    payload: { jd, customQuestions, pageUrl: location.href },
  });

  if (!resp?.success) {
    throw new Error(resp?.error || 'Failed to generate answers');
  }
  if (!matchesExpectedFillDocument(expectedUrl)) throw new Error('The application page navigated or changed. Try Fill again on the intended tab.');

  const answers = resp.answers;
  const warning = resp.warning || null;

  // 4. Merge custom answers into flat map
  if (answers.custom_answers && typeof answers.custom_answers === 'object') {
    for (const [q, a] of Object.entries(answers.custom_answers)) {
      answers[q] = a;
    }
  }

  // 5. Revalidate after async work, immediately before writing any field values.
  const fieldMap = await loadFieldMap();
  if (!matchesExpectedFillDocument(expectedUrl)) throw new Error('The application page navigated or changed. Try Fill again on the intended tab.');
  const report = fillForm(answers, fieldMap);
  const combos = await fillComboboxes(answers, fieldMap).catch(() => ({ filled: 0, unresolved: [] }));
  report.filled += combos.filled;
  report.unresolved = dedupeUnresolvedFields([...report.unresolved, ...combos.unresolved]);
  report.resume = await attachSavedResume().catch((err) => ({ attached: 0, reason: 'error', error: err?.message }));

  // 6. Log the application
  await chrome.runtime.sendMessage({
    type: 'LOG_APPLICATION',
    payload: {
      company,
      title,
      url: jobPageUrl(),
      status: 'filled',
      jd_snippet: jd.slice(0, 300),
      description: jd.slice(0, 6000),
      location: jobLocation,
      employment_type,
      remote,
      salary_range,
      answers_generated: true,
      fill_report: report,
    },
  });

  return { success: true, filled: report.filled, company, title, warning, report };
}

async function handleInjectAnswers(answers) {
  if (!answers) throw new Error('No answers to inject');
  const fieldMap = await loadFieldMap();
  const report = fillForm(answers, fieldMap);
  return { success: true, filled: report.filled, report };
}

async function handleGetJobInfo() {
  const info = extractJobInfo();
  return {
    success: true,
    job: {
      ...info,
      url: jobPageUrl(),
    },
  };
}

async function handleFocusField(target = {}) {
  const field = findFieldForReviewTarget(target);
  if (!field) {
    return { success: false, error: 'Could not find that field on the page. It may have moved or already been completed.' };
  }

  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  try {
    field.focus({ preventScroll: true });
  } catch {
    field.focus();
  }
  highlightField(field);

  return { success: true, label: describeField(field) };
}

// ── Load field-map.json ───────────────────────────────────────────────────────

async function loadFieldMap() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_FIELD_MAP' });
    return response?.success === false ? {} : (response || {});
  } catch {
    return {};
  }
}

// ── JD extraction (inlined from lib/jd-parser.js) ────────────────────────────

function extractJobInfo() {
  const hostname = location.hostname;
  let info;
  if (matchesDomain(hostname, 'greenhouse.io')) info = extractGreenhouse();
  else if (matchesDomain(hostname, 'ashbyhq.com') || matchesDomain(hostname, 'ashby.io')) info = extractAshby();
  else if (matchesDomain(hostname, 'lever.co')) info = extractLever();
  else if (matchesDomain(hostname, 'linkedin.com')) info = extractLinkedIn();
  else if (isWorkdayHost(hostname)) info = extractWorkday();
  else if (matchesDomain(hostname, 'icims.com')) info = extractICIMS();
  else if (matchesDomain(hostname, 'jobvite.com')) info = extractJobvite();
  else if (matchesDomain(hostname, 'circle.com') || matchesDomain(hostname, 'phenompeople.com')) info = extractPhenom();
  else info = extractGenericJobInfo();

  // Structured data (schema.org JobPosting) is the most reliable source for
  // salary / employment type / location, so capture it when present.
  info._ld = parseJobPostingJsonLd(readJsonLdObjects());

  return enrichJobInfo(info);
}

function isGreenhouseEmbed() {
  return matchesDomain(location.hostname, 'greenhouse.io') && /^\/embed\/job_app\/?$/.test(location.pathname);
}

/**
 * Greenhouse's embedded application (job-boards.greenhouse.io/embed/job_app)
 * has no job header; the job sits in the page's Remix data as `jobPost`.
 */
function greenhouseEmbedJob() {
  for (const script of document.scripts) {
    const text = script.textContent || '';
    const start = text.indexOf('"jobPost":{');
    if (start === -1) continue;
    const post = text.slice(start);
    const field = (name) => {
      const match = post.match(new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`));
      try { return match ? JSON.parse(`"${match[1]}"`) : ''; } catch { return ''; }
    };
    return { title: field('title'), publicUrl: field('public_url') };
  }
  return { title: '', publicUrl: '' };
}

/**
 * URL to record for a job. The embed's own URL is a one-time token link, so an
 * embedded Greenhouse form records the company's job page: the referrer when it
 * names a page, otherwise the embed's public_url (the same job page, with gh_jid).
 */
function jobPageUrl() {
  if (!isGreenhouseEmbed()) return location.href;
  try {
    const referrer = new URL(document.referrer);
    if ((referrer.protocol === 'https:' || referrer.protocol === 'http:') && (referrer.pathname !== '/' || referrer.search)) {
      return document.referrer;
    }
  } catch { /* no referrer */ }
  return greenhouseEmbedJob().publicUrl || location.href;
}

function extractGreenhouse() {
  if (isGreenhouseEmbed()) {
    return {
      title: greenhouseEmbedJob().title || qs('#header h1, .app-title, h1')?.textContent?.trim() || '',
      jd: qs('#content, #app_body, .content')?.innerText?.trim() || extractGenericText(),
    };
  }
  return {
    title: qs('#header h1, .app-title, h1')?.textContent?.trim() || '',
    company: qs('#header .company-name, .company')?.textContent?.trim() || '',
    jd: qs('#content, #app_body, .content')?.innerText?.trim() || extractGenericText(),
  };
}

function extractAshby() {
  return {
    title: qs('h1[data-testid="job-title"], h1.ashby-job-posting-heading, h1')?.textContent?.trim() || '',
    company: qs('.ashby-application-portal-name, [data-testid="company-name"]')?.textContent?.trim() || '',
    jd: qs('.ashby-job-posting-brief-list, .ashby-job-posting-description, main')?.innerText?.trim() || extractGenericText(),
  };
}

function extractLever() {
  return {
    title: qs('.posting-header h2, h2.posting-title')?.textContent?.trim() || '',
    company: qs('.main-header-logo img')?.alt?.trim() || '',
    jd: qs('.posting-description, section.page-centered')?.innerText?.trim() || extractGenericText(),
  };
}

function extractLinkedIn() {
  return {
    title: qs('.job-details-jobs-unified-top-card__job-title, h1.t-24')?.textContent?.trim() || '',
    company: qs('.job-details-jobs-unified-top-card__company-name, a.ember-view')?.textContent?.trim() || '',
    jd: qs('#job-details, .jobs-description__content, .jobs-description-content__text')?.innerText?.trim() || extractGenericText(),
  };
}

function extractWorkday() {
  return {
    title: qs('[data-automation-id="jobPostingHeader"], h2.css-9xh9yi')?.textContent?.trim() || '',
    company: document.title.split('|')?.[1]?.trim() || '',
    jd: qs('[data-automation-id="job-description"], .css-qdtm9x')?.innerText?.trim() || extractGenericText(),
  };
}

function extractICIMS() {
  return {
    title: qs('.iCIMS_JobHeaderTitle, #iCIMS_MainColumn h1')?.textContent?.trim() || '',
    company: qs('.iCIMS_CompanyLogo img')?.alt || '',
    jd: qs('#iCIMS_JobContent, .iCIMS_JobContent')?.innerText?.trim() || extractGenericText(),
  };
}

function extractJobvite() {
  return {
    title: qs('[data-qa="job-title"], h1, .job-title')?.textContent?.trim() || '',
    company: qs('[data-qa="company-name"], .company-name')?.textContent?.trim() || '',
    jd: qs('[data-qa="job-description"], .job-description, main')?.innerText?.trim() || extractGenericText(),
  };
}

function extractPhenom() {
  return {
    title: qs('[data-ph-id="ph-page-element-page16-j5r8i0"], h1, [class*="job-title"]')?.textContent?.trim() || '',
    company: qs('[class*="company"], [data-qa="company-name"]')?.textContent?.trim() || '',
    jd: qs('[class*="job-description"], [data-qa="job-description"], main')?.innerText?.trim() || extractGenericText(),
  };
}

function extractGenericJobInfo() {
  return {
    title: qs('h1, h2')?.textContent?.trim() || '',
    company: '',
    jd: extractGenericText(),
  };
}

function enrichJobInfo(info = {}) {
  const ld = info._ld || null;
  const jd = String(info.jd || (ld && ld.description) || extractGenericText() || '');
  const locationText = firstNonEmptyText(
    info.location,
    ld && ld.location,
    extractLocationFromPage(),
    extractLocationFromText(jd),
    'Unknown'
  );

  // Company: the page's own company element, then schema.org, then the tab
  // title ("Role @ Company"), then the ATS board slug in the URL. The raw tab
  // title is never used whole: it's usually "<role> @ <company>".
  const company = cleanCompanyName(firstNonEmptyText(
    info.company,
    ld && ld.company,
    companyFromTitleText(document.title),
    companyFromUrl(location.href)
  ));

  const result = {
    ...info,
    title: cleanJobTitle(info.title || (ld && ld.title) || '', company),
    company,
    jd,
    location: locationText || 'Unknown',
    employment_type: (ld && ld.employment_type) || detectEmploymentTypeFromText(`${info.title || ''}\n${jd}`),
    remote: ld?.remote !== undefined ? ld.remote : detectRemoteFromText(`${locationText}\n${jd}`),
    salary_range: (ld && ld.salary_range) || extractSalaryRangeFromText(jd),
    // _dataSource lets the UI show a confidence hint: json-ld beats DOM scraping.
    _dataSource: ld ? 'json-ld' : 'dom',
  };
  delete result._ld;
  return result;
}

// ── Company / title cleanup ───────────────────────────────────────────────────

function isWorkdayHost(hostname) {
  return matchesDomain(hostname, 'workday.com') || matchesDomain(hostname, 'myworkdayjobs.com');
}

function collapseText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/** "Careers at Acme" / "Acme Careers" / "Acme | Jobs" → "Acme". */
function stripCareersNoise(name) {
  return collapseText(name)
    .replace(/\s+[|·–—-]\s+.*$/, '')
    .replace(/^(?:careers|jobs)\s+(?:at|@)\s+/i, '')
    .replace(/\s+(?:careers|jobs|job board|hiring)$/i, '')
    .trim();
}

/**
 * Pull the company out of a tab title such as "Staff Engineer @ Acme" or
 * "Job Application for Staff Engineer at Acme". Returns '' when the title
 * doesn't name one; a bare title is never treated as a company.
 */
function companyFromTitleText(text) {
  const t = collapseText(text);
  const match = t.match(/^job application for .+? at (.+)$/i)
    || t.match(/^.+? @ (.+)$/)
    || t.match(/^.+? at ([A-Z0-9][^|–—]*?)(?:\s+[|–—-]\s+.*)?$/);
  return match ? stripCareersNoise(match[1]) : '';
}

/** Company slug from hosted ATS board URLs (jobs.ashbyhq.com/acme/…, jobs.lever.co/acme/…, boards.greenhouse.io/acme/…). */
function companyFromUrl(href) {
  let url;
  try { url = new URL(href); } catch { return ''; }
  const host = url.hostname;
  let slug = '';
  if (matchesDomain(host, 'greenhouse.io')) slug = url.searchParams.get('for') || url.pathname.split('/')[1] || '';
  else if (matchesDomain(host, 'ashbyhq.com') || matchesDomain(host, 'lever.co')) slug = url.pathname.split('/')[1] || '';
  if (!slug || /^(?:embed|jobs?|job_app|v\d+|api)$/i.test(slug)) return '';
  return decodeURIComponent(slug)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function cleanCompanyName(name, hostname = location.hostname) {
  let text = collapseText(name);
  // A "<role> @ <company>" string that reached the company slot.
  const at = text.match(/^.+? @ (.+)$/);
  if (at) text = at[1].trim();
  // Workday's hiringOrganization carries the legal-entity code: "100 Everfox Holdings, LLC".
  if (isWorkdayHost(hostname)) text = text.replace(/^\d{2,5}\s+(?=\D)/, '');
  return text;
}

/** Drop flow-page prefixes ("My Application - …") and a trailing "at/@ <company>". */
function cleanJobTitle(title, company = '') {
  let text = collapseText(title)
    .replace(/^(?:(?:my |job )?application\s*(?:for\b|[-–—:|])|apply(?: now)? for\b)\s*/i, '');
  if (company) {
    const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\s+(?:@|at|[-–—|])\\s+${escaped}$`, 'i'), '');
  }
  return text.trim();
}

// ── JSON-LD JobPosting (schema.org) — inlined pure copy of lib/jd-parser.js ────

function readJsonLdObjects() {
  const out = [];
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { out.push(JSON.parse(el.textContent || '')); } catch { /* ignore malformed */ }
  }
  return out;
}

function parseJobPostingJsonLd(ldObjects = []) {
  const postings = collectJobPostings(ldObjects);
  if (!postings.length) return null;
  const p = postings[0];
  return {
    title: ldText(p.title),
    company: ldText(p.hiringOrganization?.name ?? p.hiringOrganization),
    location: parseJsonLdLocation(p.jobLocation),
    employment_type: normalizeJsonLdEmploymentType(p.employmentType),
    remote: isJsonLdRemote(p),
    salary_range: parseJsonLdSalary(p.baseSalary || p.estimatedSalary),
    description: stripLdHtml(ldText(p.description)).slice(0, 6000),
    url: ldText(p.url),
    datePosted: ldText(p.datePosted),
  };
}

function collectJobPostings(ldObjects = []) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (Array.isArray(node['@graph'])) node['@graph'].forEach(visit);
    const type = node['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) out.push(node);
  };
  (Array.isArray(ldObjects) ? ldObjects : [ldObjects]).forEach(visit);
  return out;
}

function ldText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function stripLdHtml(value) {
  return String(value || '')
    .replace(/&(?:amp|lt|gt|nbsp|#\d+|#[xX][0-9a-fA-F]+|quot|apos);/g, (m) => {
      switch (m) {
        case "&" + "amp;": return "&";
        case "&" + "lt;": return "<";
        case "&" + "gt;": return ">";
        case "&nbsp;": return " ";
        case "&" + "quot;": return '"';
        case "&apos;": return "'";
      }
      if (m.startsWith("&#x") || m.startsWith("&#X")) {
        const cp = parseInt(m.slice(3, -1), 16);
        return cp <= 0x10FFFF ? String.fromCodePoint(cp) : " ";
      }
      if (m.startsWith("&#")) {
        const cp = parseInt(m.slice(2, -1), 10);
        return cp <= 0x10FFFF ? String.fromCodePoint(cp) : " ";
      }
      return " ";
    })
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonLdLocation(jobLocation) {
  const loc = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  const addr = loc?.address || loc;
  if (!addr || typeof addr !== 'object') return '';
  const country = ldText(addr.addressCountry?.name ?? addr.addressCountry);
  return [ldText(addr.addressLocality), ldText(addr.addressRegion), country].filter(Boolean).join(', ');
}

function normalizeJsonLdEmploymentType(employmentType) {
  const raw = Array.isArray(employmentType) ? employmentType[0] : employmentType;
  const t = String(raw || '').toUpperCase();
  if (!t) return '';
  if (t.includes('PART')) return 'Part-time';
  if (t.includes('CONTRACT')) return 'Contract';
  if (t.includes('INTERN')) return 'Internship';
  if (t.includes('TEMP')) return 'Temporary';
  if (t.includes('FULL')) return 'Full-time';
  return '';
}

function isJsonLdRemote(posting) {
  if (String(posting.jobLocationType || '').toUpperCase().includes('TELECOMMUTE')) return true;
  return /\bremote\b|telecommute|work from home|wfh/i.test(`${ldText(posting.title)} ${ldText(posting.description)}`);
}

function parseJsonLdSalary(baseSalary) {
  if (!baseSalary || typeof baseSalary !== 'object') return '';
  const currency = baseSalary.currency || baseSalary.currencyCode || 'USD';
  const sym = currency === 'USD' ? '$' : `${currency} `;
  const v = baseSalary.value;
  const num = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null);
  let min = null;
  let max = null;
  let unit = '';
  if (v && typeof v === 'object') {
    min = num(v.minValue);
    max = num(v.maxValue);
    unit = v.unitText || '';
    if (min == null && max == null) min = num(v.value);
  } else {
    min = num(v);
  }
  const fmt = (n) => `${sym}${Math.round(n).toLocaleString()}`;
  const suffix = /hour/i.test(String(unit)) ? '/hr' : '';
  if (min != null && max != null && min !== max) return `${fmt(min)} - ${fmt(max)}${suffix}`;
  if (min != null) return `${fmt(min)}${suffix}`;
  if (max != null) return `${fmt(max)}${suffix}`;
  return '';
}

function extractLocationFromPage() {
  const selectors = [
    '[data-automation-id="locations"]',
    '[data-testid*="location"]',
    '.posting-categories .sort-by-location',
    '.job-details-jobs-unified-top-card__tertiary-description',
    '.topcard__flavor--bullet',
    '.job-location',
    '[itemprop="jobLocation"]',
    '[class*="location"]',
  ];

  for (const selector of selectors) {
    const text = qs(selector)?.textContent?.trim();
    if (text && text.length <= 120) return text;
  }

  return '';
}

function extractLocationFromText(text = '') {
  const normalized = String(text || '');
  const match = normalized.match(/(?:location|based in|work location)\s*:?\s*([^\n|]+)/i);
  if (match?.[1]) return match[1].trim();
  return /\bremote\b/i.test(normalized) ? 'Remote' : '';
}

function detectEmploymentTypeFromText(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (/part[ -]?time/.test(normalized)) return 'Part-time';
  if (/contract|contractor/.test(normalized)) return 'Contract';
  if (/intern(ship)?/.test(normalized)) return 'Internship';
  if (/temporary|temp\b/.test(normalized)) return 'Temporary';
  return 'Full-time';
}

function detectRemoteFromText(text = '') {
  return /\bremote\b|hybrid|work from home|wfh/i.test(String(text || ''));
}

function extractSalaryRangeFromText(text = '') {
  const match = String(text || '').match(/\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|K|\/hr|\/year)?\s*(?:-|–|to)\s*\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:k|K|\/hr|\/year)?/);
  return match ? match[0].replace(/\s+/g, ' ').trim() : '';
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function extractGenericText() {
  const JD_KEYWORDS = ['responsibilities', 'qualifications', 'requirements', 'experience', 'skills', 'about', 'role', 'position'];
  const candidates = Array.from(document.querySelectorAll(
    'article, section, main, .job-description, [class*="description"], [id*="description"], [class*="posting"], [id*="posting"]'
  ));
  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    const text = el.innerText || '';
    if (text.length < 200) continue;
    const lower = text.toLowerCase();
    const kwHits = JD_KEYWORDS.filter((kw) => lower.includes(kw)).length;
    const score = kwHits * 100 + text.length;
    if (score > bestScore) { bestScore = score; best = text; }
  }
  return best || document.body.innerText.slice(0, 8000);
}

function qs(selector) {
  try { return document.querySelector(selector); } catch { return null; }
}

// ── Custom question collector (inlined from lib/form-filler.js) ───────────────

function collectCustomQuestions() {
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
    // Required labels end in a marker ("…United States?*"); judge the question without it.
    const text = label.textContent?.trim().replace(/\s*\*+$/, '');
    if (!text || text.length < 10 || text.length > 500) continue;
    const lower = text.toLowerCase();
    const normalized = normalizeLookupText(text);
    if (STANDARD.some((s) => labelContainsPattern(normalized, normalizeLookupText(s)))) continue;
    if (SENSITIVE.some((s) => lower.includes(s))) continue;
    if (text.endsWith('?') || QUESTION_STARTERS.some((s) => lower.startsWith(s))) {
      questions.push(text);
    }
  }
  return [...new Set(questions)];
}

// ── Form filler (inlined from lib/form-filler.js) ────────────────────────────

function getFillableInputs() {
  return Array.from(document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]), textarea, select'
  )).filter((el) => {
    if (el.disabled || el.readOnly) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // Helper inputs widgets hide from users (react-select's "required" stand-in).
    if (el.getAttribute('aria-hidden') === 'true' && el.tabIndex < 0) return false;
    // Yes/No button groups keep a hidden checkbox in sync; answer them by
    // clicking the button instead (see fillYesNoButtonGroups). Type-ahead
    // comboboxes need an option picked (see fillComboboxes).
    return !el.closest(YES_NO_GROUP_SELECTOR) && !el.matches(COMBOBOX_SELECTOR);
  });
}

function fillForm(answers, fieldMap) {
  const inputs = getFillableInputs();

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
      rememberAutofill(input);
      highlightField(input);
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
  queueDraftSave();
  return { filled, preserved, skipped, unresolved: uniqueUnresolved };
}

function resolveFieldKey(el, fieldMap, answers = {}, { includeContext = true } = {}) {
  const candidates = [
    el.name,
    el.id,
    el.getAttribute('placeholder'),
    el.getAttribute('aria-label'),
    el.getAttribute('data-label'),
    getAssociatedLabelText(el),
    // Section text can name a different field ("Location" a few rows up), so
    // callers that act on a single widget use only the label it owns.
    includeContext ? getFieldContextText(el) : getOwnFieldLabel(el),
  ].filter(Boolean);

  return resolveAnswerKeyFromCandidates(candidates, fieldMap, answers);
}

/** The label a widget owns: aria-labelledby, or the label heading its own field entry. */
function getOwnFieldLabel(el) {
  const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(' ');
  if (labelledBy) return labelledBy;
  const entry = el.closest('.ashby-application-form-field-entry, .field, .application-question');
  return entry?.querySelector('label, legend')?.textContent?.trim() || '';
}

function resolveAnswerKeyFromCandidates(candidates, fieldMap = {}, answers = {}) {
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
      // Last resort: a saved answer whose question sits inside this label, or
      // a label that is part of a saved question. Whole words only, and a
      // one-word key only in label-sized text, so "share their name" doesn't
      // take the "name" answer and "the United States" doesn't take "state".
      if (containsWholeWords(candidate, normalizedKey)
        || (candidate.split(' ').length >= 3 && containsWholeWords(normalizedKey, candidate))) {
        return key;
      }
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

function setFieldValue(el, value) {
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
  // Bracket the change with focus events like a real click-in / tab-out: React
  // runs onBlur on focusout (not blur), and some ATS forms (Ashby) only commit
  // a typed value to their form model in onBlur, so without it a visibly
  // filled field still fails "Missing entry for required field" on submit.
  fireEvents(el, ['focus', 'focusin']);
  if (setter) setter.call(el, value); else el.value = value;
  fireEvents(el, ['input', 'change', 'blur', 'focusout']);
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
    return getCheckboxGroupMembers(el).some((checkbox) => checkbox.checked);
  }

  if (tag === 'select') return !!String(el.value || '').trim();
  return !!String(el.value || '').trim();
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
  // A radio/checkbox group is one question to review, not one item per option.
  const type = (el.getAttribute('type') || '').toLowerCase();
  const members = type === 'radio'
    ? (el.name ? document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`) : [el])
    : type === 'checkbox' ? getCheckboxGroupMembers(el) : [el];
  const groupLabel = members.length > 1 ? getChoiceGroupLabel(el) : '';
  if (groupLabel) {
    return {
      label: groupLabel,
      draftKey: `group:${normalizeLookupText(groupLabel)}`,
      type,
      reason: String(reason || '').trim(),
    };
  }
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

function findFieldForReviewTarget(target = {}) {
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

/** The question a radio/checkbox group answers, or '' when the page doesn't say. */
function getChoiceGroupLabel(el) {
  const fieldset = el.closest('fieldset');
  const legend = fieldset?.querySelector('legend')?.textContent;
  if (legend?.trim()) return legend.trim();

  const group = el.closest('[role="radiogroup"], [role="group"]');
  const labelledBy = group?.getAttribute('aria-labelledby');
  const groupLabel = group?.getAttribute('aria-label')
    || (labelledBy && document.getElementById(labelledBy)?.textContent);
  if (groupLabel?.trim()) return groupLabel.trim();

  // Ashby/Greenhouse-style entries: a heading label above the options.
  const entry = el.closest('.ashby-application-form-field-entry, .field, .application-question');
  const heading = Array.from(entry?.querySelectorAll('label, legend') || [])
    .find((node) => !node.contains(el) && !node.querySelector('input'));
  return heading?.textContent?.trim() || '';
}

/**
 * Placeholders an AI writes when it has no answer ("Not specified in the
 * provided information.", "N/A"). They are not filled; the field is left for
 * the user.
 */
function isNonAnswer(value) {
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

// ── Autofill provenance ───────────────────────────────────────────────────────
// Values ats-fill typed (and the user has not changed since) are not the
// user's answers: the next Fill regenerates them. Keeping them out of page
// drafts and learned memory stops one bad fill from coming back on every
// reload and from being "kept" or reused on other applications.

const autofilledSignatures = new WeakMap();

function rememberAutofill(el) {
  autofilledSignatures.set(el, getFieldSignature(el));
}

function isUntouchedAutofill(el) {
  return autofilledSignatures.has(el) && autofilledSignatures.get(el) === getFieldSignature(el);
}

function getFieldSignature(el) {
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'radio') {
    const radios = el.name
      ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
      : [el];
    const checked = radios.find((radio) => radio.checked);
    return `radio:${checked ? getChoiceIdentity(checked) : ''}`;
  }
  if (type === 'checkbox') return `checkbox:${el.checked}`;
  return `value:${el.value}`;
}

function isUntouchedAutofillGroup(members) {
  return members.some((member) => isUntouchedAutofill(member));
}

// Single words that name a field in a short label ("Address", "State") but are
// ordinary words inside a long question ("solutions to address recurring
// challenges", "Are you located within the United States?"). Match them only
// as whole words, and only in label-sized text.
const AMBIGUOUS_LABEL_WORDS = new Set(['address', 'state', 'name', 'available']);
const MAX_WORDS_FOR_AMBIGUOUS_LABEL = 8;

/** Both arguments are already normalized with normalizeLookupText. */
function containsWholeWords(text, phrase) {
  if (!text || !phrase || !` ${text} `.includes(` ${phrase} `)) return false;
  return phrase.includes(' ') || text.split(' ').length <= MAX_WORDS_FOR_AMBIGUOUS_LABEL;
}

/** Both arguments are already normalized with normalizeLookupText. */
function labelContainsPattern(text, pattern) {
  if (!text || !pattern) return false;
  if (!AMBIGUOUS_LABEL_WORDS.has(pattern)) return text.includes(pattern);
  return text.split(' ').length <= MAX_WORDS_FOR_AMBIGUOUS_LABEL
    && ` ${text} `.includes(` ${pattern} `);
}

// ── Yes/No button groups (Ashby) ──────────────────────────────────────────────

const YES_NO_GROUP_SELECTOR = '.ashby-application-form-input-yesno';

function fillYesNoButtonGroups(answers = {}, fieldMap = {}) {
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
    if (!value || isNonAnswer(value)) {
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
    highlightField(button);
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
function parseYesNoAnswer(value) {
  if (isNonAnswer(value)) return null; // "No answer" is not a "no"
  const text = String(value || '').trim().toLowerCase();
  if (/^(yes|y|true)\b/.test(text)) return 'yes';
  if (/^(no|n|false)\b/.test(text)) return 'no';
  return null;
}

// ── Type-ahead comboboxes (react-select on Greenhouse, Ashby autocomplete) ───
// These keep the chosen option in component state, not in the input's value,
// so setting .value does nothing. Open the menu the way a pointer would,
// type a search, wait for options, then click the one that matches.

const COMBOBOX_SELECTOR = 'input[role="combobox"][aria-autocomplete="list"]';
const COMBOBOX_OPTION_TIMEOUT_MS = 6000;

const US_STATES = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois',
  in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
  ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york',
  nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
  ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah',
  vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
};

async function fillComboboxes(answers = {}, fieldMap = {}) {
  let filled = 0;
  const unresolved = [];

  for (const input of document.querySelectorAll(COMBOBOX_SELECTOR)) {
    if (input.disabled || input.closest('.iti')) continue; // phone-number country pickers manage themselves
    if (getComboboxSelectedText(input)) continue;

    const key = resolveFieldKey(input, fieldMap, answers, { includeContext: false });
    const value = key ? answers[key] : '';
    if (!value || isNonAnswer(value)) {
      if (input.required || input.getAttribute('aria-required') === 'true') {
        unresolved.push({ label: describeField(input), reason: 'No matching saved answer yet', type: 'combobox' });
      }
      continue;
    }

    const option = await chooseComboboxOption(input, String(value), describeField(input));
    if (option) {
      filled++;
      highlightField(input.closest('[class*="__control"]') || input);
    } else {
      unresolved.push({ label: describeField(input), reason: `No option matched "${value}"`, type: 'combobox' });
    }
  }

  return { filled, unresolved };
}

async function chooseComboboxOption(input, value, label = '') {
  openCombobox(input);
  await delay(150);
  // Short fixed lists (Yes/No, veteran status) are matched without typing,
  // since a search for "US Citizen" would filter the right option away.
  let options = getComboboxOptions(input);
  let match = options.length && options.length <= 12
    ? pickComboboxOption(options, value) || pickComboboxFallback(options, value, label)
    : null;

  if (!match) {
    // Search by the most specific part ("Reston, VA" → "Reston"), match on all of it.
    setComboboxQuery(input, value.split(',')[0].trim());
    const deadline = Date.now() + COMBOBOX_OPTION_TIMEOUT_MS;
    let lastCount = -1;
    let stablePolls = 0;
    while (Date.now() < deadline) {
      await delay(250);
      options = getComboboxOptions(input);
      if (!options.length) {
        // react-select shows "No options" once the search matched nothing.
        if (document.querySelector('[class*="menu-notice--no-options"]')) break;
        continue;
      }
      // Async sources (location search) can show a stale list first; keep
      // polling until a match shows up or the list stops changing.
      match = pickComboboxOption(options, value);
      if (match) break;
      stablePolls = options.length === lastCount ? stablePolls + 1 : 0;
      lastCount = options.length;
      if (stablePolls >= 3) {
        match = pickComboboxFallback(options, value, label);
        break;
      }
    }
  }

  if (match) {
    match.scrollIntoView?.({ block: 'nearest' });
    match.click();
    await delay(150);
    if (getComboboxSelectedText(input)) return match;
  }

  // Leave nothing half-typed behind.
  setComboboxQuery(input, '');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return null;
}

function openCombobox(input) {
  const control = input.closest('[class*="__control"]') || input.parentElement;
  // react-select opens on mousedown over the control, but ignores it on the input itself.
  const target = control?.querySelector('[class*="__indicators"], [class*="__value-container"]')
    || input.closest('[class*="inputContainer"]')?.querySelector('button')
    || control;
  input.focus({ preventScroll: true });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    const EventType = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    target?.dispatchEvent(new EventType(type, { bubbles: true, cancelable: true, button: 0 }));
  }
}

function setComboboxQuery(input, query) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, query); else input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function getComboboxOptions(input) {
  const listIds = [input.getAttribute('aria-controls'), input.getAttribute('aria-owns')].filter(Boolean);
  const scoped = listIds.flatMap((id) => Array.from(document.getElementById(id)?.querySelectorAll('[role="option"]') || []));
  if (scoped.length) return scoped;
  if (input.id) {
    const reactSelect = Array.from(document.querySelectorAll(`[id^="react-select-${CSS.escape(input.id)}-option"]`));
    if (reactSelect.length) return reactSelect;
  }
  return Array.from(document.querySelectorAll('[role="option"]'))
    .filter((option) => !option.closest('.iti') && option.offsetParent !== null);
}

function getComboboxSelectedText(input) {
  const control = input.closest('[class*="__control"]');
  return control?.querySelector('[class*="single-value"], [class*="multi-value__label"]')?.textContent?.trim() || '';
}

/**
 * The option containing every word of the answer (US states and countries
 * spelled out) with the fewest extra words, or null when none contains them all.
 */
function pickComboboxOption(options, value) {
  const wanted = expandPlaceWords(normalizeLookupText(value)).split(' ').filter(Boolean);
  if (!wanted.length) return null;
  let best = null;
  let bestExtra = Infinity;
  for (const option of options) {
    const words = expandPlaceWords(normalizeLookupText(option.textContent)).split(' ').filter(Boolean);
    const padded = ` ${words.join(' ')} `;
    if (!wanted.every((word) => padded.includes(` ${word} `))) continue;
    const extra = words.length - wanted.length;
    if (extra < bestExtra) { best = option; bestExtra = extra; }
  }
  return best;
}

/**
 * When no option contains the answer's words: Yes/No lists take an explicit
 * yes/no (or "US citizen"-style answers to work-authorization questions),
 * gender words map to the list's wording, and short answers ("No") fall back
 * to the same scoring native <select> fills use. Anything else is left for
 * the user.
 */
function pickComboboxFallback(options, value, label = '') {
  const texts = options.map((option) => normalizeLookupText(option.textContent));

  // "Prefer not to say" is worded differently on every form.
  const declinePattern = /prefer not|decline|don t wish|do not wish|rather not|choose not/;
  if (declinePattern.test(normalizeLookupText(value))) {
    return options.find((option, index) => declinePattern.test(texts[index])) || null;
  }

  const isYesNoList = texts.every((text) => /^(yes|no|i don t wish to answer|prefer not to say|decline to answer)$/.test(text));
  if (isYesNoList) {
    let choice = parseYesNoAnswer(value);
    const isWorkStatus = /\b(citizen|authori[sz]ed|permanent resident|green card)\b/i.test(value);
    if (!choice && isWorkStatus && /sponsor/i.test(label)) choice = 'no';
    else if (!choice && isWorkStatus && /authori[sz]ed|eligible|legally/i.test(label)) choice = 'yes';
    return choice ? options[texts.indexOf(choice)] || null : null;
  }

  const genderWords = { male: 'man', female: 'woman', man: 'male', woman: 'female' };
  const swapped = normalizeLookupText(value).split(' ').map((word) => genderWords[word] || word).join(' ');
  const bySynonym = pickComboboxOption(options, swapped);
  if (bySynonym) return bySynonym;

  if (normalizeLookupText(value).split(' ').length > 3) return null;
  const scored = findBestSelectOptionValue(
    options.map((option) => ({ value: option.textContent, text: option.textContent, option })),
    value,
  );
  return scored?.option || null;
}

function expandPlaceWords(text) {
  return String(text || '').split(' ').map((word) => {
    if (US_STATES[word]) return US_STATES[word];
    if (word === 'us' || word === 'usa') return 'united states';
    if (word === 'uk') return 'united kingdom';
    return word;
  }).join(' ');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Resume attachment ─────────────────────────────────────────────────────────

const RESUME_INPUT_PATTERN = /\b(resume|cv|curriculum vitae)\b/i;
const NOT_RESUME_INPUT_PATTERN = /\b(cover letter|transcript|portfolio|writing sample|autofill|auto-fill|parse)\b/i;

/**
 * Attach the saved resume file to upload fields labelled Resume/CV.
 * Only real uploaded files are attached (never a text preview), only to empty
 * inputs, and never to "autofill from resume" dropzones that would overwrite
 * the answers ats-fill just filled.
 */
async function attachSavedResume() {
  const settings = (await chrome.storage.local.get('settings')).settings || {};
  if (settings.auto_attach_resume === false) return { attached: 0, reason: 'off' };

  const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
    .filter((input) => !input.disabled && !(input.files && input.files.length) && isResumeFileInput(input));
  if (!inputs.length) return { attached: 0, reason: 'no-field' };

  const response = await chrome.runtime.sendMessage({ type: 'GET_RESUME_ATTACHMENT' }).catch(() => null);
  const attachment = response?.attachment;
  if (!attachment || attachment.downloadMode !== 'data-url' || !attachment.data) {
    return { attached: 0, reason: 'no-file' };
  }

  const file = dataUrlToFile(attachment.data, attachment.name, attachment.mimeType);
  let attached = 0;
  for (const input of inputs) {
    if (!fileMatchesAccept(file, input.accept)) continue;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    attached++;
  }
  return { attached, name: file.name, reason: attached ? 'attached' : 'type-not-accepted' };
}

function isResumeFileInput(input) {
  const text = [
    input.name,
    input.id,
    input.getAttribute('aria-label'),
    input.getAttribute('data-label'),
    getAssociatedLabelText(input),
    input.closest('.ashby-application-form-field-entry, .field, fieldset')?.querySelector('label, legend')?.textContent,
  ].filter(Boolean).join(' ').replace(/[_-]+/g, ' ');
  return RESUME_INPUT_PATTERN.test(text) && !NOT_RESUME_INPUT_PATTERN.test(text);
}

// Decoded locally rather than with fetch(dataUrl), which a strict page CSP can block.
function dataUrlToFile(dataUrl, name, mimeType) {
  const [header, base64 = ''] = String(dataUrl).split(',', 2);
  const type = mimeType || header.match(/^data:([^;,]+)/)?.[1] || 'application/pdf';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name || 'resume.pdf', { type });
}

function fileMatchesAccept(file, accept = '') {
  const rules = String(accept || '').split(',').map((rule) => rule.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return rules.some((rule) => (rule.startsWith('.') ? name.endsWith(rule)
    : rule.endsWith('/*') ? type.startsWith(rule.slice(0, -1)) : type === rule));
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

function setSelectValue(el, value) {
  const match = findBestSelectOptionValue(Array.from(el.options).map((opt) => ({
    value: opt.value,
    text: opt.text,
    option: opt,
  })), value);

  if (!match?.option) return false;

  el.value = match.option.value; fireEvents(el, ['focus', 'focusin', 'change', 'blur', 'focusout']); return true;
}

const FOCUS_EVENT_TYPES = new Set(['focus', 'blur', 'focusin', 'focusout']);

function fireEvents(el, events) {
  for (const type of events) {
    // focus/blur don't bubble in browsers; focusin/focusout do (React listens to those).
    const bubbles = type !== 'focus' && type !== 'blur';
    el.dispatchEvent(FOCUS_EVENT_TYPES.has(type) ? new FocusEvent(type, { bubbles }) : new Event(type, { bubbles }));
  }
}

function highlightField(el) {
  const orig = el.style.outline;
  el.style.outline = '2px solid #4ade80';
  el.style.outlineOffset = '2px';
  setTimeout(() => { el.style.outline = orig; el.style.outlineOffset = ''; }, 3000);
}

// ── ATS detection ─────────────────────────────────────────────────────────────

function detectAts() {
  const host = location.hostname;
  const path = `${location.pathname} ${location.search}`.toLowerCase();

  if (matchesDomain(host, 'greenhouse.io') && (/\/jobs\/|job_app|application/.test(path) || qs('#application_form, #content'))) return 'Greenhouse';
  if ((matchesDomain(host, 'ashbyhq.com') || matchesDomain(host, 'ashby.io')) && (/\/application|\/jobs\/|\/job\//.test(path) || qs('.ashby-job-posting-description, form'))) return 'Ashby';
  if (matchesDomain(host, 'lever.co') && (/\/postings\/|\/jobs\/|\/apply/.test(path) || qs('.posting-apply, .application-form'))) return 'Lever';
  if (matchesDomain(host, 'linkedin.com') && /\/jobs\/view\//.test(path)) return 'LinkedIn Easy Apply';
  if (matchesDomain(host, 'workday.com') && (/\/job\/|requisition|\/apply/.test(path) || qs('[data-automation-id="jobPostingHeader"]'))) return 'Workday';
  if (matchesDomain(host, 'icims.com') && (/\/jobs\/|\/job\//.test(path) || qs('#iCIMS_JobContent'))) return 'iCIMS';

  // Custom career domains (e.g. samsara.com/company/careers, abnormal.ai/careers)
  // commonly render a third-party ATS natively or embed its form/links. Sniff
  // the page for the ATS's fingerprints so detection still works off-domain.
  const embedded = detectEmbeddedAts();
  if (embedded) return embedded;

  return 'Generic';
}

function detectEmbeddedAts() {
  const urlAttrs = [];
  for (const el of document.querySelectorAll('iframe[src], a[href], form[action], script[src], link[href]')) {
    const value = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('action') || '';
    if (value) urlAttrs.push(value.toLowerCase());
  }

  let markup = '';
  try { markup = (document.documentElement.innerHTML || '').slice(0, 60000).toLowerCase(); } catch { /* ignore */ }
  const hay = `${urlAttrs.join(' ')} ${markup}`;

  if (/greenhouse\.io|grnhse|us-greenhouse-mail|job-boards\.greenhouse/.test(hay)) return 'Greenhouse';
  if (/ashbyhq\.com|jobs\.ashby|ashby\.io/.test(hay)) return 'Ashby';
  if (/(?:jobs\.)?lever\.co|lever-client/.test(hay)) return 'Lever';
  if (/myworkdayjobs|\.workday\.com/.test(hay)) return 'Workday';
  if (/icims\.com/.test(hay)) return 'iCIMS';
  if (/jobvite\.com/.test(hay)) return 'Jobvite';
  if (/phenompeople|phenom\.com/.test(hay)) return 'Phenom';
  return null;
}

// ── Draft caching / restoration ──────────────────────────────────────────────

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

function getDraftPageKey() {
  try {
    const url = new URL(location.href);
    return `${url.origin}${url.pathname}`.replace(/\/$/, '') || url.origin;
  } catch {
    return location.href.split('#')[0].split('?')[0];
  }
}

function getDraftFieldKey(el) {
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
  // Yes/No groups are restored by the page from its own button state; their
  // hidden checkbox has no label and toggling it directly desyncs the buttons.
  // A type-ahead's input holds the search text, not the chosen answer, so
  // saving or learning it would replay a half-typed query on other forms.
  return Array.from(document.querySelectorAll('input, textarea, select'))
    .filter((el) => isDraftableField(el) && !el.closest(YES_NO_GROUP_SELECTOR) && !el.matches(COMBOBOX_SELECTOR));
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
      if (checked && !isUntouchedAutofillGroup(radios)) fields[key] = getChoiceIdentity(checked);
      continue;
    }

    if (type === 'checkbox') {
      processedGroups.add(key);
      const members = getCheckboxGroupMembers(el);
      if (isUntouchedAutofillGroup(members)) continue;
      if (members.length > 1) {
        const selected = members.filter((member) => member.checked).map(getChoiceIdentity).filter(Boolean);
        if (selected.length) fields[key] = selected;
      } else {
        fields[key] = el.checked;
      }
      continue;
    }

    const value = String(el.value || '');
    if (value.trim() && !isUntouchedAutofill(el)) {
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
    const type = (el.getAttribute('type') || '').toLowerCase();
    const isChoice = type === 'radio' || type === 'checkbox';
    const key = getDraftFieldKey(el);
    if (!key || processedGroups.has(key)) continue;

    if (isChoice) {
      processedGroups.add(key);
      const members = type === 'radio'
        ? (el.name ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)) : [el])
        : getCheckboxGroupMembers(el);
      if (isUntouchedAutofillGroup(members)) continue;
      // A group is learned under its question. A single checkbox's own label
      // is the question; for a multi-option group the option label is not.
      const label = type === 'radio' || members.length > 1 ? getChoiceGroupLabel(el) : describeField(el);
      if (!label || label === 'unlabeled field') continue;

      if (type === 'radio') {
        const checked = members.find((radio) => radio.checked);
        if (checked) entries[label] = getChoiceIdentity(checked);
      } else if (members.length > 1) {
        const selected = members.filter((member) => member.checked).map(getChoiceIdentity).filter(Boolean);
        if (selected.length) entries[label] = selected.join(', ');
      } else if (el.checked) {
        entries[label] = 'Yes';
      }
      continue;
    }

    const label = describeField(el);
    if (!label || label === 'unlabeled field' || isUntouchedAutofill(el)) continue;
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
    const draft = data[DRAFT_STORAGE_KEY]?.[getDraftPageKey()];
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

// ── Auto-detect on load ───────────────────────────────────────────────────────

(function init() {
  initDraftPersistence();

  // Only the host page announces the detected ATS; embedded form iframes skip
  // the (innerHTML-scanning) detection to avoid redundant work in every frame.
  if (!IS_TOP_FRAME) return;

  const ats = detectAts();
  if (ats !== 'Generic') {
    chrome.runtime.sendMessage({ type: 'ATS_DETECTED', payload: { ats } }).catch(() => {});
  }
})();
