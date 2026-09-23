
export const REMOTIVE_ENDPOINT = 'https://remotive.com/api/remote-jobs';
import './utils.js';
export const ARBEITNOW_ENDPOINT = 'https://www.arbeitnow.com/api/job-board-api';
export const ADZUNA_ENDPOINT = 'https://api.adzuna.com/v1/api/jobs';
export const USAJOBS_ENDPOINT = 'https://data.usajobs.gov/api/search';
export const MUSE_ENDPOINT = 'https://www.themuse.com/api/public/jobs';
export const REMOTEOK_ENDPOINT = 'https://remoteok.com/api';
export const JOBICY_ENDPOINT = 'https://jobicy.com/api/v2/remote-jobs';
export const WORKINGNOMADS_ENDPOINT = 'https://www.workingnomads.com/api/exposed_jobs/';
export const REED_ENDPOINT = 'https://www.reed.co.uk/api/1.0/search';
export const JOOBLE_ENDPOINT = 'https://jooble.org/api';
export const HN_ALGOLIA_ENDPOINT = 'https://hn.algolia.com/api/v1/search';
export const WWR_RSS_ENDPOINT = 'https://weworkremotely.com/remote-jobs.rss';
export const REMOTECO_RSS_ENDPOINT = 'https://remote.co/remote-jobs/feed/';
export const LINKEDIN_VOYAGER_ENDPOINT = 'https://www.linkedin.com/voyager/api/jobs/search';
export const INDEED_BASE_URL = 'https://www.indeed.com';

export const INDEED_RSS_ENDPOINT = 'https://www.indeed.com/rss';
export const HACKAJOB_SITEMAP_ENDPOINT = 'https://hackajob.com/sitemap-jobs.xml';

const KNOWN_ATS = [
  { pattern: /greenhouse\.io|job-boards\.greenhouse/i, label: 'Greenhouse' },
  { pattern: /lever\.co/i, label: 'Lever' },
  { pattern: /ashbyhq\.com|jobs\.ashby/i, label: 'Ashby' },
  { pattern: /myworkdayjobs|\.workday\.com/i, label: 'Workday' },
  { pattern: /icims\.com/i, label: 'iCIMS' },
  { pattern: /jobvite\.com/i, label: 'Jobvite' },
  { pattern: /phenompeople|phenom\.com/i, label: 'Phenom' },
];

/**
 * Identify a known ATS from a job-post URL so the UI can preferentially surface
 * a direct application link.
 * @param {string} url
 * @returns {string|null}
 */
export function detectAtsLabelFromUrl(url) {
  const text = String(url || "");
  for (const { pattern, label } of KNOWN_ATS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

function cleanText(value, max = 280) {
  if (!value) return "";
  const text = String(value);
  // Decode ALL HTML entities in one pass using a function
  const decoded = text.replace(/&([a-zA-Z0-9]+|#\d+|#x[0-9a-fA-F]+);/g, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCharCode(parseInt(entity.slice(2), 16));
    } else if (entity.startsWith("#")) {
      return String.fromCharCode(parseInt(entity.slice(1), 10));
    } else {
      // Named entities
      const entities = {
        amp: "&",
        lt: "<",
        gt: ">",
        nbsp: " ",
        quot: '"',
        apos: "'",
        cent: "¢",
        pound: "£",
        yen: "¥",
        euro: "€",
        copy: "©",
        reg: "®",
        trade: "™",
      };
      return entities[entity.toLowerCase()] || " ";
    }
  });
  // Strip HTML tags and normalize whitespace
  return decoded
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}



function isRemoteText(...values) {
  return /\bremote\b|\bhybrid\b|work from home|wfh|anywhere/i.test(values.filter(Boolean).join(' '));
}

/**
 * Normalize a Remotive API job into the common schema.
 */
export function normalizeRemotiveJob(raw = {}) {
  const url = String(raw.url || '').trim();
  const location = cleanText(raw.candidate_required_location || 'Remote', 120) || 'Remote';
  return {
    id: `remotive:${raw.id ?? url}`,
    title: cleanText(raw.title, 160),
    company: cleanText(raw.company_name, 120),
    location,
    salary: cleanText(raw.salary, 80),
    remote: true,
    url,
    atsLabel: detectAtsLabelFromUrl(url),
    source: 'Remotive',
    employment_type: cleanText(raw.job_type, 40),
    posted: toIsoDate(raw.publication_date),
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 8).map((t) => cleanText(t, 40)) : [],
    description: cleanText(raw.description, 600),
  };
}

/**
 * Normalize an Arbeitnow API job into the common schema.
 */
export function normalizeArbeitnowJob(raw = {}) {
  const url = String(raw.url || '').trim();
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  const jobTypes = Array.isArray(raw.job_types) ? raw.job_types : [];
  const remote = raw.remote === true || isRemoteText(raw.location, tags.join(' '));
  return {
    id: `arbeitnow:${raw.slug ?? url}`,
    title: cleanText(raw.title, 160),
    company: cleanText(raw.company_name, 120),
    location: cleanText(raw.location, 120) || (remote ? 'Remote' : 'Unknown'),
    salary: '',
    remote,
    url,
    atsLabel: detectAtsLabelFromUrl(url),
    source: 'Arbeitnow',
    employment_type: cleanText(jobTypes[0], 40),
    posted: toIsoDate(raw.created_at),
    tags: tags.slice(0, 8).map((t) => cleanText(t, 40)),
    description: cleanText(raw.description, 600),
  };
}

const ADZUNA_CURRENCY_SYMBOL = { us: '$', gb: '£', ca: 'CA$', au: 'A$', nz: 'NZ$', de: '€', fr: '€', nl: '€', be: '€', at: '€', in: '₹', sg: 'S$', za: 'R', br: 'R$', mx: 'MX$' };

function formatAdzunaSalary(min, max, country = 'us') {
  const symbol = ADZUNA_CURRENCY_SYMBOL[String(country).toLowerCase()] ?? '';
  const lo = Number(min);
  const hi = Number(max);
  const fmt = (n) => `${symbol}${Math.round(n).toLocaleString()}`;
  if (Number.isFinite(lo) && lo > 0 && Number.isFinite(hi) && hi > 0 && hi !== lo) return `${fmt(lo)} - ${fmt(hi)}`;
  if (Number.isFinite(lo) && lo > 0) return fmt(lo);
  if (Number.isFinite(hi) && hi > 0) return fmt(hi);
  return '';
}

/**
 * Normalize an Adzuna API job into the common schema.
 */
export function normalizeAdzunaJob(raw = {}, country = 'us') {
  const url = String(raw.redirect_url || '').trim();
  const location = cleanText(raw.location?.display_name, 120) || 'Unknown';
  const employmentType = raw.contract_time === 'part_time'
    ? 'Part-time'
    : raw.contract_time === 'full_time' ? 'Full-time' : '';
  return {
    id: `adzuna:${raw.id ?? url}`,
    title: cleanText(raw.title, 160),
    company: cleanText(raw.company?.display_name, 120),
    location,
    salary: formatAdzunaSalary(raw.salary_min, raw.salary_max, country),
    remote: isRemoteText(location, raw.title, raw.description),
    url,
    atsLabel: detectAtsLabelFromUrl(url),
    source: 'Adzuna',
    employment_type: employmentType,
    posted: toIsoDate(raw.created),
    tags: [],
    description: cleanText(raw.description, 600),
  };
}

function formatUsaJobsSalary(rem = {}) {
  const min = Number(rem.MinimumRange);
  const max = Number(rem.MaximumRange);
  const fmt = (n) => `$${Math.round(n).toLocaleString()}`;
  const suffix = rem.RateIntervalCode === 'PH' ? '/hr' : '';
  if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > 0 && max !== min) return `${fmt(min)} - ${fmt(max)}${suffix}`;
  if (Number.isFinite(min) && min > 0) return `${fmt(min)}${suffix}`;
  if (Number.isFinite(max) && max > 0) return `${fmt(max)}${suffix}`;
  return '';
}

/**
 * Normalize a USAJOBS SearchResultItem into the common schema.
 */
export function normalizeUsaJobsJob(item = {}) {
  const d = item.MatchedObjectDescriptor || item;
  const url = String(d.PositionURI || '').trim();
  const rem = Array.isArray(d.PositionRemuneration) ? d.PositionRemuneration[0] : null;
  const location = cleanText(d.PositionLocationDisplay, 120) || 'United States';
  const summary = d.UserArea?.Details?.JobSummary || '';
  const schedule = Array.isArray(d.PositionSchedule) ? cleanText(d.PositionSchedule[0]?.Name, 40) : '';
  return {
    id: `usajobs:${item.MatchedObjectId || d.PositionID || url}`,
    title: cleanText(d.PositionTitle, 160),
    company: cleanText(d.OrganizationName, 120),
    location,
    salary: rem ? formatUsaJobsSalary(rem) : '',
    remote: isRemoteText(location, d.PositionTitle, summary),
    url,
    atsLabel: detectAtsLabelFromUrl(url) || 'USAJOBS',
    source: 'USAJOBS',
    employment_type: /part/i.test(schedule) ? 'Part-time' : (schedule ? 'Full-time' : ''),
    posted: toIsoDate(d.PublicationStartDate),
    tags: [],
    description: cleanText(summary, 600),
  };
}

/**
 * Normalize a The Muse API job into the common schema.
 */
export function normalizeMuseJob(raw = {}) {
  const url = String(raw.refs?.landing_page || '').trim();
  const location = cleanText(raw.locations?.[0]?.name, 120) || 'Flexible';
  const categories = Array.isArray(raw.categories) ? raw.categories : [];
  return {
    id: `themuse:${raw.id ?? url}`,
    title: cleanText(raw.name, 160),
    company: cleanText(raw.company?.name, 120),
    location,
    salary: '',
    remote: isRemoteText(location, raw.name),
    url,
    atsLabel: detectAtsLabelFromUrl(url),
    source: 'The Muse',
    employment_type: '',
    posted: toIsoDate(raw.publication_date),
    tags: categories.slice(0, 4).map((c) => cleanText(c?.name, 40)).filter(Boolean),
    description: cleanText(raw.contents, 600),
  };
}

/**
 * Normalize a RemoteOK API job into the common schema.
 * RemoteOK returns a JSON array; the first element is always a metadata header.
 */
export function normalizeRemoteOkJob(raw = {}) {
  const url = String(raw.url || '').trim();
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  const salaryMin = Number(raw.salary_min);
  const salaryMax = Number(raw.salary_max);
  const currency = String(raw.currency || 'USD').toUpperCase();
  let salary = '';
  if (Number.isFinite(salaryMin) && Number.isFinite(salaryMax) && salaryMax > 0 && salaryMax !== salaryMin) {
    const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;
    salary = `${sym}${Math.round(salaryMin).toLocaleString()} - ${sym}${Math.round(salaryMax).toLocaleString()}`;
  } else if (Number.isFinite(salaryMin) && salaryMin > 0) {
    const sym = currency === 'USD' ? '$' : '';
    salary = `${sym}${Math.round(salaryMin).toLocaleString()}`;
  }
  return {
    id: `remoteok:${raw.id ?? url}`,
    title: cleanText(raw.position || raw.title, 160),
    company: cleanText(raw.company, 120),
    location: cleanText(raw.location, 120) || 'Remote',
    salary,
    remote: true,
    url,
    atsLabel: detectAtsLabelFromUrl(url),
    source: 'Remote OK',
    employment_type: '',
    posted: toIsoDate(raw.epoch ? raw.epoch * 1000 : raw.date),
    tags: tags.slice(0, 8).map((t) => cleanText(t, 40)).filter(Boolean),
    description: cleanText(raw.description, 600),
  };
}

/**
 * Normalize a Jobicy API job into the common schema.
 */
export function normalizeJobicyJob(raw = {}) {
  const url = String(raw.url || '').trim();
  const industries = Array.isArray(raw.jobIndustry) ? raw.jobIndustry : [];
  const types = Array.isArray(raw.jobType) ? raw.jobType : [];
  const salaryMin = Number(raw.annualSalaryMin);
  const salaryMax = Number(raw.annualSalaryMax);
  const currency = String(raw.salaryCurrency || 'USD').toUpperCase();
  let salary = '';
  if (Number.isFinite(salaryMin) && Number.isFinite(salaryMax) && salaryMax > 0 && salaryMax !== salaryMin) {
    const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;
    salary = `${sym}${Math.round(salaryMin).toLocaleString()} - ${sym}${Math.round(salaryMax).toLocaleString()}`;
  } else if (Number.isFinite(salaryMin) && salaryMin > 0) {
    salary = `$${Math.round(salaryMin).toLocaleString()}`;
  }
  const geo = cleanText(raw.jobGeo, 80) || 'Remote';
  return {
    id: `jobicy:${raw.id ?? url}`,
    title: cleanText(raw.jobTitle, 160),
    company: cleanText(raw.companyName, 120),
    location: geo,
    salary,
    remote: true,
    url,
    atsLabel: detectAtsLabelFromUrl(url),
    source: 'Jobicy',
    employment_type: cleanText(types[0], 40),
    posted: toIsoDate(raw.pubDate),
    tags: industries.slice(0, 6).map((t) => cleanText(t, 40)).filter(Boolean),
    description: cleanText(raw.jobExcerpt || raw.jobDescription, 600),
  };
}

/**
 * Normalize a Working Nomads API job into the common schema.
 */
export function normalizeWorkingNomadsJob(raw = {}) {
  const url = String(raw.url || '').trim();
  return {
    id: `workingnomads:${raw.id ?? url}`,
    title: cleanText(raw.title, 160),
    company: cleanText(raw.company_name, 120),
    location: cleanText(raw.location, 120) || 'Remote',
    salary: cleanText(raw.salary, 80),
    remote: true,
    url,
    atsLabel: detectAtsLabelFromUrl(url),
    source: 'Working Nomads',
    employment_type: '',
    posted: toIsoDate(raw.pub_date),
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 6).map((t) => cleanText(t, 40)).filter(Boolean) : [],
    description: cleanText(raw.description, 600),
  };
}

/**
 * Normalize a Reed.co.uk API job into the common schema.
 */
export function normalizeReedJob(raw = {}) {
  const url = String(raw.jobUrl || raw.applicationUrl || '').trim();
  const min = Number(raw.minimumSalary);
  const max = Number(raw.maximumSalary);
  let salary = '';
  if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > 0 && max !== min) {
    salary = `£${Math.round(min).toLocaleString()} - £${Math.round(max).toLocaleString()}`;
  } else if (Number.isFinite(min) && min > 0) {
    salary = `£${Math.round(min).toLocaleString()}`;
  } else if (Number.isFinite(max) && max > 0) {
    salary = `£${Math.round(max).toLocaleString()}`;
  }
  const contractType = String(raw.contractType || '').toLowerCase();
  let employment_type = '';
  if (raw.fullTime) employment_type = 'Full-time';
  else if (raw.partTime) employment_type = 'Part-time';
  else if (/contract/.test(contractType)) employment_type = 'Contract';
  else if (/temp/.test(contractType)) employment_type = 'Temporary';
  return {
    id: `reed:${raw.jobId ?? url}`,
    title: cleanText(raw.jobTitle, 160),
    company: cleanText(raw.employerName, 120),
    location: cleanText(raw.locationName, 120) || 'United Kingdom',
    salary,
    remote: isRemoteText(raw.locationName, raw.jobTitle, raw.jobDescription),
    url,
    atsLabel: detectAtsLabelFromUrl(url),
    source: 'Reed',
    employment_type,
    posted: toIsoDate(raw.date || raw.expirationDate),
    tags: [],
    description: cleanText(raw.jobDescription, 600),
  };
}

/**
 * Normalize a Jooble API job into the common schema.
 */
export function normalizeJoobleJob(raw = {}) {
  const url = String(raw.link || '').trim();
  return {
    id: `jooble:${url || raw.title}`,
    title: cleanText(raw.title, 160),
    company: cleanText(raw.company, 120),
    location: cleanText(raw.location, 120) || 'Unknown',
    salary: cleanText(raw.salary, 80),
    remote: isRemoteText(raw.location, raw.title, raw.snippet),
    url,
    atsLabel: detectAtsLabelFromUrl(url),
    source: 'Jooble',
    employment_type: cleanText(raw.type, 40),
    posted: toIsoDate(raw.updated),
    tags: [],
    description: cleanText(raw.snippet, 600),
  };
}

// ── Utilities ───────────────────────────────────────────────────────────────

function toIsoDate(value) {
  if (value == null || value === '') return '';
  // Arbeitnow uses unix seconds; Remotive uses an ISO/date string.
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const ms = Number(value) * (String(value).length <= 10 ? 1000 : 1);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Does a normalized job match every whitespace-delimited token in the query?
 */
export function jobMatchesQuery(job, query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = [
    job.title, job.company, job.location, job.employment_type,
    (job.tags || []).join(' '), job.description,
  ].join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Merge results from multiple sources and drop duplicates. A job is a duplicate
 * if it shares a normalized company+title (or exact URL) with an earlier entry.
 */
export function dedupeJobs(jobs = []) {
  const seen = new Set();
  const out = [];
  for (const job of jobs) {
    if (!job || (!job.title && !job.company && !job.url)) continue;
    const key = normalizeKey(`${job.company}|${job.title}`);
    const urlKey = String(job.url || '').trim().toLowerCase();
    if ((key && seen.has(key)) || (urlKey && seen.has(urlKey))) continue;
    if (key) seen.add(key);
    if (urlKey) seen.add(urlKey);
    out.push(job);
  }
  return out;
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Pay parsing / filtering ──────────────────────────────────────────────────

const ANNUAL_HOURS = 2080; // 40h × 52w, for rough annual↔hourly conversion

/**
 * Parse a salary string into a numeric range + unit.
 * "$130,000 - $176,000" → { min: 130000, max: 176000, hourly: false }
 * "$120k" → { min: 120000, max: 120000 }   "$50/hr" → { hourly: true }
 * @returns {{min:number, max:number, hourly:boolean}|null}
 */
export function parseJobPay(salary) {
  const s = String(salary || '').toLowerCase();
  if (!s) return null;
  const hourly = /\/\s*h|per hour|hourly|an hour/.test(s);
  // Require a $ prefix or an explicit k suffix to avoid matching years, benefit
  // plan numbers (401), or other unrelated digits in the salary string.
  const tokens = s.match(/\$[\d,.]+\s*k?|\b[\d,.]+\s*k\b/g);
  if (!tokens) return null;
  const vals = tokens
    .map((t) => {
      const isK = /k/.test(t);
      const num = Number(t.replace(/[$,k\s]/g, ''));
      return Number.isFinite(num) ? (isK ? num * 1000 : num) : NaN;
    })
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals), hourly };
}

/**
 * Does a job pass a pay filter? Filter values are in thousands for annual mode
 * (90 → $90k) and dollars-per-hour for hourly mode. Jobs with no parseable
 * salary always pass (so they aren't silently hidden) unless `hideUnknown` is
 * set, in which case they are excluded when the filter is active.
 *
 * @param {object} job
 * @param {{enabled:boolean, mode:'annual'|'hourly', min:number, max:number, hideUnknown?:boolean}} filter
 */
export function jobPassesPayFilter(job, filter) {
  if (!filter || !filter.enabled) return true;
  const parsed = parseJobPay(job?.salary);
  if (!parsed) return !filter.hideUnknown;
  const toAnnual = (v, isHourly) => (isHourly ? v * ANNUAL_HOURS : v);
  const toHourly = (v, isHourly) => (isHourly ? v : v / ANNUAL_HOURS);
  let jobMin, jobMax, fMin, fMax;
  if (filter.mode === 'hourly') {
    jobMin = toHourly(parsed.min, parsed.hourly);
    jobMax = toHourly(parsed.max, parsed.hourly);
    fMin = filter.min;
    fMax = filter.max;
  } else {
    jobMin = toAnnual(parsed.min, parsed.hourly);
    jobMax = toAnnual(parsed.max, parsed.hourly);
    fMin = filter.min * 1000;
    fMax = filter.max * 1000;
  }
  return jobMax >= fMin && jobMin <= fMax;
}

async function fetchRemotive(query, doFetch, signal) {
  const url = `${REMOTIVE_ENDPOINT}?limit=40${query ? `&search=${encodeURIComponent(query)}` : ''}`;
  const res = await doFetch(url, { signal });
  if (!res.ok) throw new Error(`Remotive responded ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data?.jobs) ? data.jobs : []).map(normalizeRemotiveJob);
}

async function fetchArbeitnow(query, doFetch, signal) {
  const res = await doFetch(ARBEITNOW_ENDPOINT, { signal });
  if (!res.ok) throw new Error(`Arbeitnow responded ${res.status}`);
  const data = await res.json();
  const jobs = (Array.isArray(data?.data) ? data.data : []).map(normalizeArbeitnowJob);
  return query ? jobs.filter((job) => jobMatchesQuery(job, query)) : jobs;
}

async function fetchAdzuna(query, doFetch, signal, cfg = {}) {
  const country = String(cfg.country || 'us').toLowerCase().replace(/[^a-z]/g, '') || 'us';
  const params = new URLSearchParams({
    app_id: cfg.appId,
    app_key: cfg.appKey,
    results_per_page: '40',
    'content-type': 'application/json',
  });
  if (query) params.set('what', query);
  const res = await doFetch(`${ADZUNA_ENDPOINT}/${country}/search/1?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Adzuna responded ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data?.results) ? data.results : []).map((r) => normalizeAdzunaJob(r, country));
}

async function fetchMuse(query, doFetch, signal) {
  // The Muse has no free-text param, so pull the first couple of (recent) pages
  // and filter client-side. Adds non-remote US/global breadth beyond the
  // remote-only boards.
  const jobs = [];
  for (const page of [1, 2]) {
    const res = await doFetch(`${MUSE_ENDPOINT}?page=${page}`, { signal });
    if (!res.ok) {
      if (page === 1) throw new Error(`The Muse responded ${res.status}`);
      break;
    }
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    results.forEach((r) => jobs.push(normalizeMuseJob(r)));
    if (!results.length) break;
  }
  return query ? jobs.filter((job) => jobMatchesQuery(job, query)) : jobs;
}

async function fetchUsaJobs(query, doFetch, signal, cfg = {}) {
  // MV3 fetch cannot inject User-Agent; require explicit headerInjection opt-in.
  if (!cfg.headerInjection) throw new Error('USAJOBS requires a header-injection workaround (declarativeNetRequest) in MV3. Enable headerInjection in settings.');
  const params = new URLSearchParams({ ResultsPerPage: '40' });
  if (query) params.set('Keyword', query);
  // USAJOBS requires Authorization-Key and the registered email as User-Agent.
  // NOTE: Chromium-based browsers silently strip User-Agent from fetch() headers
  // (Fetch spec forbidden-header list), so requests will likely fail auth in
  // extension service workers. A declarativeNetRequest rule would be needed to
  // inject this header for production use.
  const headers = { 'Authorization-Key': cfg.apiKey || '' };
  if (cfg.email) headers['User-Agent'] = cfg.email;
  const res = await doFetch(`${USAJOBS_ENDPOINT}?${params.toString()}`, { signal, headers });
  if (!res.ok) throw new Error(`USAJOBS responded ${res.status}`);
  const data = await res.json();
  const items = data?.SearchResult?.SearchResultItems;
  return (Array.isArray(items) ? items : []).map(normalizeUsaJobsJob);
}

async function fetchRemoteOk(query, doFetch, signal) {
  // RemoteOK returns an array; first element is a legal/metadata header — skip it.
  const res = await doFetch(REMOTEOK_ENDPOINT, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Remote OK responded ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data) ? data.slice(1) : [];
  const jobs = items.map(normalizeRemoteOkJob);
  return query ? jobs.filter((job) => jobMatchesQuery(job, query)) : jobs;
}

async function fetchJobicy(query, doFetch, signal) {
  const params = new URLSearchParams({ count: '50' });
  // Jobicy supports a `tag` param for keyword search and `geo` for region.
  if (query) params.set('tag', query);
  const res = await doFetch(`${JOBICY_ENDPOINT}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Jobicy responded ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data?.jobs) ? data.jobs : [];
  const jobs = items.map(normalizeJobicyJob);
  // Apply client-side filtering too since tag matching may be loose.
  return query ? jobs.filter((job) => jobMatchesQuery(job, query)) : jobs;
}

async function fetchWorkingNomads(query, doFetch, signal) {
  const res = await doFetch(WORKINGNOMADS_ENDPOINT, { signal });
  if (!res.ok) throw new Error(`Working Nomads responded ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data) ? data : [];
  const jobs = items.map(normalizeWorkingNomadsJob);
  return query ? jobs.filter((job) => jobMatchesQuery(job, query)) : jobs;
}

async function fetchReed(query, doFetch, signal, cfg = {}) {
  const params = new URLSearchParams({ resultsToTake: '40' });
  if (query) params.set('keywords', query);
  if (cfg.locationName) params.set('locationName', cfg.locationName);
  // Reed uses HTTP Basic auth: API key as username, empty password.
  const credentials = btoa(`${cfg.apiKey}:`);
  const res = await doFetch(`${REED_ENDPOINT}?${params.toString()}`, {
    signal,
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) throw new Error(`Reed responded ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data?.results) ? data.results : []).map(normalizeReedJob);
}

async function fetchJooble(query, doFetch, signal, cfg = {}) {
  const body = { keywords: query || '', location: cfg.location || '', page: '1', ResultOnPage: '20' };
  const res = await doFetch(`${JOOBLE_ENDPOINT}/${cfg.apiKey}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Jooble responded ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data?.jobs) ? data.jobs : []).map(normalizeJoobleJob);
}

// ── HackerNews Who's Hiring ──────────────────────────────────────────────────

// Cache the thread objectID to avoid refetching on repeat searches.
let _hnThreadId = null;
let _hnThreadFetchedAt = 0;
const HN_THREAD_CACHE_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Normalize a raw HN Algolia comment into the common job schema.
 * Comments follow "Company | Role | Location | ..." OR "Company: Role" formats.
 */
export function normalizeHnComment(raw = {}) {
  const objectID = String(raw.objectID || raw.id || '');
  const url = `https://news.ycombinator.com/item?id=${objectID}`;
  // Strip HTML tags and entities
  const rawText = cleanText(raw.comment_text || raw.text || '', 2000);

  let company = '';
  let title = '';
  let location = '';
  let remote = false;

  // Try pipe-delimited format first: "Company | Role | Location | ..."
  if (rawText.includes('|')) {
    const parts = rawText.split('|').map((p) => p.trim());
    company = cleanText(parts[0], 120);
    title = cleanText(parts[1] || '', 160);
    location = cleanText(parts[2] || '', 120);
    remote = isRemoteText(location, rawText);
  } else {
    // Fallback: "Company: Role" colon format
    const colonIdx = rawText.indexOf(':');
    if (colonIdx > 0 && colonIdx < 80) {
      company = cleanText(rawText.slice(0, colonIdx), 120);
      title = cleanText(rawText.slice(colonIdx + 1).trim(), 160);
    } else {
      // Last resort: treat first line as title
      title = cleanText(rawText.split('\n')[0], 160);
    }
    remote = isRemoteText(rawText);
  }

  return {
    id: `hn:${objectID}`,
    title: title || 'Untitled',
    company: company || 'Unknown',
    location: location || (remote ? 'Remote' : 'Unknown'),
    salary: '',
    remote,
    url,
    atsLabel: null,
    source: "HN: Who's Hiring",
    employment_type: '',
    posted: toIsoDate(raw.created_at),
    tags: [],
    description: cleanText(rawText, 600),
  };
}

async function fetchHnHiring(query, doFetch, signal) {

  // Get the latest "Who is hiring?" thread (with caching)
  const now = Date.now();
  if (!_hnThreadId || (now - _hnThreadFetchedAt) > HN_THREAD_CACHE_MS) {
    const threadUrl = `${HN_ALGOLIA_ENDPOINT}/search_by_date?query=Ask%20HN%3A%20Who%20is%20hiring%3F&tags=story,ask_hn&hitsPerPage=1`;
    const threadRes = await doFetch(threadUrl, { signal });
    if (!threadRes.ok) return [];
    const threadData = await threadRes.json();
    const hits = Array.isArray(threadData?.hits) ? threadData.hits : [];
    if (!hits.length) return [];
    // Sort by created_at descending and pick the most recent
    hits.sort((a, b) => (b.created_at_i || 0) - (a.created_at_i || 0));
    _hnThreadId = hits[0].objectID;
    _hnThreadFetchedAt = now;
  }

  const commentsUrl = `${HN_ALGOLIA_ENDPOINT}?tags=comment,story_${_hnThreadId}&hitsPerPage=50${query ? `&query=${encodeURIComponent(query)}` : ''}`;
  const commentsRes = await doFetch(commentsUrl, { signal });
  if (!commentsRes.ok) return [];
  const commentsData = await commentsRes.json();
  const hits = Array.isArray(commentsData?.hits) ? commentsData.hits : [];
  return hits.map(normalizeHnComment);
}

// ── We Work Remotely ─────────────────────────────────────────────────────────

/**
 * Normalize a WWR RSS <item> DOM element into the common job schema.
 * Title format: "Design & UX: Product Designer at Figma"
 */
export function normalizeWwrJob(item) {
  const titleRaw = cleanText(item.querySelector?.('title')?.textContent || '', 300);
  const link = cleanText(item.querySelector?.('link')?.textContent || item.querySelector?.('guid')?.textContent || '', 500);
  const pubDate = item.querySelector?.('pubDate')?.textContent || '';
  const description = cleanText(item.querySelector?.('description')?.textContent || '', 600);

  // Split on " at " to get "Category: Role" and company
  const atIdx = titleRaw.lastIndexOf(' at ');
  let rolePart = titleRaw;
  let company = '';
  if (atIdx > 0) {
    rolePart = titleRaw.slice(0, atIdx).trim();
    company = titleRaw.slice(atIdx + 4).trim();
  }

  // Strip the category prefix before the colon: "Design & UX: Product Designer" → "Product Designer"
  const colonIdx = rolePart.indexOf(':');
  const title = colonIdx >= 0 ? rolePart.slice(colonIdx + 1).trim() : rolePart;

  return {
    id: `wwr:${link || titleRaw}`,
    title: cleanText(title, 160),
    company: cleanText(company, 120),
    location: 'Remote',
    salary: '',
    remote: true,
    url: link,
    atsLabel: detectAtsLabelFromUrl(link),
    source: 'We Work Remotely',
    employment_type: '',
    posted: toIsoDate(pubDate),
    tags: [],
    description,
  };
}

async function fetchWwr(query, doFetch, signal) {

  const res = await doFetch(WWR_RSS_ENDPOINT, { signal });
  if (!res.ok) return [];
  const text = await res.text();
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml');
  } catch {
    return [];
  }
  const parseError = doc.querySelector('parsererror');
  if (parseError) return [];
  const items = Array.from(doc.querySelectorAll('item'));
  const jobs = items.map(normalizeWwrJob);
  return query ? jobs.filter((job) => jobMatchesQuery(job, query)) : jobs;
}

// ── remote.co ────────────────────────────────────────────────────────────────

/**
 * Normalize a remote.co RSS <item> DOM element into the common job schema.
 * Standard WordPress RSS. Title: "Role at Company".
 */
export function normalizeRemoteCoJob(item) {
  const titleRaw = cleanText(item.querySelector?.('title')?.textContent || '', 300);
  const link = cleanText(item.querySelector?.('link')?.textContent || item.querySelector?.('guid')?.textContent || '', 500);
  const pubDate = item.querySelector?.('pubDate')?.textContent || '';
  const description = cleanText(item.querySelector?.('description')?.textContent || '', 600);

  const atIdx = titleRaw.lastIndexOf(' at ');
  let title = titleRaw;
  let company = '';
  if (atIdx > 0) {
    title = titleRaw.slice(0, atIdx).trim();
    company = titleRaw.slice(atIdx + 4).trim();
  }

  return {
    id: `remoteco:${link || titleRaw}`,
    title: cleanText(title, 160),
    company: cleanText(company, 120),
    location: 'Remote',
    salary: '',
    remote: true,
    url: link,
    atsLabel: detectAtsLabelFromUrl(link),
    source: 'remote.co',
    employment_type: '',
    posted: toIsoDate(pubDate),
    tags: [],
    description,
  };
}

async function fetchRemoteCo(query, doFetch, signal) {

  const res = await doFetch(REMOTECO_RSS_ENDPOINT, { signal });
  if (!res.ok) return [];
  const text = await res.text();
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml');
  } catch {
    return [];
  }
  const parseError = doc.querySelector('parsererror');
  if (parseError) return [];
  const items = Array.from(doc.querySelectorAll('item'));
  const jobs = items.map(normalizeRemoteCoJob);
  return query ? jobs.filter((job) => jobMatchesQuery(job, query)) : jobs;
}

// ── Indeed (RSS-based) ──────────────────────────────────────────────────────────

async function fetchIndeed(query, doFetch, signal) {

  const searchUrl = new URL(`${INDEED_BASE_URL}/rss`);
  if (query) {
    searchUrl.searchParams.set('q', query);
  }
  searchUrl.searchParams.set('l', ''); // location empty for all
  searchUrl.searchParams.set('radius', '50');
  searchUrl.searchParams.set('sort', 'date');

  const res = await doFetch(searchUrl.toString(), { signal });
  if (!res.ok) return [];

  const text = await res.text();
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml');
  } catch {
    return [];
  }
  const parseError = doc.querySelector('parsererror');
  if (parseError) return [];

  const items = Array.from(doc.querySelectorAll('item'));
  const jobs = items.map(normalizeIndeedJob);
  return query ? jobs.filter((job) => jobMatchesQuery(job, query)) : jobs;
}

/**
 * Normalize an Indeed RSS item to common schema.
 */
export function normalizeIndeedJob(item) {
  const title = cleanText(item.querySelector('title')?.textContent, 160);
  const link = item.querySelector('link')?.textContent || '';
  const description = cleanText(item.querySelector('description')?.textContent || '', 6000);

  // Indeed RSS items often have company, location, and salary info in the description.
  // Extract from raw description text before cleaning, to preserve context.
  const rawDescriptionText = item.querySelector('description')?.textContent || '';

  // First, decode HTML entities in raw description for accurate regex matching
  const decodedDescription = rawDescriptionText
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/"/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  let company = 'Indeed'; // Default to Indeed if not found
  // Match "Company: Name" or "Employer: Name", handling <b> tags and <br/> or end of string
  // Patterns: <b>Company:</b> Name<br/> or Company: Name<br/>
  const companyMatch = decodedDescription.match(/(?:<b>)?(?:Company|Employer)[:\s]*(?:<\/b>)?[:\s]*([^<]+?)(?:<br\s*\/?>|$)/i);
  if (companyMatch && companyMatch[1].trim() !== '') {
    company = cleanText(companyMatch[1], 120);
  } else {
    // Fallback: use the fallthrough patterns
    const roleAtMatch = decodedDescription.match(/Role\s+at\s+([^<]+?)(?:\s*(?:<br\s*\/?>|\s*$))/i);
    if (roleAtMatch && roleAtMatch[1].trim() !== '') {
      company = cleanText(roleAtMatch[1], 120);
    } else {
      // Fallback: try to find company in title or description
      const titleOrDesc = `${title} ${description}`;
      const atCompanyMatch = titleOrDesc.match(/at\s+([A-Z][A-Za-z0-9\s&.,'-]+)(?:\s+-\s+|\s+\||\s+\(|<|$)/i);
      if (atCompanyMatch && atCompanyMatch[1].trim() !== '') {
        company = cleanText(atCompanyMatch[1], 120);
      } else {
        // Last resort: if title includes " at Company", use that
        const titleAtMatch = title.match(/(?:at)\s+([A-Za-z0-9\s&.,'-]+)$/i);
        if (titleAtMatch && titleAtMatch[1].trim() !== '') {
          company = cleanText(titleAtMatch[1], 120);
        }
      }
    }
  }

  let location = 'Various';
  // Only assign when an explicit marker (Location/location/Place) is present.
  // Avoids matching company names or unlabeled text from the title.
  const locationMatch = decodedDescription.match(/(?:<b>)?(?:Location|Place)[:\s]*(?:<\/b>)?[\s:]*([^<]+?)(?:<br\s*\/?>|$)/i);
  if (locationMatch && locationMatch[1].trim() !== '') {
    location = cleanText(locationMatch[1], 120);
  } else {
    // Tight fallback: only match title suffixes ending with US state or Remote
    const titleLocationMatch = title.match(/(?:in|at)\s+(Remote|[A-Za-z\s]+(?:,\s*[A-Z]{2}))$/i);
    if (titleLocationMatch) {
      location = cleanText(titleLocationMatch[1], 120);
    }
  }

  const remote = isRemoteText(title, description, rawDescriptionText, location);

  let salaryText = '';
  let parsedSalary = null;
  // Use decodedDescription which has HTML entities decoded
  const salaryMatch = decodedDescription.match(/<b>Salary:<\/b>\s*([^<]+?)(?:<br\s*\/?>|$)/i);
  if (salaryMatch) {
    salaryText = salaryMatch[1];
    parsedSalary = parseJobPay(salaryText);
  }

  // Safely parse link — malformed URLs must not abort normalization
  let jobId;
  try {
    const urlObj = new URL(link);
    jobId = urlObj.searchParams.get('jk') || link.split('/').pop()?.split('?')[0];
  } catch {
    jobId = null;
  }
  if (!jobId) jobId = item.querySelector('guid')?.textContent || `${title}-${company}`.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const id = `indeed:${jobId}`;

  const pubDate = item.querySelector('pubDate')?.textContent;

  return {
    id: id,
    title: cleanText(title, 160),
    company: company,
    location: location,
    salary: cleanText(salaryText, 60),
    salary_min: parsedSalary?.min,
    salary_max: parsedSalary?.max,
    salary_interval: parsedSalary ? (parsedSalary.hourly ? 'hourly' : 'yearly') : 'yearly',
    remote,
    url: link,
    atsLabel: detectAtsLabelFromUrl(link),
    source: 'Indeed',
    employment_type: '',
    posted: pubDate ? toIsoDate(pubDate) : '',
    tags: [],
    description: cleanText(description, 6000),
  };
}

    // ── Hackajob (sitemap + JSON-LD scraping) ────────────────────────────────────

    /**
     * Normalize a Hackajob JSON-LD JobPosting object into the common schema.
     * Hackajob has no public API; job detail pages embed standard schema.org
     * JobPosting JSON-LD. The sitemap provides URLs + lastmod dates.
     */
    export function normalizeHackajobJob(raw = {}) {
      const url = String(raw.url || '').trim();
      const uuid = String(raw.identifier?.value || raw.identifier || '');
      const id = `hackajob:${uuid || url}`;
      const title = cleanText(raw.title, 160);
      const company = cleanText(raw.hiringOrganization?.name ?? raw.hiringOrganization, 120);

      // Hackajob uses applicantLocationRequirements (Country) instead of jobLocation.
      const locReq = Array.isArray(raw.applicantLocationRequirements)
        ? raw.applicantLocationRequirements[0]
        : raw.applicantLocationRequirements;
      const location = cleanText(locReq?.name ?? locReq, 120);

      const remote = String(raw.jobLocationType || '').toUpperCase().includes('TELECOMMUTE')
        || isRemoteText(title, raw.description);

      // Parse salary from baseSalary MonetaryAmount.
      let salaryText = '';
      let salaryMin = null;
      let salaryMax = null;
      let salaryInterval = 'yearly';
      const bs = raw.baseSalary;
      if (bs && typeof bs === 'object') {
        const v = bs.value;
        const unit = String(v?.unitText || '').toUpperCase();
        const hourly = unit.includes('HOUR');
        salaryInterval = hourly ? 'hourly' : 'yearly';
        const min = Number(v?.minValue);
        const max = Number(v?.maxValue);
        if (!Number.isNaN(min) && min > 0) salaryMin = min;
        if (!Number.isNaN(max) && max > 0) salaryMax = max;
        const fmt = (n) => (hourly ? `$${n}` : `$${Math.round(n / 1000)}k`);
        if (salaryMin && salaryMax) salaryText = `${fmt(salaryMin)} - ${fmt(salaryMax)}${hourly ? '/hr' : ''}`;
        else if (salaryMin) salaryText = `${fmt(salaryMin)}${hourly ? '/hr' : ''}+`;
      }

      return {
        id,
        title: title || 'Untitled',
        company: company || 'Unknown',
        location: location || (remote ? 'Remote' : 'Unknown'),
        salary: salaryText,
        salary_min: salaryMin,
        salary_max: salaryMax,
        salary_interval: salaryInterval,
        remote,
        url,
        atsLabel: detectAtsLabelFromUrl(url),
        source: 'Hackajob',
        employment_type: normalizeEmploymentType(raw.employmentType),
        posted: toIsoDate(raw.datePosted),
        tags: Array.isArray(raw.skills)
      ? raw.skills.map((s) => cleanText(s, 80))
      : String(raw.skills || '').split(',').map((s) => cleanText(s, 80)).filter(Boolean),
        description: cleanText(raw.description, 6000),
      };
    }

    function normalizeEmploymentType(employmentType) {
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

    /**
     * Fetch Hackajob jobs. Hackajob has no public API, so we:
     *   1. Fetch the jobs sitemap (URLs + lastmod).
     *   2. Dedupe by UUID (skip /en-us/ locale variants).
     *   3. Sort by lastmod desc, take the most recent N.
     *   4. Fetch each detail page and extract the JSON-LD JobPosting.
     * @param {string} query
     * @param {Function} doFetch
     * @param {AbortSignal} signal
     */
    async function fetchHackajob(query, doFetch, signal) {
      const res = await doFetch(HACKAJOB_SITEMAP_ENDPOINT, { signal });
      if (!res.ok) throw new Error(`Hackajob responded ${res.status}`);
      const text = await res.text();

      let doc;
      try {
        doc = new DOMParser().parseFromString(text, 'text/xml');
      } catch {
        return [];
      }
      if (doc.querySelector('parsererror')) return [];

      // Collect { url, lastmod } from <url> entries, deduping by UUID.
      const seen = new Set();
      const entries = [];
      for (const urlEl of Array.from(doc.querySelectorAll('url'))) {
        const loc = urlEl.querySelector('loc')?.textContent?.trim() || '';
        if (!loc) continue;
        // Skip locale variants (e.g. /en-us/job/...) — keep the canonical /job/ URL.
        const m = loc.match(/\/job\/([0-9a-f-]+)/i);
        if (!m) continue;
        const uuid = m[1];
        if (seen.has(uuid)) continue;
        seen.add(uuid);
        const lastmod = urlEl.querySelector('lastmod')?.textContent?.trim() || '';
        entries.push({ url: loc, lastmod });
      }

      // Sort by lastmod desc (most recent first).
      entries.sort((a, b) => (Date.parse(b.lastmod) || 0) - (Date.parse(a.lastmod) || 0));

      // Fetch detail pages for the most recent jobs (cap to keep it fast).
      const MAX_DETAIL_FETCHES = 20;
      const jobs = [];
      for (const entry of entries.slice(0, MAX_DETAIL_FETCHES)) {
        if (signal?.aborted) break;
        try {
          const pageRes = await doFetch(entry.url, { signal });
          if (!pageRes.ok) continue;
          const html = await pageRes.text();
          const parsed = parseHackajobJsonLd(html);
          if (parsed) {
            parsed.url = entry.url;
            jobs.push(normalizeHackajobJob(parsed));
          }
        } catch {
          // Skip individual page failures — don't abort the whole source.
        }
      }

      return query ? jobs.filter((job) => jobMatchesQuery(job, query)) : jobs;
    }

    /**
     * Extract the first JobPosting JSON-LD object from a Hackajob detail page HTML.
     * @param {string} html
     * @returns {object|null}
     */
    export function parseHackajobJsonLd(html) {
      const m = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!m) return null;
      try {
        const data = JSON.parse(m[1]);
        if (data?.['@type'] === 'JobPosting') return data;
        // Handle @graph wrapping.
        if (Array.isArray(data?.['@graph'])) {
          const posting = data['@graph'].find((n) => n?.['@type'] === 'JobPosting');
          if (posting) return posting;
        }
      } catch {
        return null;
      }
      return null;
    }

    // ── Custom user-configured RSS sources ───────────────────────────────────────
//
// Lets a user point the search panel at any RSS-based job board the built-in
// registry doesn't cover — a state workforce board (e.g. JOBS4TN.gov), a
// niche ATS feed, an internal careers RSS, etc. The search criteria usually
// live in the feed URL itself (most boards' RSS endpoints accept query
// params), so "search criteria" here means "the URL you paste already
// encodes what you searched for."

/**
 * Normalize a generic RSS <item> DOM element into the common job schema.
 * Unlike the WWR/remote.co normalizers, the title format of an arbitrary
 * board is unknown, so this only splits recognizable "Title at Company" /
 * "Title - Company" suffixes and otherwise falls back to the raw title with
 * the source label standing in for company.
 * @param {Element} item
 * @param {{id:string, label:string}} sourceMeta
 */
export function normalizeCustomRssJob(item, sourceMeta = {}) {
  const titleRaw = cleanText(item.querySelector?.('title')?.textContent || '', 300);
  const link = cleanText(item.querySelector?.('link')?.textContent || item.querySelector?.('guid')?.textContent || '', 500);
  const pubDate = item.querySelector?.('pubDate')?.textContent || '';
  const description = cleanText(item.querySelector?.('description')?.textContent || '', 600);

  let title = titleRaw;
  let company = '';
  const atIdx = titleRaw.lastIndexOf(' at ');
  const dashIdx = titleRaw.lastIndexOf(' - ');
  if (atIdx > 0) {
    title = titleRaw.slice(0, atIdx).trim();
    company = titleRaw.slice(atIdx + 4).trim();
  } else if (dashIdx > 0) {
    title = titleRaw.slice(0, dashIdx).trim();
    company = titleRaw.slice(dashIdx + 3).trim();
  }

  const remote = isRemoteText(titleRaw, description);
  const sourceLabel = sourceMeta.label || 'Custom Source';

  return {
    id: `${sourceMeta.id || 'custom'}:${link || titleRaw}`,
    title: cleanText(title, 160) || 'Untitled',
    company: cleanText(company, 120) || sourceLabel,
    location: remote ? 'Remote' : 'Unknown',
    salary: '',
    remote,
    url: link,
    atsLabel: detectAtsLabelFromUrl(link),
    source: sourceLabel,
    employment_type: '',
    posted: toIsoDate(pubDate),
    tags: [],
    description,
  };
}

async function fetchCustomRssSource(sourceMeta, query, doFetch, signal) {
  let url = sourceMeta.url;
  if (!isPublicHttpsUrl(url)) throw new Error(`${sourceMeta.label || 'Custom source'} must use a public HTTPS URL without embedded credentials.`);
  if (query) {
    try {
      const u = new URL(url);
      if (!u.searchParams.has('q') && !u.searchParams.has('query') && !u.searchParams.has('keywords')) {
        u.searchParams.set('q', query);
      }
      url = u.toString();
    } catch {
      // Not an absolute URL we can safely append params to — fetch as-is.
    }
  }
  const res = await doFetch(url, { signal });
  if (!res.ok) throw new Error(`${sourceMeta.label || 'Custom source'} responded ${res.status}`);

  const contentLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_CUSTOM_RSS_BYTES) {
    throw new Error(`${sourceMeta.label || 'Custom source'} response is too large.`);
  }

  const text = await res.text();
  if (text.length > MAX_CUSTOM_RSS_BYTES) {
    throw new Error(`${sourceMeta.label || 'Custom source'} response is too large.`);
  }
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml');
  } catch {
    return [];
  }
  if (doc.querySelector('parsererror')) return [];
  const items = Array.from(doc.querySelectorAll('item'));
  const jobs = items.map((item) => normalizeCustomRssJob(item, sourceMeta));
  return query ? jobs.filter((job) => jobMatchesQuery(job, query)) : jobs;
}

/**
 * Short, deterministic FNV-1a hash (base36) used to disambiguate fallback
 * source IDs derived from user-editable text (labels, URLs).
 * @param {string} value
 * @returns {string}
 */
function shortHash(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * A custom RSS source's search query is appended to its URL and sent as a
 * plaintext GET request — over `http:` that query (which can reveal a job
 * seeker's search terms, and combined with the feed URL, plausibly their
 * job-hunting activity) is visible to anyone on the network path (CWE-319).
 * @param {string} url
 * @returns {boolean}
 */
function isPublicHttpsUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;

    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '0.0.0.0' || hostname === '::1') return false;

    const ipv4 = hostname.match(/^(\\d+)\\.(\\d+)\\.(\\d+)\\.(\\d+)$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((n) => n > 255)) return false;
      const [a, b] = octets;
      if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

const MAX_CUSTOM_RSS_BYTES = 1_000_000;

/**
 * Build source-registry-shaped entries from user-configured custom RSS
 * sources so they merge into the same search/filter machinery as the
 * built-in boards. Non-HTTPS URLs are dropped rather than registered.
 * @param {Array<{id?:string, label:string, url:string}>} customSources
 */
export function buildCustomJobSources(customSources = []) {
  if (!Array.isArray(customSources)) return [];
  return customSources
    .filter((s) => s && String(s.url || '').trim() && isPublicHttpsUrl(String(s.url).trim()))
    .map((s) => {
      const label = cleanText(s.label, 60) || 'Custom Source';
      const url = String(s.url).trim();
      // Two sources can share a label (e.g. both called "Jobs") but point at
      // different URLs; a label-only fallback ID would collide and make
      // resolveActiveSources() activate both under one id. Mix in a short
      // hash of the URL so same-label sources still get distinct, stable ids.
      const id = String(s.id || `custom-${normalizeKey(label).replace(/\s+/g, '-')}-${shortHash(url)}`);
      const meta = { id, label, url };
      return {
        id,
        label,
        keyless: true,
        custom: true,
        available: () => true,
        run: (q, ctx) => fetchCustomRssSource(meta, q, ctx.doFetch, ctx.signal),
      };
    });
}

/**
 * The built-in registry plus any user-configured custom sources from
 * `config.customSources`.
 */
function getAllSources(config = {}) {
  return JOB_SOURCES.concat(buildCustomJobSources(config.customSources));
}

// ── LinkedIn (session-based via content-script relay) ────────────────────────

/**
 * Normalize a LinkedIn Voyager JobPosting object from the `included` array.
 */
export function normalizeLinkedInJob(raw = {}, companyMap = {}) {
  // Extract the numeric ID from the entityUrn (e.g. "urn:li:fsd_jobPosting:1234567")
  const urn = String(raw.entityUrn || '');
  const id = urn.split(':').pop() || urn;
  const url = id ? `https://www.linkedin.com/jobs/view/${id}/` : '';
  const company = companyMap[raw.companyDetails?.company] || '';
  return {
    id: `linkedin:${id || url}`,
    title: cleanText(raw.title, 160),
    company: cleanText(company, 120),
    location: cleanText(raw.formattedLocation, 120),
    salary: raw.salary || raw.formattedSalary || '',
    remote: !!raw.workRemoteAllowed,
    url,
    atsLabel: 'LinkedIn',
    source: 'LinkedIn',
    employment_type: '',
    posted: raw.listedAt ? toIsoDate(raw.listedAt / 1000) : '',
    tags: [],
    description: cleanText(raw.description?.text, 600),
  };
}

/**
 * Build a companyMap from LinkedIn `included` objects and map JobPosting entries.
 */
export function parseLinkedInVoyagerResponse(data = {}) {
  const included = Array.isArray(data.included) ? data.included : [];

  // Build a map from company URN → company name
  const companyMap = {};
  for (const item of included) {
    if (item && typeof item.$type === 'string' && item.$type.includes('Company')) {
      const companyUrn = String(item.entityUrn || '');
      if (companyUrn && item.name) {
        companyMap[companyUrn] = cleanText(item.name, 120);
      }
    }
  }

  // Filter JobPosting objects and normalize
  return included
    .filter((item) => item && typeof item.$type === 'string' && item.$type.includes('JobPosting'))
    .map((item) => {
      const normalized = normalizeLinkedInJob(item, companyMap);

      // Add salary_range if salary is present
      if (normalized.salary) {
        const parsedPay = parseJobPay(normalized.salary);
        if (parsedPay?.min || parsedPay?.max) {
          normalized.salary_min = parsedPay.min;
          normalized.salary_max = parsedPay.max;
          normalized.salary_interval = parsedPay.hourly ? 'hourly' : 'yearly';
        }
      }

      return normalized;
    });
}

async function fetchLinkedInViaChrome(query, ctx) {
  const chromeApi = ctx.chrome;
  if (!chromeApi) throw new Error('chrome API not available in this context.');

  // 1. Find an open LinkedIn tab
  const tabs = await chromeApi.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (!tabs || !tabs.length) throw new Error('Open LinkedIn in a browser tab first.');

  const tab = tabs[0];

  // 2. Get the JSESSIONID cookie for CSRF token
  const cookie = await chromeApi.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' });
  if (!cookie) throw new Error('Sign in to LinkedIn first.');

  // Strip surrounding quotes from cookie value
  const csrfToken = String(cookie.value || '').replace(/^"|"$/g, '');

  // 3. Send message to content script
  const resp = await chromeApi.tabs.sendMessage(tab.id, {
    type: 'FETCH_LINKEDIN_JOBS',
    payload: { query, csrfToken },
  });

  if (!resp || !resp.success) {
    throw new Error(resp?.error || 'LinkedIn fetch failed via content script.');
  }

  // Update sessionActive state in config
  if (ctx.config?.linkedin) {
    ctx.config.linkedin.sessionActive = true;
  }

  return parseLinkedInVoyagerResponse(resp.data);
}

// ── Source registry (plug-and-play) ─────────────────────────────────────────
//
// Add a new job board by appending one entry here. Each source declares:
//   id        stable key used by the UI toggle + `sources` filter
//   label     display name
//   keyless   true if it works with no credentials (enabled by default)
//   requires  human hint for what unlocks it (key/OAuth), shown when unavailable
//   available (config) => boolean  — is it usable given the user's credentials
//   run       (query, ctx) => Promise<normalizedJob[]>
// `ctx` is { doFetch, signal, config } so sources stay testable + uniform.

export const JOB_SOURCES = [
  {
    id: 'remotive',
    label: 'Remotive',
    keyless: true,
    available: () => true,
    run: (q, ctx) => fetchRemotive(q, ctx.doFetch, ctx.signal),
  },
  {
    id: 'arbeitnow',
    label: 'Arbeitnow',
    keyless: true,
    available: () => true,
    run: (q, ctx) => fetchArbeitnow(q, ctx.doFetch, ctx.signal),
  },
  {
    id: 'themuse',
    label: 'The Muse',
    keyless: true,
    available: () => true,
    run: (q, ctx) => fetchMuse(q, ctx.doFetch, ctx.signal),
  },
  {
    id: 'adzuna',
    label: 'Adzuna',
    keyless: false,
    requires: 'Adzuna API keys (AI panel)',
    available: (config) => !!(config?.adzuna?.appId && config?.adzuna?.appKey),
    run: (q, ctx) => fetchAdzuna(q, ctx.doFetch, ctx.signal, ctx.config?.adzuna || {}),
  },
  {
    id: 'usajobs',
    label: 'USAJOBS',
    keyless: false,
    requires: 'USAJOBS email + API key (AI panel)',
    available: (config) => !!(config?.usajobs?.email && config?.usajobs?.apiKey && config?.usajobs?.headerInjection),
    run: (q, ctx) => fetchUsaJobs(q, ctx.doFetch, ctx.signal, ctx.config?.usajobs || {}),
  },
  {
    id: 'remoteok',
    label: 'Remote OK',
    keyless: true,
    available: () => true,
    run: (q, ctx) => fetchRemoteOk(q, ctx.doFetch, ctx.signal),
  },
  {
    id: 'jobicy',
    label: 'Jobicy',
    keyless: true,
    available: () => true,
    run: (q, ctx) => fetchJobicy(q, ctx.doFetch, ctx.signal),
  },
  {
    id: 'workingnomads',
    label: 'Working Nomads',
    keyless: true,
    available: () => true,
    run: (q, ctx) => fetchWorkingNomads(q, ctx.doFetch, ctx.signal),
  },
  {
    id: 'reed',
    label: 'Reed',
    keyless: false,
    requires: 'Reed API key (AI panel)',
    available: (config) => !!(config?.reed?.apiKey),
    run: (q, ctx) => fetchReed(q, ctx.doFetch, ctx.signal, ctx.config?.reed || {}),
  },
  {
    id: 'jooble',
    label: 'Jooble',
    keyless: false,
    requires: 'Jooble API key (AI panel)',
    available: (config) => !!(config?.jooble?.apiKey),
    run: (q, ctx) => fetchJooble(q, ctx.doFetch, ctx.signal, ctx.config?.jooble || {}),
  },
  {
    id: 'hn-hiring',
    label: "HN: Who's Hiring",
    keyless: true,
    available: () => true,
    run: (q, ctx) => fetchHnHiring(q, ctx.doFetch, ctx.signal),
  },
  {
    id: 'weworkremotely',
    label: 'We Work Remotely',
    keyless: true,
    available: () => true,
    run: (q, ctx) => fetchWwr(q, ctx.doFetch, ctx.signal),
  },
  {
    id: 'remoteco',
    label: 'remote.co',
    keyless: true,
    available: () => true,
    run: (q, ctx) => fetchRemoteCo(q, ctx.doFetch, ctx.signal),
  },
  {
    id: 'indeed',
    label: 'Indeed',
    keyless: false,
    available: () => true,
    run: (q, ctx) => fetchIndeed(q, ctx.doFetch, ctx.signal),
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    keyless: false,
    session: true,
    requires: 'Sign in to LinkedIn in any open browser tab',
    available: (config) => !!config?.linkedin?.sessionActive,
    run: (q, ctx) => fetchLinkedInViaChrome(q, ctx),
  },
    {
      id: 'hackajob',
      label: 'Hackajob',
      keyless: true,
      available: () => true,
      run: (q, ctx) => fetchHackajob(q, ctx.doFetch, ctx.signal),
    },
  ];

/**
 * Describe every registered source and whether it's currently usable, for the
 * UI to render togglable filter chips.
 * @param {object} [config]
 */
export function listJobSources(config = {}) {
  return getAllSources(config).map((src) => ({
    id: src.id,
    label: src.label,
    keyless: !!src.keyless,
    session: !!src.session,
    custom: !!src.custom,
    available: !!src.available(config),
    requires: src.requires || null,
  }));
}

/**
 * Resolve which sources to actually query: must be available, and (if a
 * `sources` allow-list is given) selected. With no allow-list, every available
 * source runs by default.
 */
export function resolveActiveSources(config = {}, sources) {
  return getAllSources(config).filter((src) => {
    if (Array.isArray(sources)) {
      if (!sources.includes(src.id)) return false;
      // For session-gated sources (LinkedIn), trust explicit selection
      // over the sessionActive flag — the run function handles detection.
      if (src.session) return true;
      // For non-session sources, still respect availability
      if (!src.available(config)) return false;
      return true;
    }
    if (!src.available(config)) return false;
    return true;
  });
}

/**
 * Search jobs across the selected/available sources, normalized + deduped +
 * sorted by recency.
 *
 * @param {string} query
 * @param {{ fetchImpl?: Function, limit?: number, signal?: AbortSignal,
 *           config?: object, sources?: string[] }} [opts]
 * @returns {Promise<{ jobs: object[], sources: object[] }>}
 */
export async function searchJobs(query, { fetchImpl, limit = 40, signal, config = {}, sources, chrome: chromeOpt } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error('No network fetch implementation is available.');

  const q = String(query || '').trim();
  const chromeGlobal = (typeof chrome !== 'undefined') ? chrome : null;
  const ctx = { doFetch, signal, config, chrome: chromeOpt !== undefined ? chromeOpt : chromeGlobal };
  const active = resolveActiveSources(config, sources);
  if (!active.length) {
    return { jobs: [], sources: [] };
  }

  const settled = await Promise.allSettled(active.map((src) => src.run(q, ctx)));
  const jobs = [];
  const sourceStatus = [];
  settled.forEach((result, idx) => {
    const src = active[idx];
    if (result.status === 'fulfilled') {
      jobs.push(...result.value);
      sourceStatus.push({ id: src.id, name: src.label, ok: true, count: result.value.length });
    } else {
      sourceStatus.push({ id: src.id, name: src.label, ok: false, error: result.reason?.message || 'failed' });
    }
  });

  const deduped = dedupeJobs(jobs);
  deduped.sort((a, b) => (Date.parse(b.posted) || 0) - (Date.parse(a.posted) || 0));

  if (!deduped.length && sourceStatus.length && sourceStatus.every((s) => !s.ok)) {
    throw new Error('All selected job sources are unavailable right now. Try again shortly.');
  }

  return { jobs: deduped.slice(0, limit), sources: sourceStatus };
}
