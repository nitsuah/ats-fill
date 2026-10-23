#!/usr/bin/env node
/**
 * ats-fill — scripts/tracker/job-scan.mjs
 * Read-only job scan. Reads company career boards (Greenhouse, Ashby, Lever)
 * and public job boards (RemoteOK, Remotive). Needs no browser, no Chrome
 * profile and no bridge, so a scheduled routine can run it while the candidate
 * is away. Writes a Markdown report and a JSON file to ~/.ats-fill/job-scan/
 * and never touches the tracker.
 *
 *   node scripts/tracker/job-scan.mjs [--min 150000] [--out <dir>]
 *
 * Keeps postings that name a US or remote location, list a salary whose top
 * end is at least --min (default 150000), match a role keyword, and don't
 * mention a security clearance. Salary-less postings are listed separately,
 * not dropped silently.
 */
import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllBoards, locationKind, parseSalary } from './ats-sources.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MIN_SALARY = Number(flag('min', 150000));
if (!Number.isFinite(MIN_SALARY) || MIN_SALARY < 0) {
  console.error(`--min must be a non-negative number, got "${flag('min', '')}"`);
  process.exit(2);
}
const OUT_DIR = flag('out', join(homedir(), '.ats-fill', 'job-scan'));

// Whole-word matches: a substring like "sre" inside another word must not count.
export const ROLE_RE = /\b(atlassian|jira|confluence|itsm|service management|devops|site reliability|sre|saas|systems? administrator|business systems|it systems)\b|\bsolutions? (architect|engineer)\b|\bplatform engineer\b|\bai (platform|solutions?|engineer)\b/i;
export const CLEARANCE_RE = /\bclearance\b|\btop secret\b|\bts\/sci\b|\bsecret\b|\bpublic trust\b|\bpolygraph\b/i;
const UA = 'Mozilla/5.0 (ats-fill job-scan; read-only)';

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
    location: r.location || 'Remote',
    posted: r.date || '',
    salaryText: r.salary_min || r.salary_max ? `${r.salary_min || ''}-${r.salary_max || ''}` : '',
    salary: r.salary_min || r.salary_max ? { min: Number(r.salary_min) || 0, max: Number(r.salary_max) || Number(r.salary_min) || 0 } : null,
    text: `${r.position} ${r.company} ${(r.tags || []).join(' ')} ${r.description || ''}`,
  }));
}

async function fromRemotive() {
  // One unfiltered request: Remotive rate-limits repeated calls, and filtering
  // locally with ROLE_RE keeps every matching role (devops, itsm, sre, ...).
  const data = await getJson('https://remotive.com/api/remote-jobs');
  return (data.jobs || []).map((j) => ({
    source: 'Remotive',
    title: j.title,
    company: j.company_name,
    url: j.url,
    location: j.candidate_required_location || 'Remote',
    posted: j.publication_date || '',
    salaryText: j.salary || '',
    salary: parseSalary(j.salary),
    text: `${j.title} ${j.company_name} ${j.category || ''} ${(j.tags || []).join(' ')} ${j.description || ''}`,
  }));
}

function classify(job) {
  // Title only: descriptions name other roles in passing ("works with our
  // platform engineers"), which made generic engineering postings match.
  if (!ROLE_RE.test(job.title || '')) return 'off-role';
  if (CLEARANCE_RE.test(job.text)) return 'clearance';
  // Remote only: a US office with no remote option is not what the candidate wants.
  const loc = job.location || '';
  const remote = /\bremote\b|anywhere|worldwide/i.test(loc) && !/hybrid|on-?site|in[- ]office/i.test(loc);
  if (locationKind(loc) === 'other' || !remote) return 'off-location';
  if (!job.salary) return 'no-salary';
  if (job.salary.max < MIN_SALARY) return 'low-salary';
  return 'match';
}

async function main() {
  const sources = await Promise.allSettled([fromRemoteOk(), fromRemotive(), fetchAllBoards()]);
  const names = ['RemoteOK', 'Remotive', 'company boards'];
  const errors = [];
  const jobs = [];
  for (const [i, s] of sources.entries()) {
    if (s.status === 'fulfilled') {
      if (Array.isArray(s.value)) jobs.push(...s.value);
      else {
        jobs.push(...s.value.jobs);
        errors.push(...s.value.errors);
      }
    } else errors.push(`${names[i]}: ${s.reason?.message || s.reason}`);
  }
  // Never write an empty report that looks like a successful scan.
  if (sources.every((s) => s.status === 'rejected')) {
    throw new Error(`All sources failed: ${errors.join('; ')}`);
  }

  // Same company and title on two boards: keep the posting with a salary, so a
  // qualifying listing isn't dropped for a salary-less duplicate that came first.
  const byKey = new Map();
  for (const job of jobs) {
    const key = `${job.company}|${job.title}`.toLowerCase();
    const prev = byKey.get(key);
    if (!prev || (!prev.salary && job.salary)) byKey.set(key, job);
  }
  const buckets = { match: [], 'no-salary': [], clearance: [], 'low-salary': [], 'off-role': [], 'off-location': [] };
  for (const job of byKey.values()) buckets[classify(job)].push(job);

  const today = new Date().toISOString().slice(0, 10);
  const byTop = (a, b) => (b.salary?.max || 0) - (a.salary?.max || 0);
  buckets.match.sort(byTop);
  const pay = (j) => j.salaryText || (j.salary ? `$${j.salary.min.toLocaleString('en-US')} - $${j.salary.max.toLocaleString('en-US')}` : 'no salary');
  const line = (j) => `- [${j.title} — ${j.company}](${j.url}) · ${j.location || '?'} · ${pay(j)} · ${j.source}${j.posted ? ` · ${String(j.posted).slice(0, 10)}` : ''}`;

  const md = [
    `# Job scan ${today}`,
    `Min top salary: $${MIN_SALARY.toLocaleString('en-US')} · US or remote locations · no clearance terms`,
    `Found ${buckets.match.length} match(es), ${buckets['no-salary'].length} without salary, ${buckets.clearance.length} excluded for clearance, ${buckets['low-salary'].length} below the threshold, ${buckets['off-location'].length} outside the US.`,
    errors.length ? `Source errors (${errors.length}): ${errors.join('; ')}` : '',
    '',
    '## Matches',
    ...(buckets.match.length ? buckets.match.map(line) : ['_None this run._']),
    '',
    '## Listed without salary (check manually)',
    ...(buckets['no-salary'].length ? buckets['no-salary'].slice(0, 30).map(line) : ['_None._']),
    '',
  ].join('\n');

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${today}.md`), md);
  writeFileSync(join(OUT_DIR, `${today}.json`), JSON.stringify({ date: today, min: MIN_SALARY, errors, buckets }, null, 2));
  console.log(md);
  console.log(`\nwrote ${join(OUT_DIR, `${today}.md`)}`);
}

// Only run when this file is the entry point, so tests can import the helpers.
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry && fileURLToPath(import.meta.url) === entry) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
