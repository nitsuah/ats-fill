import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell } from '../lib/csv-cell.js';

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
