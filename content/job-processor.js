/**
 * content/job-processor.js - Job info extraction and processing
 */

import { getFillableInputs, fillForm, loadFieldMap, findFieldForReviewTarget, highlightField, describeField, collectCustomQuestions } from './form-filler.js';
import { detectAts } from './ats-detector.js';
import { matchesDomain, qs, firstNonEmptyText, extractGenericText, stripLdHtml } from './utils.js';

// ── Local inline helpers (avoids top-level import conflicts in content scripts) ──

function qs(selector) {
  try { return document.querySelector(selector); } catch { return null; }
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

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

// ── Exported handlers ─────────────────────────────────────────────────────────

/**
 * Handle FILL_FORM message - extract job info, generate answers, fill form
 * @returns {Promise<{success: boolean, filled: number[], company?: string, title?: string, warning?: string, report: any}>} Fill result report
 */
export async function handleFillForm() {
  const { jd, company, title, location: jobLocation, employment_type, remote, salary_range } = extractJobInfo();
  const customQuestions = collectCustomQuestions();

  const resp = await chrome.runtime.sendMessage({
    type: 'GENERATE_ANSWERS',
    payload: { jd, customQuestions, pageUrl: location.href },
  });
  if (!resp?.success) throw new Error(resp?.error || 'Failed to generate answers');

  const answers = resp.answers;
  const warning = resp.warning || null;

  if (answers.custom_answers && typeof answers.custom_answers === 'object') {
    for (const [q, a] of Object.entries(answers.custom_answers)) answers[q] = a;
  }

  const fieldMap = await loadFieldMap();
  const report = fillForm(answers, fieldMap);

  await chrome.runtime.sendMessage({
    type: 'LOG_APPLICATION',
    payload: { company, title, url: location.href, status: 'filled', jd_snippet: jd.slice(0, 300), description: jd.slice(0, 6000), location: jobLocation, employment_type, remote, salary_range, answers_generated: true, fill_report: report },
  });
  return { success: true, filled: report.filled, company, title, warning, report };
}

/** Handle INJECT_ANSWERS message */
export async function handleInjectAnswers(answers) {
  if (!answers) throw new Error('No answers to inject');
  const fieldMap = await loadFieldMap();
  const report = fillForm(answers, fieldMap);
  return { success: true, filled: report.filled, report };
}

/** Handle GET_JOB_INFO message */
export async function handleGetJobInfo() {
  const info = extractJobInfo();
  return { success: true, job: { ...info, url: location.href } };
}

/** Handle FOCUS_FIELD message */
export async function handleFocusField(target = {}) {
  const field = findFieldForReviewTarget(target);
  if (!field) return { success: false, error: 'Could not find that field on the page.' };
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  try { field.focus({ preventScroll: true }); } catch { field.focus(); }
  highlightField(field);
  return { success: true, label: describeField(field) };
}

/** Handle FETCH_LINKEDIN_JOBS message */
export async function handleFetchLinkedInJobs(payload, sendResponse) {
  // Only allow on LinkedIn domains to prevent CSRF token leakage
  if (!location.hostname.endsWith('linkedin.com')) {
    sendResponse({ success: false, error: 'LinkedIn job fetch only allowed on LinkedIn domains' });
    return;
  }

  const { query, csrfToken } = payload || {};
  const params = new URLSearchParams({ keywords: query || '', start: '0', count: '25', origin: 'GLOBAL_SEARCH_HEADER', q: 'all' });
  const res = await fetch(`${window.location.origin}/voyager/api/jobs/search?${params}`, {
    headers: { 'Csrf-Token': csrfToken || '', 'X-Restli-Protocol-Version': '2.0.0', 'Accept': 'application/vnd.linkedin.normalized+json+2.1' },
  });
  if (!res.ok) { sendResponse({ success: false, error: `LinkedIn responded ${res.status}` }); return; }
  const data = await res.json();
  sendResponse({ success: true, data });
}

// ── JD extraction (inlined from lib/jd-parser.js) ────────────────────────────

function extractJobInfo() {
  const hostname = location.hostname;
  let info;
  if (matchesDomain(hostname, 'greenhouse.io')) info = extractGreenhouse();
  else if (matchesDomain(hostname, 'ashbyhq.com') || matchesDomain(hostname, 'ashby.io')) info = extractAshby();
  else if (matchesDomain(hostname, 'lever.co')) info = extractLever();
  else if (matchesDomain(hostname, 'linkedin.com')) info = extractLinkedIn();
  else if (matchesDomain(hostname, 'workday.com')) info = extractWorkday();
  else if (matchesDomain(hostname, 'icims.com')) info = extractICIMS();
  else if (matchesDomain(hostname, 'jobvite.com')) info = extractJobvite();
  else if (matchesDomain(hostname, 'circle.com') || matchesDomain(hostname, 'phenompeople.com')) info = extractPhenom();
  else info = extractGenericJobInfo();
  info._ld = parseJobPostingJsonLd(readJsonLdObjects());
  return enrichJobInfo(info);
}

function extractGreenhouse() {
  return { title: qs('#header h1, .app-title, h1')?.textContent?.trim() || '', company: qs('#header .company-name, .company')?.textContent?.trim() || document.title, jd: qs('#content, #app_body, .content')?.innerText?.trim() || extractGenericText() };
}
function extractAshby() {
  return { title: qs('h1[data-testid="job-title"], h1.ashby-job-posting-heading, h1')?.textContent?.trim() || '', company: qs('.ashby-application-portal-name, [data-testid="company-name"]')?.textContent?.trim() || document.title, jd: qs('.ashby-job-posting-brief-list, .ashby-job-posting-description, main')?.innerText?.trim() || extractGenericText() };
}
function extractLever() {
  return { title: qs('.posting-header h2, h2.posting-title')?.textContent?.trim() || '', company: qs('.main-header-logo img')?.alt?.trim() || document.title, jd: qs('.posting-description, section.page-centred')?.innerText?.trim() || extractGenericText() };
}
function extractLinkedIn() {
  return { title: qs('.job-details-jobs-unified-top-card__job-title, h1.t-24')?.textContent?.trim() || '', company: qs('.job-details-jobs-unified-top-card__company-name, a.ember-view')?.textContent?.trim() || '', jd: qs('#job-details, .jobs-description__content, .jobs-description-content__text')?.innerText?.trim() || extractGenericText() };
}
function extractWorkday() {
  return { title: qs('[data-automation-id="jobPostingHeader"], h2.css-9xh9yi')?.textContent?.trim() || '', company: document.title.split('|')?.[1]?.trim() || '', jd: qs('[data-automation-id="job-description"], .css-qdtm9x')?.innerText?.trim() || extractGenericText() };
}
function extractICIMS() {
  return { title: qs('.iCIMS_JobHeaderTitle, #iCIMS_MainColumn h1')?.textContent?.trim() || '', company: qs('.iCIMS_CompanyLogo img')?.alt || document.title, jd: qs('#iCIMS_JobContent, .iCIMS_JobContent')?.innerText?.trim() || extractGenericText() };
}
function extractJobvite() {
  return { title: qs('[data-qa="job-title"], h1, .job-title')?.textContent?.trim() || '', company: qs('[data-qa="company-name"], .company-name')?.textContent?.trim() || document.title, jd: qs('[data-qa="job-description"], .job-description, main')?.innerText?.trim() || extractGenericText() };
}
function extractPhenom() {
  return { title: qs('[data-ph-id="ph-page-element-page16-j5r8i0"], h1, [class*="job-title"]')?.textContent?.trim() || '', company: qs('[class*="company"], [data-qa="company-name"]')?.textContent?.trim() || document.title, jd: qs('[class*="job-description"], [data-qa="job-description"], main')?.innerText?.trim() || extractGenericText() };
}
function extractGenericJobInfo() {
  return { title: qs('h1, h2')?.textContent?.trim() || '', company: '', jd: extractGenericText() };
}

function enrichJobInfo(info = {}) {
  const ld = info._ld || null;
  const jd = String(info.jd || (ld && ld.description) || extractGenericText() || '');
  const locationText = firstNonEmptyText(info.location, ld && ld.location, extractLocationFromPage(), extractLocationFromText(jd), 'Unknown');
  return {
    ...info,
    title: info.title || (ld && ld.title) || '',
    company: info.company || (ld && ld.company) || '',
    jd,
    location: locationText || 'Unknown',
    employment_type: (ld && ld.employment_type) || detectEmploymentTypeFromText(`${info.title || ''}\n${jd}`),
    remote: ld?.remote !== undefined ? ld.remote : detectRemoteFromText(`${locationText}\n${jd}`),
    salary_range: (ld && ld.salary_range) || extractSalaryRangeFromText(jd),
    _dataSource: ld ? 'json-ld' : 'dom',
  };
}

// ── JSON-LD JobPosting (schema.org) — inlined from lib/jd-parser.js ─────────

function readJsonLdObjects() {
  const out = [];
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { out.push(JSON.parse(el.textContent || '')); } catch { /* ignore */ }
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
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|nbsp|#\d+|#x[0-9a-fA-F]+|quot|apos);/g, (m) => {
      switch (m) {
        case "&" + "amp;": return "&";
        case "&" + "lt;": return "<";
        case "&" + "gt;": return ">";
        case "&nbsp;": return " ";
        case "&" + "quot;": return '"';
        case "&apos;": return "'";
      }
      if (m.startsWith("&#x")) {
        const cp = parseInt(m.slice(3, -1), 16);
        return cp <= 0x10FFFF ? String.fromCodePoint(cp) : " ";
      }
      if (m.startsWith("&#")) {
        const cp = parseInt(m.slice(2, -1), 10);
        return cp <= 0x10FFFF ? String.fromCodePoint(cp) : " ";
      }
      return " ";
    })
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
  let min = null, max = null, unit = '';
  if (v && typeof v === 'object') {
    min = num(v.minValue); max = num(v.maxValue); unit = v.unitText || '';
    if (min == null && max == null) min = num(v.value);
  } else { min = num(v); }
  const fmt = (n) => `${sym}${Math.round(n).toLocaleString()}`;
  const suffix = /hour/i.test(String(unit)) ? '/hr' : '';
  if (min != null && max != null && min !== max) return `${fmt(min)} - ${fmt(max)}${suffix}`;
  if (min != null) return `${fmt(min)}${suffix}`;
  if (max != null) return `${fmt(max)}${suffix}`;
  return '';
}

// ── Location / employment detection helpers ──────────────────────────────────

function extractLocationFromPage() {
  const selectors = ['[data-automation-id="locations"]', '[data-testid*="location"]', '.posting-categories .sort-by-location', '.job-details-jobs-unified-top-card__tertiary-description', '.topcard__flavor--bullet', '.job-location', '[itemprop="jobLocation"]', '[class*="location"]'];
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
  const n = String(text || '').toLowerCase();
  if (/part[ -]?time/.test(n)) return 'Part-time';
  if (/contract|contractor/.test(n)) return 'Contract';
  if (/intern(ship)?/.test(n)) return 'Internship';
  if (/temporary|temp\b/.test(n)) return 'Temporary';
  return 'Full-time';
}
function detectRemoteFromText(text = '') { return /\bremote\b|hybrid|work from home|wfh/i.test(String(text || '')); }
function extractSalaryRangeFromText(text = '') {
  const match = String(text || '').match(/\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|K|\/hr|\/year)?\s*(?:-|–|to)\s*\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:k|K|\/hr|\/year)?/);
  return match ? match[0].replace(/\s+/g, ' ').trim() : '';
}
