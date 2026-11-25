import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKER_STATUS_META,
  TRACKER_STATUS_ORDER,
  getTrackingStatusMeta,
} from '../popup/tracker/tracker-meta.js';

test('TRACKER_STATUS_ORDER and TRACKER_STATUS_META have equal sets, no duplicates', () => {
  const orderSet = new Set(TRACKER_STATUS_ORDER);
  const metaKeys = Object.keys(TRACKER_STATUS_META);

  assert.strictEqual(orderSet.size, TRACKER_STATUS_ORDER.length, 'TRACKER_STATUS_ORDER has duplicate entries');
  assert.strictEqual(metaKeys.length, TRACKER_STATUS_ORDER.length, 'TRACKER_STATUS_META key count differs from order list');

  for (const key of TRACKER_STATUS_ORDER) {
    assert.ok(key in TRACKER_STATUS_META, `Order key "${key}" missing from TRACKER_STATUS_META`);
  }
  for (const key of metaKeys) {
    assert.ok(TRACKER_STATUS_ORDER.includes(key), `Meta key "${key}" not in TRACKER_STATUS_ORDER`);
  }
});

test('each meta entry has non-empty label, emoji, optionHint, cardHint', () => {
  for (const [key, entry] of Object.entries(TRACKER_STATUS_META)) {
    assert.ok(typeof entry.label === 'string' && entry.label.length > 0, `${key}.label missing or empty`);
    assert.ok(typeof entry.emoji === 'string' && entry.emoji.length > 0, `${key}.emoji missing or empty`);
    assert.ok(typeof entry.optionHint === 'string' && entry.optionHint.length > 0, `${key}.optionHint missing or empty`);
    assert.ok(typeof entry.cardHint === 'string' && entry.cardHint.length > 0, `${key}.cardHint missing or empty`);
  }
});

test('getTrackingStatusMeta returns correct meta for known statuses', () => {
  const interview = getTrackingStatusMeta('interview');
  assert.strictEqual(interview.key, 'interview');
  assert.strictEqual(interview.label, 'Interview');

  const offerSpaced = getTrackingStatusMeta(' Offer ');
  assert.strictEqual(offerSpaced.key, 'offer');

  const offerUpper = getTrackingStatusMeta('OFFER');
  assert.strictEqual(offerUpper.key, 'offer');

  const applied = getTrackingStatusMeta('applied');
  assert.strictEqual(applied.key, 'submitted');

  const empty = getTrackingStatusMeta('');
  assert.strictEqual(empty.key, 'drafted');

  const undef = getTrackingStatusMeta(undefined);
  assert.strictEqual(undef.key, 'drafted');
});

test('unknown status falls back to drafted meta but keeps its key', () => {
  const ghosted = getTrackingStatusMeta('ghosted');
  assert.strictEqual(ghosted.key, 'ghosted');
  assert.strictEqual(ghosted.label, TRACKER_STATUS_META.drafted.label);
  assert.strictEqual(ghosted.optionHint, TRACKER_STATUS_META.drafted.optionHint);
  assert.strictEqual(ghosted.cardHint, TRACKER_STATUS_META.drafted.cardHint);
  assert.strictEqual(ghosted.emoji, TRACKER_STATUS_META.drafted.emoji);
});

test('retired has tone grey', () => {
  assert.strictEqual(TRACKER_STATUS_META.retired.tone, 'grey');
});