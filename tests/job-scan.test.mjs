import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationKind, parseSalary, parseSalaryFromText, htmlToText } from '../scripts/tracker/ats-sources.mjs';
import { ROLE_RE, CLEARANCE_RE } from '../scripts/tracker/job-scan.mjs';

test('parseSalary reads salary fields with k suffixes and ranges', () => {
  assert.deepEqual(parseSalary('$120k - $150k'), { min: 120000, max: 150000 });
  assert.deepEqual(parseSalary('120000-150000'), { min: 120000, max: 150000 });
  assert.deepEqual(parseSalary('$211.4K - $290.6K'), { min: 211400, max: 290600 });
  assert.equal(parseSalary(''), null);
  assert.equal(parseSalary('To Be Discussed'), null);
});

test('parseSalaryFromText only counts dollar amounts in prose', () => {
  assert.deepEqual(parseSalaryFromText('Pay: $165,000 - $195,000 per year.'), { min: 165000, max: 195000 });
  // Years, phone numbers and headcounts must not become pay.
  assert.equal(parseSalaryFromText('Founded in 2015, 250 employees, call 555-0100'), null);
  assert.equal(parseSalaryFromText('5+ years of experience'), null);
});

test('locationKind separates US, remote, other and unknown locations', () => {
  assert.equal(locationKind('Remote - US'), 'us');
  assert.equal(locationKind('Austin, TX'), 'us');
  assert.equal(locationKind('United States'), 'us');
  assert.equal(locationKind('Remote'), 'remote');
  assert.equal(locationKind('Anywhere'), 'remote');
  assert.equal(locationKind('London, UK'), 'other');
  assert.equal(locationKind('Remote (Canada)'), 'other');
  assert.equal(locationKind('Berlin'), 'other');
  assert.equal(locationKind(''), 'unknown');
});

test('ROLE_RE matches whole words only', () => {
  assert.ok(ROLE_RE.test('Senior Atlassian Administrator'));
  assert.ok(ROLE_RE.test('Solutions Architect, AI'));
  assert.ok(ROLE_RE.test('Site Reliability Engineer'));
  assert.ok(ROLE_RE.test('Jira Service Management Engineer'));
  assert.equal(ROLE_RE.test('Sreedhar Consulting Manager'), false);
  assert.equal(ROLE_RE.test('Sales Engineer'), false);
});

test('CLEARANCE_RE flags clearance terms without matching inside other words', () => {
  assert.ok(CLEARANCE_RE.test('Requires an active Public Trust clearance'));
  assert.ok(CLEARANCE_RE.test('TS/SCI with polygraph'));
  assert.equal(CLEARANCE_RE.test('Secretary to the VP'), false);
});

test('htmlToText decodes Greenhouse entities and strips tags', () => {
  assert.equal(htmlToText('&lt;p&gt;Pay &amp; benefits&lt;/p&gt;'), 'Pay & benefits');
});
