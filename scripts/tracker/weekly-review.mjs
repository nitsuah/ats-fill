#!/usr/bin/env node
/**
 * ats-fill — scripts/tracker/weekly-review.mjs
 * Zero-model weekly pipeline review. Replaces the model-driven
 * `ats-fill-weekly-review` scheduled task: runs the tracker CLI's `summary` and
 * `list --status submitted`, compares with last week's snapshot in
 * ~/.ats-fill/weekly-review.json, prints a review of at most 15 lines.
 * Read-only on the tracker; the only file it writes is the snapshot.
 */
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'cli.mjs');
const SNAPSHOT = process.env.ATS_FILL_WEEKLY_REVIEW || join(homedir(), '.ats-fill', 'weekly-review.json');
const STALE_DAYS = Number(process.env.ATS_FILL_STALE_DAYS || 14);
const MAX_LINES = 15;

export function parseSummary(text) {
  const total = Number(/tracker:\s*(\d+) total/.exec(text)?.[1] ?? 0);
  const rate = /response rate:\s*(\d+)% \((\d+)\/(\d+)\)/.exec(text);
  const drafts = /drafts without a verdict \((\d+)\):\s*(.+)/.exec(text);
  return {
    total,
    responseRate: rate ? Number(rate[1]) : 0,
    responded: rate ? Number(rate[2]) : 0,
    sent: rate ? Number(rate[3]) : 0,
    draftCount: drafts ? Number(drafts[1]) : 0,
    draftNames: drafts ? drafts[2].split(',').map((s) => s.trim()).filter(Boolean) : [],
  };
}

function ageDays(iso, now) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null;
}

function staleApps(submitted, now) {
  return submitted
    .map((app) => ({ company: app.company, days: ageDays(app.date, now) }))
    .filter((a) => a.days !== null && a.days >= STALE_DAYS)
    .sort((a, b) => b.days - a.days);
}

function nextStep({ company, days }) {
  if (days >= 30) return `${company} (${days}d): no reply for a month. Consider: cli set "${company}" retired`;
  if (days >= 21) return `${company} (${days}d): one last polite nudge, then decide whether to retire it.`;
  return `${company} (${days}d): send the recruiter or hiring manager a short, polite follow-up.`;
}

export function weeklySuggestion(summary, stale) {
  if (summary.sent >= 15 && summary.responseRate < 10) {
    return 'response rate is under 10% after 15+ submitted: tighten role-family targeting or tailoring before applying to more roles.';
  }
  if (stale.some((a) => a.days >= 30)) return 'clear out the 30+ day silent applications so the tracker reflects live opportunities.';
  if (stale.length) return 'send the follow-ups above first; they are the cheapest way to move the pipeline.';
  if (summary.draftCount) return 'give your drafts a verdict, then submit only the strong yes / yes ones.';
  return 'pipeline is current: spend the week on 3 to 5 well-tailored applications in your best-fit role family.';
}

const signed = (n) => `${n >= 0 ? '+' : ''}${n}`;

/** Pure: build the review text and next snapshot from CLI output and last week's snapshot. */
export function buildReview({ summaryText, submitted, last, now = Date.now() }) {
  const summary = parseSummary(summaryText);
  const stale = staleApps(submitted, now);
  const delta = last && Number.isFinite(last.total)
    ? `${signed(summary.total - last.total)} apps, ${signed(summary.responseRate - (last.responseRate ?? 0))} pts rate since ${last.date}`
    : 'no previous week to compare';
  const lines = [`Weekly review: ${summary.total} apps · response rate ${summary.responseRate}% (${summary.responded}/${summary.sent}) · ${delta}`];
  const shown = stale.slice(0, 5);
  for (const app of shown) lines.push(`- ${nextStep(app)}`);
  if (stale.length > shown.length) lines.push(`- …and ${stale.length - shown.length} more silent for ${STALE_DAYS}+ days`);
  for (const name of summary.draftNames.slice(0, 5)) lines.push(`- Draft ${name}: verdict? (strong yes / yes / maybe / no)`);
  if (summary.draftCount > summary.draftNames.length) lines.push(`- …${summary.draftCount - summary.draftNames.length} more drafts need a verdict`);
  const suggestion = `This week: ${weeklySuggestion(summary, stale)}`;
  const body = lines.slice(0, MAX_LINES - 1);
  return { text: [...body, suggestion].join('\n'), snapshot: { total: summary.total, responseRate: summary.responseRate } };
}

function runCli(args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readSnapshot(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

export function main({ run = runCli, file = SNAPSHOT, now = Date.now(), out = console.log } = {}) {
  const summaryText = run(['summary']);
  const submitted = JSON.parse(run(['list', '--status', 'submitted', '--json']));
  const { text, snapshot } = buildReview({ summaryText, submitted, last: readSnapshot(file), now });
  out(text);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ date: new Date(now).toISOString().slice(0, 10), ...snapshot }, null, 2));
}

const isDirectRun = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isDirectRun) {
  try { main(); } catch (err) {
    console.error(`weekly-review: ${String(err.stderr || err.message).trim().split('\n')[0]}`);
    process.exitCode = 1;
  }
}
