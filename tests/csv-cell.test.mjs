import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, buildTrackerCsv } from '../lib/csv-cell.js';

test('csvCell formula neutralization', () => {
  const formulas = ['=1+1', '+1', '-1', '@SUM(A1)', '\t=x', '\r=x', '  =cmd'];
  for (const f of formulas) {
    const result = csvCell(f);
    assert.strictEqual(result[1], "'", `Formula ${f} should be quoted with a leading apostrophe`);
    assert.ok(result.startsWith('"' + "'"), `Formula ${f} should start with "'`);
  }
});

test('csvCell normal text', () => {
  assert.strictEqual(csvCell('Acme Corp'), '"Acme Corp"');
  assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csvCell('a=b'), '"a=b"');
});

test('csvCell null/undefined/0', () => {
  assert.strictEqual(csvCell(undefined), '""');
  assert.strictEqual(csvCell(null), '""');
  assert.strictEqual(csvCell(0), '"0"');
});

const SAMPLE = {
  company: 'Acme',
  title: 'Engineer',
  status: 'applied',
  date: '2026-01-02',
  employment_type: 'Full-time',
  remote: true,
  location: 'Austin',
  pay_min: 100,
  pay_max: 150,
  salary_range: '100-150',
  scorecard: '8/10',
  verdict: 'Apply',
  url: 'https://example.com/job',
  description: 'Great role',
  jd_snippet: 'snippet',
};

test('buildTrackerCsv header only for an empty list', () => {
  const csv = buildTrackerCsv([]);
  assert.equal(csv.split('\n').length, 1);
  assert.equal(csv.split(',').length, 14);
  assert.ok(csv.startsWith('Company,Role Title,Status'));
});

test('buildTrackerCsv emits one quoted 14-cell row in header order', () => {
  const lines = buildTrackerCsv([SAMPLE]).split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].split(',').length, 14);
  assert.equal(
    lines[1],
    '"Acme","Engineer","applied","2026-01-02","Full-time","Yes","Austin","100","150","100-150","8/10","Apply","https://example.com/job","Great role"'
  );
});

test('buildTrackerCsv maps remote to Yes/No', () => {
  assert.ok(buildTrackerCsv([{ ...SAMPLE, remote: true }]).includes('"Yes"'));
  const no = buildTrackerCsv([{ ...SAMPLE, remote: false }]);
  assert.ok(no.includes('"No"'));
  assert.ok(!no.includes('"Yes"'));
});

test('buildTrackerCsv prefers description, then jd_snippet, then empty', () => {
  const last = (app) => buildTrackerCsv([app]).split('\n')[1].split(',').pop();
  assert.equal(last({ ...SAMPLE }), '"Great role"');
  assert.equal(last({ ...SAMPLE, description: '' }), '"snippet"');
  assert.equal(last({ ...SAMPLE, description: '', jd_snippet: undefined }), '""');
});

test('buildTrackerCsv neutralises formula-looking cells', () => {
  const row = buildTrackerCsv([{ ...SAMPLE, company: '=HYPERLINK("x")' }]).split('\n')[1];
  assert.ok(row.startsWith(`"'=HYPERLINK(""x"")"`));
});
