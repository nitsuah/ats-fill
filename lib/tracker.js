/**
 * apply-bot — tracker.js
 * Application tracking helpers.
 * These run in the service worker context using chrome.storage.local.
 */

/**
 * Add or update an application entry in the tracker.
 *
 * @param {object} app
 * @param {string} app.company
 * @param {string} app.title
 * @param {string} app.url
 * @param {string} [app.status]     Defaults to 'filled'.
 * @param {string} [app.jd_snippet] Short snippet of the JD.
 * @returns {Promise<object>} The saved application entry.
 */
export async function addApplication(app) {
  const data = await chrome.storage.local.get('applications');
  const applications = data.applications || [];
  const now = new Date().toISOString();
  const normalizedStatus = normalizeApplicationStatus(app.status || 'filled');
  const existingIdx = applications.findIndex((entry) => entry.url && app.url && entry.url === app.url);
  const existing = existingIdx >= 0 ? applications[existingIdx] : {};
  const payBand = resolvePayBand({
    pay_min: app.pay_min ?? existing.pay_min,
    pay_max: app.pay_max ?? existing.pay_max,
    salary_range: app.salary_range ?? existing.salary_range,
  });

  const nextStatus = existingIdx >= 0
    ? pickHigherPriorityStatus(applications[existingIdx].status, normalizedStatus)
    : normalizedStatus;

  const entry = {
    id: existingIdx >= 0 ? applications[existingIdx].id : crypto.randomUUID(),
    company: app.company || existing.company || '',
    title: app.title || existing.title || '',
    url: app.url || existing.url || '',
    status: nextStatus,
    sort_order: existingIdx >= 0
      ? normalizeSortOrder(applications[existingIdx].sort_order, 0)
      : getNextSortOrder(applications),
    date: normalizeTrackerDate(app.date) || existing.date || now.slice(0, 10),
    updated_at: now,
    // Where the listing came from (Job Search source id, or blank for manual /
    // on-page saves — analytics falls back to deriving it from the URL).
    source: String(app.source || existing.source || '').trim(),
    first_response_at: resolveFirstResponseAt({ current: existing, nextStatus, now }),
    jd_snippet: String(app.jd_snippet || existing.jd_snippet || '').slice(0, 300),
    description: String(app.description || existing.description || app.jd_snippet || '').slice(0, 6000),
    location: String(app.location || existing.location || 'Unknown').trim() || 'Unknown',
    employment_type: normalizeEmploymentType(app.employment_type ?? existing.employment_type),
    remote: app.remote !== undefined ? Boolean(app.remote) : Boolean(existing.remote),
    pay_min: payBand.min,
    pay_max: payBand.max,
    salary_range: formatSalaryRange(payBand.min, payBand.max) || String(app.salary_range || existing.salary_range || '').trim(),
    scorecard: String(app.scorecard || existing.scorecard || '').trim(),
    verdict: String(app.verdict || existing.verdict || '').trim(),
    answers_generated: Boolean(app.answers_generated || existing.answers_generated),
    fill_report: app.fill_report || existing.fill_report || null,
  };

  if (existingIdx >= 0) {
    applications[existingIdx] = entry;
  } else {
    applications.push(entry);
  }

  await chrome.storage.local.set({ applications });
  return entry;
}

/**
 * Retrieve all tracked applications.
 * @returns {Promise<object[]>}
 */
export async function getApplications() {
  const data = await chrome.storage.local.get('applications');
  const applications = data.applications || [];
  let changed = false;
  const migrated = applications.map((entry) => {
    const payBand = resolvePayBand(entry);
    const nextSalaryRange = formatSalaryRange(payBand.min, payBand.max) || String(entry.salary_range || '').trim();
    if (entry.pay_min === payBand.min && entry.pay_max === payBand.max && String(entry.salary_range || '') === nextSalaryRange) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      pay_min: payBand.min,
      pay_max: payBand.max,
      salary_range: nextSalaryRange,
    };
  });

  if (changed) {
    await chrome.storage.local.set({ applications: migrated });
  }

  return migrated;
}

/**
 * Update editable fields on an existing application entry.
 *
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object|null>} The updated application, or null if not found.
 */
export async function updateApplication(id, patch = {}) {
  const data = await chrome.storage.local.get('applications');
  const applications = data.applications || [];
  const idx = applications.findIndex((a) => a.id === id);
  if (idx === -1) return null;

  const current = applications[idx];
  const now = new Date().toISOString();
  const nextStatus = patch.status !== undefined ? normalizeApplicationStatus(patch.status) : current.status;
  const nextDate = resolveSubmissionDate({ current, patch, nextStatus });
  const payBand = resolvePayBand({
    pay_min: patch.pay_min !== undefined ? patch.pay_min : current.pay_min,
    pay_max: patch.pay_max !== undefined ? patch.pay_max : current.pay_max,
    salary_range: patch.salary_range !== undefined ? patch.salary_range : current.salary_range,
  });

  const next = {
    ...current,
    company: patch.company !== undefined ? String(patch.company || '').trim() : current.company,
    title: patch.title !== undefined ? String(patch.title || '').trim() : current.title,
    url: patch.url !== undefined ? String(patch.url || '').trim() : current.url,
    status: nextStatus,
    sort_order: patch.sort_order !== undefined
      ? normalizeSortOrder(patch.sort_order, normalizeSortOrder(current.sort_order, 0))
      : normalizeSortOrder(current.sort_order, 0),
    description: patch.description !== undefined ? String(patch.description || '').slice(0, 6000) : current.description,
    location: patch.location !== undefined ? (String(patch.location || '').trim() || 'Unknown') : (current.location || 'Unknown'),
    employment_type: patch.employment_type !== undefined ? normalizeEmploymentType(patch.employment_type) : normalizeEmploymentType(current.employment_type),
    remote: patch.remote !== undefined ? Boolean(patch.remote) : Boolean(current.remote),
    pay_min: payBand.min,
    pay_max: payBand.max,
    salary_range: formatSalaryRange(payBand.min, payBand.max) || String(current.salary_range || '').trim(),
    scorecard: patch.scorecard !== undefined ? String(patch.scorecard || '').trim() : current.scorecard,
    verdict: patch.verdict !== undefined ? String(patch.verdict || '').trim() : current.verdict,
    source: patch.source !== undefined ? String(patch.source || '').trim() : String(current.source || '').trim(),
    date: nextDate,
    updated_at: now,
    first_response_at: resolveFirstResponseAt({ current, patch, nextStatus, now }),
  };

  applications[idx] = next;
  await chrome.storage.local.set({ applications });
  return next;
}

/**
 * Update the status of an existing application.
 *
 * @param {string} id
 * @param {string} status
 * @returns {Promise<boolean>} true if found and updated.
 */
export async function updateApplicationStatus(id, status) {
  const updated = await updateApplication(id, { status });
  return !!updated;
}

export async function deleteApplication(id) {
  const data = await chrome.storage.local.get('applications');
  const applications = data.applications || [];
  const idx = applications.findIndex((entry) => entry.id === id);
  if (idx === -1) return null;

  const [removed] = applications.splice(idx, 1);
  await chrome.storage.local.set({ applications });
  return removed || null;
}

export async function importApplicationsFromCsv(csvText = '') {
  const parsed = parseApplicationsCsv(csvText);
  const saved = [];

  for (const item of parsed.items) {
    saved.push(await addApplication(item));
  }

  return {
    imported: saved.length,
    skipped: parsed.skipped,
    warnings: parsed.warnings,
    items: saved,
  };
}

export function filterApplicationsForQuery(applications = [], query = '', options = {}) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const activeOnly = !!options.activeOnly;

  return (applications || []).filter((app) => {
    const status = normalizeApplicationStatus(app?.status);
    // "Active" means anything still in flight — every stage except the final
    // rejected/retired buckets. Later stages (interview, offer, …) stay active.
    if (activeOnly && ['rejected', 'retired'].includes(status)) {
      return false;
    }

    if (!tokens.length) {
      return true;
    }

    const haystack = [
      app?.company,
      app?.title,
      app?.location,
      app?.employment_type,
      app?.salary_range,
      app?.pay_min,
      app?.pay_max,
      app?.scorecard,
      app?.verdict,
      app?.description,
      app?.jd_snippet,
    ].join(' ').toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
}

export function parseApplicationsCsv(csvText = '') {
  const rows = parseCsvRows(csvText);
  if (!rows.length) {
    return { items: [], skipped: 0, warnings: ['CSV file is empty.'] };
  }

  const [headerRow, ...dataRows] = rows;
  const headerMap = buildCsvHeaderMap(headerRow);
  const items = [];
  let skipped = 0;

  for (const row of dataRows) {
    const hasContent = row.some((cell) => String(cell || '').trim());
    if (!hasContent) {
      skipped++;
      continue;
    }

    const company = getCsvValue(row, headerMap, ['company', 'employer', 'organization', 'organisation']);
    const title = getCsvValue(row, headerMap, ['role title', 'role', 'title', 'job title', 'position']);
    const url = getCsvValue(row, headerMap, ['url', 'job url', 'application url', 'link', 'job link']);
    const description = getCsvValue(row, headerMap, ['notes', 'description', 'job description', 'jd', 'details']);

    if (!company && !title && !url && !description) {
      skipped++;
      continue;
    }

    const remoteValue = getCsvValue(row, headerMap, ['remote', 'remote hybrid', 'remote or hybrid', 'remote status']);
    const remote = parseRemoteFlag(remoteValue, description);
    const location = getCsvValue(row, headerMap, ['location', 'city', 'office', 'work location']) || (remote ? 'Remote' : 'Unknown');
    const salaryRange = getCsvValue(row, headerMap, ['salary range', 'salary', 'compensation', 'pay range']);
    const payMin = getCsvValue(row, headerMap, ['pay min', 'salary min', 'minimum salary', 'min salary']);
    const payMax = getCsvValue(row, headerMap, ['pay max', 'salary max', 'maximum salary', 'max salary']);
    const payBand = resolvePayBand({
      salary_range: salaryRange,
      pay_min: payMin,
      pay_max: payMax,
    });

    items.push({
      company,
      title,
      url,
      status: normalizeApplicationStatus(getCsvValue(row, headerMap, ['status', 'stage', 'pipeline stage']) || 'submitted'),
      date: normalizeTrackerDate(getCsvValue(row, headerMap, ['date', 'applied date', 'application date', 'submitted date'])),
      employment_type: normalizeEmploymentType(getCsvValue(row, headerMap, ['employment type', 'employment', 'job type', 'type']) || title || description),
      remote,
      location,
      pay_min: payBand.min,
      pay_max: payBand.max,
      salary_range: formatSalaryRange(payBand.min, payBand.max) || salaryRange,
      source: getCsvValue(row, headerMap, ['source', 'job source', 'board', 'job board']),
      scorecard: getCsvValue(row, headerMap, ['scorecard', 'fit score', 'score']),
      verdict: getCsvValue(row, headerMap, ['verdict', 'priority', 'outcome']),
      description,
      jd_snippet: description.slice(0, 300),
      answers_generated: false,
      fill_report: null,
    });
  }

  const warnings = items.length
    ? []
    : ['No valid application rows were found. Use columns like Company, Role Title, Status, Date, URL, Location, or Notes.'];

  return { items, skipped, warnings };
}

/**
 * Statuses that mean an employer actually replied. Shared with lib/analytics.js
 * so the tracker and the analytics panel can never drift on what a "response"
 * is. Note that `retired` (job unlisted / silence) is deliberately excluded.
 */
export const RESPONSE_STATUSES = ['interview', 'offer', 'rejected'];

/**
 * Whether a status value represents an employer response.
 *
 * Used to decide when to stamp `first_response_at`. See RESPONSE_STATUSES for
 * why `retired` is excluded.
 *
 * @param {string} status Raw or normalized application status.
 * @returns {boolean} True for interview, offer, or rejected.
 */
export function isResponseApplicationStatus(status) {
  return RESPONSE_STATUSES.includes(normalizeApplicationStatus(status));
}

export function normalizeApplicationStatus(status) {
  const value = String(status || '').toLowerCase().trim();
  if (!value) return 'drafted';
  if (value === 'applied') return 'submitted';
  return value;
}

export function isTerminalApplicationStatus(status) {
  const normalized = normalizeApplicationStatus(status);
  return ['submitted', 'interview', 'offer', 'rejected'].includes(normalized);
}

export function normalizeEmploymentType(value) {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return 'Full-time';
  if (text.includes('part')) return 'Part-time';
  if (text.includes('contract')) return 'Contract';
  if (text.includes('intern')) return 'Internship';
  if (text.includes('temp')) return 'Temporary';
  return 'Full-time';
}

export function deriveTrackerDetailsFromText(text = '', seed = {}) {
  const raw = String(text || '');
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const locationMatch = raw.match(/(?:location|based in|work location|office location)\s*:?\s*([^\n|]+)/i);
  const salaryMatch = raw.match(/\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|K|\/hr|\/year)?\s*(?:-|–|to)\s*\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:k|K|\/hr|\/year)?/);

  const location = String(seed.location || locationMatch?.[1] || '').trim() || (/\bremote\b/i.test(raw) ? 'Remote' : 'Unknown');
  const salary_range = String(seed.salary_range || salaryMatch?.[0] || '').replace(/\s+/g, ' ').trim();
  const payBand = resolvePayBand({
    pay_min: seed.pay_min,
    pay_max: seed.pay_max,
    salary_range,
  });
  const remote = seed.remote !== undefined ? Boolean(seed.remote) : /\bremote\b|hybrid|work from home|wfh/i.test(raw);

  return {
    location,
    employment_type: normalizeEmploymentType(`${seed.employment_type || ''} ${seed.title || ''} ${normalized}`),
    remote,
    pay_min: payBand.min,
    pay_max: payBand.max,
    salary_range: formatSalaryRange(payBand.min, payBand.max) || salary_range,
  };
}

function normalizeSortOrder(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getNextSortOrder(applications = []) {
  return applications.reduce((max, entry) => {
    return Math.max(max, normalizeSortOrder(entry?.sort_order, 0));
  }, 0) + 1024;
}

function pickHigherPriorityStatus(currentStatus, nextStatus) {
  const order = {
    drafted: 0,
    filled: 1,
    submitted: 2,
    interview: 3,
    offer: 4,
    rejected: 4,
  };

  const current = normalizeApplicationStatus(currentStatus);
  const next = normalizeApplicationStatus(nextStatus);
  return (order[next] ?? 0) >= (order[current] ?? 0) ? next : current;
}

function normalizeTrackerDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  let match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
}

function parseRemoteFlag(value, fallbackText = '') {
  const text = `${String(value || '').trim()} ${String(fallbackText || '').trim()}`.toLowerCase();
  if (!text) return false;
  if (/\b(no|false|onsite|on-site)\b/.test(text)) return false;
  return /\b(yes|true|remote|hybrid|wfh|work from home)\b/.test(text);
}

function buildCsvHeaderMap(headerRow = []) {
  return Object.fromEntries(
    headerRow
      .map((value, index) => [normalizeCsvHeader(value), index])
      .filter(([key]) => key)
  );
}

function getCsvValue(row = [], headerMap = {}, aliases = []) {
  for (const alias of aliases) {
    const index = headerMap[normalizeCsvHeader(alias)];
    if (index === undefined) continue;
    return String(row[index] || '').trim();
  }
  return '';
}

function normalizeCsvHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseCsvRows(csvText = '') {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index++) {
    const char = csvText[index];

    if (inQuotes) {
      if (char === '"' && csvText[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    if (char !== '\r') {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

// Keep date transition logic in one place so status/date behavior is easy to patch.
function resolveSubmissionDate({ current, patch, nextStatus }) {
  if (Object.prototype.hasOwnProperty.call(patch, 'date')) {
    const explicit = normalizeTrackerDate(patch.date);
    return explicit || current.date || '';
  }

  const currentDate = normalizeTrackerDate(current.date) || '';
  const previousStatus = normalizeApplicationStatus(current.status);

  // If a card moves from drafted into an active pipeline stage and no date exists,
  // seed date to today so sorting and timeline semantics stay consistent.
  if (!currentDate && previousStatus !== nextStatus && ['submitted', 'pending', 'interview', 'offer'].includes(nextStatus)) {
    return new Date().toISOString().slice(0, 10);
  }

  return currentDate;
}

/**
 * Stamp the moment an application first reached a response stage.
 *
 * Once set the value is sticky — moving a card interview → offer → rejected must
 * not reset it, because analytics measures time to the *first* reply. Entries
 * that were already sitting in a response lane before this field existed get
 * backfilled from `updated_at` rather than being stamped with today's date,
 * which would otherwise make every historical application look instantaneous.
 */
function resolveFirstResponseAt({ current = {}, patch = {}, nextStatus, now }) {
  if (Object.prototype.hasOwnProperty.call(patch, 'first_response_at')) {
    return String(patch.first_response_at || '').trim();
  }

  const existing = String(current.first_response_at || '').trim();
  if (existing) return existing;

  if (!isResponseApplicationStatus(nextStatus)) return '';

  // Already in a response lane before this patch → backfill, don't re-stamp.
  if (isResponseApplicationStatus(current.status)) {
    return String(current.updated_at || '').trim();
  }

  return now;
}

function resolvePayBand(entry = {}) {
  const directMin = normalizePayValue(entry.pay_min);
  const directMax = normalizePayValue(entry.pay_max);
  if (directMin || directMax) {
    const min = directMin;
    const max = directMax || directMin;
    return {
      min: Math.min(min, max),
      max: Math.max(min, max),
    };
  }

  const parsed = parsePayRangeText(entry.salary_range || '');
  return {
    min: parsed.min,
    max: parsed.max,
  };
}

function normalizePayValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

function parsePayRangeText(text = '') {
  const matches = String(text || '').match(/\d[\d,]*/g) || [];
  if (!matches.length) return { min: 0, max: 0 };
  const values = matches
    .map((value) => Number(String(value).replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return { min: 0, max: 0 };
  if (values.length === 1) return { min: values[0], max: values[0] };
  return {
    min: Math.min(values[0], values[1]),
    max: Math.max(values[0], values[1]),
  };
}

function formatSalaryRange(min, max) {
  const safeMin = normalizePayValue(min);
  const safeMax = normalizePayValue(max);
  if (safeMin && safeMax) {
    return `$${safeMin.toLocaleString()} - $${safeMax.toLocaleString()}`;
  }
  if (safeMin) return `$${safeMin.toLocaleString()}`;
  if (safeMax) return `$${safeMax.toLocaleString()}`;
  return '';
}

// ── Duplicate detection ─────────────────────────────────────────────────────
// Two tracker rows are the same application when their URLs point at the same
// job posting, or when company AND title match and they were logged within a
// week of each other. A shared title and company alone is not enough: people
// re-apply to the same role months later, and agencies reuse titles.

const DUPLICATE_DATE_WINDOW_DAYS = 7;

// Furthest-along status wins when rows are merged. A rejection outranks an
// interview because it can only come later for the same application.
const STATUS_PROGRESS = ['drafted', 'retired', 'filled', 'pending', 'submitted', 'interview', 'rejected', 'offer'];

/**
 * A stable key for the job posting a URL points at, or '' when the URL does
 * not identify one (embedded forms carry only a one-time token).
 */
export function canonicalJobKey(url = '') {
  let parsed;
  try { parsed = new URL(String(url || '').trim()); } catch { return ''; }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsed.pathname;

  const ghJid = parsed.searchParams.get('gh_jid');
  if (ghJid) return `greenhouse:${ghJid}`;
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const id = path.match(/\/jobs\/(\d+)/)?.[1];
    return id ? `greenhouse:${id}` : '';
  }
  if (host === 'jobs.ashbyhq.com' || host === 'jobs.lever.co') {
    const id = path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
    return id ? `${host === 'jobs.lever.co' ? 'lever' : 'ashby'}:${id.toLowerCase()}` : '';
  }
  if (host.endsWith('linkedin.com')) {
    const id = path.match(/\/jobs\/view\/(\d+)/)?.[1] || parsed.searchParams.get('currentJobId');
    return id ? `linkedin:${id}` : '';
  }

  // Anything else: the posting's path without apply/confirmation steps or query.
  const cleanPath = path
    .replace(/\/(application|apply|confirmation|thank-you|thanks)\/?$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return cleanPath && cleanPath !== '/' ? `${host}${cleanPath}` : '';
}

function normalizeTrackerText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function daysBetween(a, b) {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left) || Number.isNaN(right)) return Infinity;
  return Math.abs(left - right) / 86400000;
}

function isSameApplication(a, b) {
  const keyA = canonicalJobKey(a.url);
  if (keyA && keyA === canonicalJobKey(b.url)) return true;

  const companyA = normalizeTrackerText(a.company);
  const titleA = normalizeTrackerText(a.title);
  return Boolean(companyA && titleA)
    && companyA === normalizeTrackerText(b.company)
    && titleA === normalizeTrackerText(b.title)
    && daysBetween(a.date, b.date) <= DUPLICATE_DATE_WINDOW_DAYS;
}

/**
 * Group tracker rows that describe the same application.
 * @returns {object[][]} Only groups with two or more rows, oldest row first.
 */
export function findDuplicateGroups(applications = []) {
  const apps = applications.filter((app) => app && app.id);
  const parent = apps.map((_, index) => index);
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));

  for (let i = 0; i < apps.length; i++) {
    for (let j = i + 1; j < apps.length; j++) {
      if (isSameApplication(apps[i], apps[j])) parent[find(j)] = find(i);
    }
  }

  const groups = new Map();
  apps.forEach((app, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(app);
  });

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)));
}

function statusProgress(status) {
  const index = STATUS_PROGRESS.indexOf(normalizeApplicationStatus(status));
  return index === -1 ? 0 : index;
}

function isEmptyTrackerValue(value) {
  return value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

/**
 * Merge one duplicate group into a single row: the furthest-along status is
 * kept (ties go to the most recently updated row), the earliest date is kept,
 * and any field the kept row lacks is filled from the others.
 * @returns {{ keep: object, removeIds: string[] }}
 */
export function mergeDuplicateGroup(group = []) {
  const ranked = [...group].sort((a, b) =>
    statusProgress(b.status) - statusProgress(a.status)
    || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const [primary, ...others] = ranked;
  const keep = { ...primary };

  for (const other of others) {
    for (const [field, value] of Object.entries(other)) {
      if (field === 'id' || isEmptyTrackerValue(value)) continue;
      if (isEmptyTrackerValue(keep[field])) keep[field] = value;
    }
  }

  // Prefer a URL that names the posting over a one-time embed URL.
  if (!canonicalJobKey(keep.url)) {
    const better = others.find((other) => canonicalJobKey(other.url));
    if (better) keep.url = better.url;
  }

  const dates = group.map((app) => app.date).filter((date) => !Number.isNaN(Date.parse(date)));
  if (dates.length) keep.date = dates.sort()[0];

  return { keep, removeIds: others.map((other) => other.id) };
}

/** Merge every duplicate group in storage. Returns what changed. */
export async function removeDuplicateApplications() {
  const data = await chrome.storage.local.get('applications');
  const applications = data.applications || [];
  const groups = findDuplicateGroups(applications);
  if (!groups.length) return { merged: 0, removed: 0, groups: [] };

  const replacements = new Map();
  const removed = new Set();
  const summary = [];
  for (const group of groups) {
    const { keep, removeIds } = mergeDuplicateGroup(group);
    replacements.set(keep.id, { ...keep, updated_at: new Date().toISOString() });
    removeIds.forEach((id) => removed.add(id));
    summary.push({ company: keep.company || '', title: keep.title || '', status: keep.status, removed: removeIds.length });
  }

  const next = applications
    .filter((app) => !removed.has(app.id))
    .map((app) => replacements.get(app.id) || app);
  await chrome.storage.local.set({ applications: next });
  return { merged: groups.length, removed: removed.size, groups: summary };
}
