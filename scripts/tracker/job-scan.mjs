#!/usr/bin/env node
/**
 * ats-fill — scripts/tracker/job-scan.mjs
 * Read-only job scan from public job APIs (RemoteOK, Remotive). Needs no
 * browser, no Chrome profile and no bridge, so a scheduled routine can run it
 * while the candidate is away. Writes a Markdown report and a JSON file to
 * ~/.ats-fill/job-scan/ and never touches the tracker.
 *
 *   node scripts/tracker/job-scan.mjs [--min 150000] [--out <dir>]
 *
 * Keeps postings that are remote, list a salary whose top end is at least
 * --min (default 150000), match a role keyword, and don't mention a security
 * clearance. Salary-less postings are listed separately, not dropped silently.
 */
import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MIN_SALARY = Number(flag('min', 150000));
const OUT_DIR = flag('out', join(homedir(), '.ats-fill', 'job-scan'));

const ROLE_RE = /atlassian|jira|confluence|solutions? (architect|engineer)|platform engineer|ai (platform|solutions?|engineer)|itsm|service management|devops|site reliability|sre\b/i;
const CLEARANCE_RE = /clearance|top secret|\bts\/sci\b|\bsecret\b|public trust|polygraph|security clearance/i;
const UA = 'Mozilla/5.0 (ats-fill job-scan; read-only)';

/** "$120k - $150k", "120000-150000", "$150,000" → {min, max} in dollars, or null. */
export function parseSalary(text) {
  if (!text) return null;
  const nums = [...String(text).matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi)]
    .map((m) => Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1))
    .filter((n) => Number.isFinite(n) && n >= 1000);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fromRemoteOk() {
  const rows = await getJson('https://remoteok.com/api');
  return rows.filter((r) => r && r.position).map((r) => ({
    source: 'RemoteOK',
    title: r.position,
    company: r.company,
    url: r.url || (r.slug ? `https://remoteok.com/remote-jobs/${r.slug}` : ''),
    posted: r.date || '',
    salaryText: r.salary_min || r.salary_max ? `${r.salary_min || ''}-${r.salary_max || ''}` : '',
    salary: r.salary_min || r.salary_max ? { min: Number(r.salary_min) || 0, max: Number(r.salary_max) || Number(r.salary_min) || 0 } : null,
    text: `${r.position} ${r.company} ${(r.tags || []).join(' ')} ${r.description || ''}`,
  }));
}

async function fromRemotive() {
  const queries = ['atlassian', 'jira', 'solutions engineer', 'solutions architect', 'platform engineer'];
  const out = [];
  for (const q of queries) {
    const data = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`);
    for (const j of data.jobs || []) {
      out.push({
        source: 'Remotive',
        title: j.title,
        company: j.company_name,
        url: j.url,
        posted: j.publication_date || '',
        salaryText: j.salary || '',
        salary: parseSalary(j.salary),
        text: `${j.title} ${j.company_name} ${j.category || ''} ${(j.tags || []).join(' ')} ${j.description || ''}`,
      });
    }
  }
  return out;
}

function classify(job) {
  if (!ROLE_RE.test(`${job.title} ${job.text}`)) return 'off-role';
  if (CLEARANCE_RE.test(job.text)) return 'clearance';
  if (!job.salary) return 'no-salary';
  if (job.salary.max < MIN_SALARY) return 'low-salary';
  return 'match';
}

async function main() {
  const sources = await Promise.allSettled([fromRemoteOk(), fromRemotive()]);
  const errors = [];
  const jobs = [];
  for (const [i, s] of sources.entries()) {
    if (s.status === 'fulfilled') jobs.push(...s.value);
    else errors.push(`${i === 0 ? 'RemoteOK' : 'Remotive'}: ${s.reason?.message || s.reason}`);
  }

  const seen = new Set();
  const buckets = { match: [], 'no-salary': [], clearance: [], 'low-salary': [], 'off-role': [] };
  for (const job of jobs) {
    const key = `${job.company}|${job.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    buckets[classify(job)].push(job);
  }

  const today = new Date().toISOString().slice(0, 10);
  const byTop = (a, b) => (b.salary?.max || 0) - (a.salary?.max || 0);
  buckets.match.sort(byTop);
  const line = (j) => `- [${j.title} — ${j.company}](${j.url}) · ${j.salaryText || 'no salary'} · ${j.source}${j.posted ? ` · ${String(j.posted).slice(0, 10)}` : ''}`;

  const md = [
    `# Job scan ${today}`,
    `Min top salary: $${MIN_SALARY.toLocaleString('en-US')} · remote only (both sources are remote boards) · no clearance terms`,
    `Found ${buckets.match.length} match(es), ${buckets['no-salary'].length} without salary, ${buckets.clearance.length} excluded for clearance, ${buckets['low-salary'].length} below the threshold.`,
    errors.length ? `Source errors: ${errors.join('; ')}` : '',
    '',
    '## Matches',
    ...(buckets.match.length ? buckets.match.map(line) : ['_None this run._']),
    '',
    '## Listed without salary (check manually)',
    ...(buckets['no-salary'].slice(0, 30).map(line).length ? buckets['no-salary'].slice(0, 30).map(line) : ['_None._']),
    '',
  ].filter((l) => l !== undefined).join('\n');

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${today}.md`), md);
  writeFileSync(join(OUT_DIR, `${today}.json`), JSON.stringify({ date: today, min: MIN_SALARY, errors, buckets }, null, 2));
  console.log(md);
  console.log(`\nwrote ${join(OUT_DIR, `${today}.md`)}`);
}

// Exported for tests; only run when executed directly.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('job-scan.mjs')) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
