import { test, describe } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { parseScoreRatio, MAX_SCORECARD_LENGTH } from '../lib/score-ratio.js';
import { addApplication } from '../lib/tracker.js';

describe('parseScoreRatio', () => {
  test('parses "4/5"', () => {
    deepEqual(parseScoreRatio('4/5'), { score: 4, max: 5 });
  });

  test('parses "Score: 3.5 / 10 fit"', () => {
    deepEqual(parseScoreRatio('Score: 3.5 / 10 fit'), { score: 3.5, max: 10 });
  });

  test('parses first ratio in "1/2/3"', () => {
    deepEqual(parseScoreRatio('1/2/3'), { score: 1, max: 2 });
  });

  test('returns null for "7"', () => {
    equal(parseScoreRatio('7'), null);
  });

  test('returns null for "abc / 5"', () => {
    equal(parseScoreRatio('abc / 5'), null);
  });

  test('returns null for "3./5"', () => {
    equal(parseScoreRatio('3./5'), null);
  });

  test('returns null for empty string', () => {
    equal(parseScoreRatio(''), null);
  });

  test('performance: handles 1M chars in < 200ms', () => {
    const t = Date.now();
    const r = parseScoreRatio('1'.repeat(1_000_000));
    equal(r, null);
    ok(Date.now() - t < 200, `took ${Date.now() - t}ms, expected < 200ms`);
  });
});

describe('addApplication caps scorecard length', () => {
  test('stored scorecard is capped at MAX_SCORECARD_LENGTH', async () => {
    global.chrome = {
      storage: {
        local: {
          async get() { return { applications: [] }; },
          async set(data) { global.saved = data.applications; }
        }
      }
    };
    await addApplication({
      company: 'Acme',
      title: 'Eng',
      url: 'https://example.com/j/1',
      scorecard: 'x'.repeat(5000)
    });
    equal(global.saved[0].scorecard.length, MAX_SCORECARD_LENGTH);
  });
});