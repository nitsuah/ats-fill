import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSummary, buildReview, main } from '../scripts/tracker/weekly-review.mjs';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

const SUMMARY = [
  'tracker: 20 total · drafted 2 · submitted 16 · rejected 2',
  'response rate: 6% (1/17)',
  'no reply ≥14d (3) — follow up or retire: Acme (35d), Beta (16d), Gamma (25d)',
  'drafts without a verdict (2): Delta, Echo',
].join('\n');
const SUBMITTED = [
  { company: 'Acme', date: daysAgo(35) },
  { company: 'Beta', date: daysAgo(16) },
  { company: 'Gamma', date: daysAgo(25) },
  { company: 'Fresh', date: daysAgo(3) },
];

test('parseSummary reads counts, rate and drafts', () => {
  const s = parseSummary(SUMMARY);
  assert.deepEqual([s.total, s.responseRate, s.responded, s.sent, s.draftCount], [20, 6, 1, 17, 2]);
  assert.deepEqual(s.draftNames, ['Delta', 'Echo']);
});

test('review applies templates per age bucket and the low-response rule', () => {
  const { text, snapshot } = buildReview({ summaryText: SUMMARY, submitted: SUBMITTED, last: { date: '2026-10-23', total: 18, responseRate: 11 }, now: NOW });
  const lines = text.split('\n');
  assert.ok(lines.length <= 15);
  assert.match(lines[0], /20 apps · response rate 6% \(1\/17\) · \+2 apps, -5 pts rate since 2026-10-23/);
  assert.match(text, /Acme \(35d\).*cli set "Acme" retired/);
  assert.match(text, /Gamma \(25d\).*last polite nudge/);
  assert.match(text, /Beta \(16d\).*short, polite follow-up/);
  assert.doesNotMatch(text, /Fresh/);
  assert.match(text, /Draft Delta: verdict\? \(strong yes \/ yes \/ maybe \/ no\)/);
  assert.match(text, /This week: response rate is under 10% after 15\+ submitted: tighten role-family targeting/);
  assert.deepEqual(snapshot, { total: 20, responseRate: 6 });
});

test('no tightening advice below 15 sent, and first run has no delta', () => {
  const summary = 'tracker: 5 total · submitted 4\nresponse rate: 0% (0/4)';
  const { text } = buildReview({ summaryText: summary, submitted: [], last: null, now: NOW });
  assert.match(text, /no previous week to compare/);
  assert.doesNotMatch(text, /tighten/);
});

test('main spawns summary + list, prints, and overwrites the snapshot', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wr-')), 'weekly-review.json');
  writeFileSync(file, JSON.stringify({ date: '2026-10-23', total: 18, responseRate: 11 }));
  const calls = [];
  const out = [];
  main({
    file, now: NOW, out: (t) => out.push(t),
    run: (args) => { calls.push(args.join(' ')); return args[0] === 'summary' ? SUMMARY : JSON.stringify(SUBMITTED); },
  });
  assert.deepEqual(calls, ['summary', 'list --status submitted --json']);
  assert.match(out[0], /Weekly review: 20 apps/);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { date: '2026-10-30', total: 20, responseRate: 6 });
});
