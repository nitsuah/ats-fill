/**
 * ats-fill — scripts/tracker/email-triage.mjs
 * Deterministic classifier for job-related emails, plus the matcher that turns
 * classified emails into tracker changes. No network, no LLM: an agent (or a
 * Gmail export) supplies {id, sender, subject, snippet, date} rows and this
 * module decides what each one means for the pipeline.
 */

// Same ladder as pickHigherPriorityStatus in lib/tracker.js: an email can move
// an application forward but never back (a late "thanks for applying" must not
// undo an interview).
const STATUS_RANK = { drafted: 0, filled: 1, pending: 1, submitted: 2, interview: 3, offer: 4, rejected: 4 };

// ATS / job-board mailers: the sender domain says nothing about the employer.
const PLATFORM_DOMAINS = [
  'greenhouse-mail.io', 'greenhouse.io', 'ashbyhq.com', 'lever.co', 'hire.lever.co',
  'myworkday.com', 'workday.com', 'icims.com', 'jobvite.com', 'smartrecruiters.com',
  'dice.com', 'linkedin.com', 'indeed.com', 'indeedemail.com', 'ziprecruiter.com',
  'glassdoor.com', 'wellfound.com', 'phenompeople.com', 'successfactors.com',
  'taleo.net', 'bamboohr.com', 'comeet-notifications.com', 'comeet.co', 'breezy.hr', 'jazzhr.com', 'recruitee.com', 'teamtailor-mail.com', 'workablemail.com', 'workable.com', 'rippling.com',
  'gmail.com', 'outlook.com',
];

// Job-board marketing, alerts and newsletters. Checked first so "Nail your next
// interview" never reads as an interview invite.
const NOISE_SENDERS = [/@connect\.dice\.com$/i, /jobalerts?/i, /@jobs-listings\./i, /newsletter/i, /@e\.linkedin\.com$/i, /@match\.indeed\.com$/i, /@marketing\./i];
const NOISE_TEXT = /\b(job alert|jobs? (?:for|picked for) you|recommended jobs?|new jobs? (?:match|near)|complete your profile|nail your next interview|interview tips|webinar|unsubscribe from (?:job )?alerts)\b/i;

const RULES = [
  ['offer', /\b(offer letter|pleased to (?:extend|offer)|extend(?:ing)? (?:you )?an offer|verbal offer|offer of employment)\b/i],
  ['rejected', /\b(after careful|not (?:to )?(?:be )?mov(?:e|ing) forward|decided to (?:pursue|proceed with|move forward with) other|no longer (?:under consideration|being considered)|(?:position|role) has (?:been|now been) filled|not (?:been )?selected|unable to offer you|will not be (?:moving|progressing)|regret to inform|unfortunately,? (?:we|the team|after))\b/i],
  ['interview', /\b(schedule (?:a|an|your|the)? ?(?:call|interview|chat|conversation|time|phone screen)|invite you to (?:an? )?(?:interview|call|chat|speak)|would (?:like|love) to (?:speak|chat|talk|move forward|invite)|phone screen|technical (?:screen|interview)|onsite interview|interview (?:invitation|request|confirmation)|your availability|calendly\.com|goodtime\.io)\b/i],
  ['applied', /\b(thank(?:s| you) for (?:applying|your application|your interest)|(?:we(?:'ve| have)? )?received your (?:application|resume)|application (?:has been |was )?(?:received|submitted|sent)|acknowledge receipt of your resume|successfully submitted|keep track of your application)\b/i],
];

export function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|gmbh|plc|technologies|technology|labs|group|holdings)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Zero-width and combining-joiner characters some mailers pad snippets with.
const INVISIBLE = new RegExp(`[${String.fromCharCode(0x34f, 0x200b)}-${String.fromCharCode(0x200d, 0xfeff)}]`, 'g');

function decode(text) {
  return String(text || '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function senderAddress(sender) {
  const text = String(sender || '');
  const angled = text.match(/<([^>]+)>/);
  return (angled ? angled[1] : text).trim().toLowerCase();
}

function companyFromSender(address) {
  const domain = address.split('@')[1] || '';
  if (!domain || PLATFORM_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) return '';
  const parts = domain.split('.').filter((p) => !['mail', 'email', 'jobs', 'careers', 'notifications', 'hr', 'talent', 'recruiting', 'us', 'eu', 'com', 'io', 'co', 'net', 'org', 'ai'].includes(p));
  const base = parts[parts.length - 1] || '';
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
}

const COMPANY_PATTERNS = [
  /\bapplication for .+? at (.+?) (?:sent|submitted|received)\b/i,
  /\b(?:applying|apply|application) (?:to|at|with) ([A-Z][\w&.' -]{0,60}?)(?:!|\.|,| -| for | and |$)/,
  /\binterest in (?:joining )?([A-Z][\w&.' -]{0,60}?)(?:!|\.|,| -|$)/,
  /^([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,2}) application(?::| status| update)/,
  /\bat ([A-Z][\w&.'-]+(?: [A-Z][\w&.'-]+){0,3})\b/,
];

const ROLE_PATTERNS = [
  /\bapplication for (.+?) at .+? (?:sent|submitted|received)\b/i,
  /\bposition of (.+?)(?: \(| at |\.|,|$)/i,
  /\b(?:to|for|in) the (.+?) (?:role|position|opening)\b/i,
  /\bapplication for the (.+?) job\b/i,
  /\bapplication for the (.+?)(?:,| and|\.| at |$)/i,
  /\binterest in (?:the )?(.+?) \(ID/i,
  /\bapplying for (?!a position)(?:the )?(.+?)$/i,
];

function firstMatch(patterns, ...texts) {
  for (const pattern of patterns) {
    for (const text of texts) {
      const m = text.match(pattern);
      // Names can contain dots (Amazon.com) but never run across a sentence.
      const value = m?.[1]?.split(/[.!?] /)[0].trim().replace(/[.!,]+$/, '');
      if (value && value.length > 1) return value;
    }
  }
  return '';
}

/**
 * Classify one email.
 * @param {{id?:string, sender?:string, subject?:string, snippet?:string, date?:string}} email
 * @returns {{id:string, event:'offer'|'rejected'|'interview'|'applied'|'noise', company:string, role:string, date:string, subject:string}}
 */
export function classifyEmail(email = {}) {
  const subject = decode(email.subject);
  const snippet = decode(email.snippet);
  const address = senderAddress(email.sender);
  const text = `${subject} ${snippet}`;
  const sortKey = String(email.date || '');
  const base = { id: String(email.id || ''), date: sortKey.slice(0, 10), sortKey, subject };

  if (NOISE_SENDERS.some((re) => re.test(address)) || NOISE_TEXT.test(text)) {
    return { ...base, event: 'noise', company: '', role: '' };
  }

  const hit = RULES.find(([, re]) => re.test(text));
  if (!hit) return { ...base, event: 'noise', company: '', role: '' };

  // Subject first, then the employer's own mail domain, then the snippet:
  // snippets are truncated and often name the role where a company would go.
  const fromSubject = firstMatch(COMPANY_PATTERNS, subject);
  let fromSender = fromSubject ? '' : companyFromSender(address);
  const fromSnippet = firstMatch(COMPANY_PATTERNS, snippet);
  // A domain is often an abbreviation ("optimags" for Optima Global
  // Solutions); take the snippet's full name when the two start alike.
  const condense = (s) => normalizeCompany(s).replace(/ /g, '');
  if (fromSender && fromSnippet && condense(fromSnippet).slice(0, 4) === condense(fromSender).slice(0, 4)) fromSender = '';
  const company = fromSubject || fromSender || fromSnippet;
  const role = firstMatch(ROLE_PATTERNS, subject, snippet);
  return { ...base, event: hit[0], company, role, domain: address.split('@')[1] || '', companyFromDomain: Boolean(fromSender) };
}

/**
 * Accepts the Gmail MCP `search_threads` payload, a `{messages:[...]}` object,
 * or a plain array, and returns flat email rows (one per message).
 */
export function flattenEmails(payload) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (Array.isArray(data)) return data.flatMap((row) => (row?.messages ? row.messages : [row]));
  if (Array.isArray(data?.threads)) return data.threads.flatMap((t) => t.messages || [t]);
  if (Array.isArray(data?.messages)) return data.messages;
  return [];
}

function similarity(a, b) {
  const wa = new Set(normalizeCompany(a).split(' ').filter((w) => w.length > 2));
  const wb = new Set(normalizeCompany(b).split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
}

export function findApplication(applications, { company, role }) {
  const target = normalizeCompany(company);
  if (!target) return null;
  const candidates = applications.filter((app) => {
    const name = normalizeCompany(app.company);
    return name && (name === target || name.includes(target) || target.includes(name));
  });
  if (candidates.length <= 1) return candidates[0] || null;
  const scored = candidates
    .map((app) => ({ app, score: role ? similarity(role, app.title) : 0 }))
    .sort((x, y) => y.score - x.score || String(y.app.updated_at).localeCompare(String(x.app.updated_at)));
  return scored[0].app;
}

const EVENT_STATUS = { applied: 'submitted', interview: 'interview', rejected: 'rejected', offer: 'offer' };

/**
 * Turn classified emails into a change plan against the current tracker.
 * Emails are applied oldest-first so a thread that goes applied → rejected
 * lands on rejected. Nothing here writes; the CLI executes the plan.
 *
 * @returns {{updates:object[], adds:object[], skipped:object[]}}
 */
export function planTrackerChanges(applications, classified, { addMissing = true } = {}) {
  const apps = applications.map((a) => ({ ...a }));
  const plan = { updates: [], adds: [], skipped: [] };
  // A name guessed from a mail domain ("optimags.com" → "Optimags") gives way
  // to the name another email from the same domain spells out in its text.
  const namedByDomain = new Map();
  for (const mail of classified) {
    if (mail.domain && mail.company && !mail.companyFromDomain) namedByDomain.set(mail.domain, mail.company);
  }
  classified = classified.map((mail) => (mail.companyFromDomain && namedByDomain.has(mail.domain)
    ? { ...mail, company: namedByDomain.get(mail.domain), companyFromDomain: false }
    : mail));
  const ordered = [...classified].sort((a, b) => String(a.sortKey || a.date).localeCompare(String(b.sortKey || b.date)));

  for (const mail of ordered) {
    if (mail.event === 'noise') { plan.skipped.push({ id: mail.id, reason: 'noise', subject: mail.subject }); continue; }
    if (!mail.company) { plan.skipped.push({ id: mail.id, reason: 'no company', subject: mail.subject }); continue; }

    const status = EVENT_STATUS[mail.event];
    const match = findApplication(apps, mail);
    if (match) {
      const from = match.status || 'drafted';
      const currentRank = STATUS_RANK[from] ?? 0;
      const nextRank = STATUS_RANK[status] ?? 0;
      // offer and rejected share a rank; like pickHigherPriorityStatus, a later
      // terminal email replaces the other one rather than being skipped.
      const terminalTie = ['offer', 'rejected'].includes(from) && ['offer', 'rejected'].includes(status) && status !== from;
      const forward = nextRank > currentRank || terminalTie;
      if (match.pendingAdd) {
        // A later email about a company this run is already adding: it can
        // still supply the role title even when the status is unchanged.
        if (!match.pendingAdd.title && mail.role) match.pendingAdd.title = mail.role;
        if (forward) match.pendingAdd.status = match.status = status;
        continue;
      }
      if (!forward) {
        plan.skipped.push({ id: mail.id, reason: `already ${from}`, company: match.company });
        continue;
      }
      match.status = status;
      plan.updates.push({ id: match.id, company: match.company, title: match.title, from, to: status, email: mail.id });
    } else if (addMissing) {
      const add = { company: mail.company, title: mail.role, status, source: 'email', date: mail.date, email: mail.id };
      plan.adds.push(add);
      apps.push({ ...add, id: `pending:${mail.id}`, pendingAdd: add });
    } else {
      plan.skipped.push({ id: mail.id, reason: 'not tracked', company: mail.company });
    }
  }
  return plan;
}
