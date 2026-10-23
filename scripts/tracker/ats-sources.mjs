/**
 * ats-fill — scripts/tracker/ats-sources.mjs
 * Direct company job boards: Greenhouse, Ashby and Lever expose public,
 * keyless JSON for each company's own careers page. Reading them gives fresher
 * postings than resale job boards, and Ashby reports pay ranges when the
 * company lists them. Used by job-scan.mjs; no tracker writes.
 *
 * Add a company by slug; a slug that stops resolving is reported in the scan's
 * errors rather than failing the run.
 */

/** Board slugs verified to return 200 from each public API. */
export const ATS_BOARDS = {
  greenhouse: ['stripe', 'cloudflare', 'datadog', 'elastic', 'gitlab', 'twilio', 'databricks', 'okta', 'duolingo', 'dropbox', 'asana', 'zscaler', 'pagerduty', 'figma', 'airtable', 'brex', 'coinbase', 'robinhood', 'instacart', 'samsara', 'anthropic', 'vercel', 'gusto', 'lattice'],
  ashby: ['ramp', 'linear', 'supabase', 'notion', 'mercury', 'replit', 'vanta', 'deel', 'benchling', 'openai', 'cursor', 'perplexity', 'writer', 'harvey'],
  lever: ['palantir', 'spotify', 'neon'],
};

const UA = 'Mozilla/5.0 (ats-fill job-scan; read-only)';
const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_RE = new RegExp(`\\b(USA|US|U\\.S\\.|United States)\\b|, (${US_STATES})\\b`);
const OTHER_COUNTRY_RE = /\b(UK|United Kingdom|Canada|Germany|France|India|Mexico|Brazil|Ireland|Netherlands|Spain|Italy|Poland|Australia|Japan|Singapore|Israel|London|Berlin|Paris|Dublin|Toronto|Bangalore|Amsterdam|Remote \(Canada\))\b/i;

/**
 * Where a posting can be done from. 'us' = US is named; 'remote' = remote with
 * no country (the scan flags these for a manual check); 'other' = a non-US
 * place is named; 'unknown' = no location at all.
 */
export function locationKind(location = '') {
  const loc = String(location || '').trim();
  if (!loc) return 'unknown';
  if (US_RE.test(loc)) return 'us';
  if (OTHER_COUNTRY_RE.test(loc)) return 'other';
  if (/remote|anywhere/i.test(loc)) return 'remote';
  return 'other';
}

/** Decode the HTML entities Greenhouse uses and strip tags. */
export function htmlToText(html = '') {
  return String(html)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Salary field such as "$120k - $150k" or "120000-150000" → {min, max}, or null. */
export function parseSalary(text) {
  if (!text) return null;
  const nums = [...String(text).matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi)]
    .map((m) => Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1))
    .filter((n) => Number.isFinite(n) && n >= 1000);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/**
 * Prose from a job description: only dollar amounts count, so years, phone
 * numbers and headcounts are never read as pay.
 */
export function parseSalaryFromText(text = '') {
  const nums = [...String(text).matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi)]
    .map((m) => Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1))
    .filter((n) => Number.isFinite(n) && n >= 10000);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export async function fromGreenhouse(slug) {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  return (data.jobs || []).map((j) => {
    const text = htmlToText(j.content || '');
    const location = j.location?.name || '';
    return {
      source: `Greenhouse/${slug}`,
      title: j.title,
      company: j.company_name || slug,
      url: j.absolute_url,
      location,
      posted: j.first_published || j.updated_at || '',
      salaryText: '',
      salary: parseSalaryFromText(text),
      text: `${j.title} ${location} ${text}`,
    };
  });
}

export async function fromAshby(slug) {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
  return (data.jobs || []).map((j) => {
    const salaryText = j.compensation?.scrapeableCompensationSalarySummary || j.compensation?.compensationTierSummary || '';
    const location = [j.location, ...(j.secondaryLocations || []).map((s) => s.location)].filter(Boolean).join('; ');
    return {
      source: `Ashby/${slug}`,
      title: j.title,
      company: slug,
      url: j.jobUrl,
      location,
      posted: j.publishedAt || '',
      salaryText,
      salary: parseSalary(salaryText) || parseSalaryFromText(j.descriptionPlain || ''),
      text: `${j.title} ${location} ${j.descriptionPlain || ''}`,
    };
  });
}

export async function fromLever(slug) {
  const data = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  return (Array.isArray(data) ? data : []).map((j) => {
    const text = j.descriptionPlain || '';
    const location = j.categories?.location || '';
    return {
      source: `Lever/${slug}`,
      title: j.text,
      company: slug,
      url: j.hostedUrl,
      location,
      posted: j.createdAt ? new Date(j.createdAt).toISOString() : '',
      salaryText: '',
      salary: parseSalaryFromText(text),
      text: `${j.text} ${location} ${text}`,
    };
  });
}

/**
 * Fetch every configured board. One bad slug doesn't stop the others.
 * @returns {Promise<{jobs: object[], errors: string[]}>}
 */
export async function fetchAllBoards(boards = ATS_BOARDS) {
  const fetchers = { greenhouse: fromGreenhouse, ashby: fromAshby, lever: fromLever };
  const jobs = [];
  const errors = [];
  for (const [ats, slugs] of Object.entries(boards)) {
    for (const slug of slugs) {
      try {
        jobs.push(...await fetchers[ats](slug));
      } catch (err) {
        errors.push(`${ats}/${slug}: ${err.message}`);
      }
    }
  }
  return { jobs, errors };
}
