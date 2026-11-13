import { stripHtml } from "./utils.js";
/**
 * apply-bot — jd-parser.js
 * Extracts job description text from the current page DOM.
 * Tries ATS-specific selectors first, then falls back to heuristic extraction.
 */

/**
 * Check if a hostname exactly matches a domain or any of its subdomains.
 * @param {string} hostname
 * @param {string} domain
 * @returns {boolean}
 */
function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

/**
 * Extract job description text from the current page.
 * This runs in the content script context (has access to `document`).
 *
 * @returns {{ jd: string, company: string, title: string }}
 */
export function extractJobInfo() {
  const hostname = location.hostname;

  if (matchesDomain(hostname, 'greenhouse.io')) return extractGreenhouse();
  if (matchesDomain(hostname, 'ashbyhq.com') || matchesDomain(hostname, 'ashby.io')) return extractAshby();
  if (matchesDomain(hostname, 'lever.co')) return extractLever();
  if (matchesDomain(hostname, 'linkedin.com')) return extractLinkedIn();
  if (matchesDomain(hostname, 'workday.com')) return extractWorkday();
  if (matchesDomain(hostname, 'icims.com')) return extractICIMS();
  return extractGeneric();
}

// ── ATS-specific extractors ───────────────────────────────────────────────────

function extractGreenhouse() {
  const title = qs('#header h1, .app-title, h1')?.textContent?.trim() || '';
  const company = qs('#header .company-name, .company')?.textContent?.trim() || document.title;
  const jd = qs('#content, #app_body, .content')?.innerText?.trim() || extractGenericText();
  return { title, company, jd };
}

function extractAshby() {
  const title = qs('h1[data-testid="job-title"], h1.ashby-job-posting-heading, h1')?.textContent?.trim() || '';
  const company = qs('.ashby-application-portal-name, [data-testid="company-name"]')?.textContent?.trim() || document.title;
  const jd = qs('.ashby-job-posting-brief-list, .ashby-job-posting-description, main')?.innerText?.trim() || extractGenericText();
  return { title, company, jd };
}

function extractLever() {
  const title = qs('.posting-header h2, h2.posting-title')?.textContent?.trim() || '';
  const company = qs('.main-header-logo img')?.alt?.trim() || document.title;
  const jd = qs('.posting-description, section.page-centered')?.innerText?.trim() || extractGenericText();
  return { title, company, jd };
}

function extractLinkedIn() {
  const title = qs('.job-details-jobs-unified-top-card__job-title, h1.t-24')?.textContent?.trim() || '';
  const company = qs('.job-details-jobs-unified-top-card__company-name, a.ember-view')?.textContent?.trim() || '';
  const jd = qs('#job-details, .jobs-description__content, .jobs-description-content__text')?.innerText?.trim() || extractGenericText();
  return { title, company, jd };
}

function extractWorkday() {
  const title = qs('[data-automation-id="jobPostingHeader"], h2.css-9xh9yi')?.textContent?.trim() || '';
  const company = document.title.split('|')?.[1]?.trim() || '';
  const jd = qs('[data-automation-id="job-description"], .css-qdtm9x')?.innerText?.trim() || extractGenericText();
  return { title, company, jd };
}

function extractICIMS() {
  const title = qs('.iCIMS_JobHeaderTitle, #iCIMS_MainColumn h1')?.textContent?.trim() || '';
  const company = qs('.iCIMS_CompanyLogo img')?.alt || document.title;
  const jd = qs('#iCIMS_JobContent, .iCIMS_JobContent')?.innerText?.trim() || extractGenericText();
  return { title, company, jd };
}

// ── Generic fallback ──────────────────────────────────────────────────────────

function extractGeneric() {
  const title = qs('h1, h2')?.textContent?.trim() || '';
  const company = '';
  const jd = extractGenericText();
  return { title, company, jd };
}

/**
 * Heuristic text extraction: score candidate elements by size and keyword density.
 */
function extractGenericText() {
  const JD_KEYWORDS = ['responsibilities', 'qualifications', 'requirements', 'experience', 'skills', 'about', 'role', 'position'];

  const candidates = Array.from(document.querySelectorAll('article, section, main, .job-description, [class*="description"], [id*="description"], [class*="posting"], [id*="posting"]'));

  let best = null;
  let bestScore = 0;

  for (const el of candidates) {
    const text = el.innerText || '';
    if (text.length < 200) continue;
    const lower = text.toLowerCase();
    const kwHits = JD_KEYWORDS.filter((kw) => lower.includes(kw)).length;
    const score = kwHits * 100 + text.length;
    if (score > bestScore) {
      bestScore = score;
      best = text;
    }
  }

  return best || document.body.innerText.slice(0, 8000);
}


/**
 * Extract job posting JSON-LD from page DOM.
 */
/**
 * Extract job posting JSON-LD from page DOM.
 */
export function extractJsonLd() {
  const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => {
      try { return JSON.parse(s.textContent); }
      catch { return null; }
    })
    .filter(Boolean);
  return parseJobPostingJsonLd(ld);
}

export function parseJobPostingJsonLd(ld) {
  const postings = collectJobPostings(ld);
  if (!postings.length) return null;
  const p = postings[0];
  const description = stripHtml(ldText(p.description)).slice(0, 6000);
  return {
    title: ldText(p.title),
    company: ldText(p.hiringOrganization?.name ?? p.hiringOrganization),
    location: parseJsonLdLocation(p.jobLocation),
    employment_type: normalizeJsonLdEmploymentType(p.employmentType),
    remote: isJsonLdRemote(p),
    salary_range: parseJsonLdSalary(p.baseSalary || p.estimatedSalary),
    description,
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


function parseJsonLdLocation(jobLocation) {
  const loc = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  const addr = loc?.address || loc;
  if (!addr || typeof addr !== 'object') return '';
  const country = ldText(addr.addressCountry?.name ?? addr.addressCountry);
  const parts = [ldText(addr.addressLocality), ldText(addr.addressRegion), country].filter(Boolean);
  return parts.join(', ');
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
  let min;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function qs(selector) {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}
