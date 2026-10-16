import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalJobKey, findDuplicateGroups, mergeDuplicateGroup } from '../lib/tracker.js';

test('canonicalJobKey names the posting, not the apply step or tracking params', () => {
  assert.equal(canonicalJobKey('https://job-boards.greenhouse.io/discord/jobs/8700605002'), 'greenhouse:8700605002');
  assert.equal(canonicalJobKey('https://job-boards.greenhouse.io/discord/jobs/8700605002/confirmation'), 'greenhouse:8700605002');
  assert.equal(canonicalJobKey('https://www.databricks.com/company/careers/x-8548986002?gh_jid=8548986002'), 'greenhouse:8548986002');
  assert.equal(
    canonicalJobKey('https://jobs.ashbyhq.com/supabase/3b5d54ca-741b-45ac-bd3f-31605a0d3541/application'),
    canonicalJobKey('https://jobs.ashbyhq.com/supabase/3B5D54CA-741b-45ac-bd3f-31605a0d3541?utm_source=x'),
  );
  assert.equal(canonicalJobKey('https://www.linkedin.com/jobs/view/4462117201/?eBP=x'), 'linkedin:4462117201');
  assert.equal(canonicalJobKey('https://careers.nintendo.com/jobs/application/4372950009/'), 'careers.nintendo.com/jobs/application/4372950009');
  assert.equal(canonicalJobKey('https://jobs.example.com/roles/42/apply?ref=board'), 'jobs.example.com/roles/42');
  // Embedded forms only carry a one-time token, so they identify nothing.
  assert.equal(canonicalJobKey('https://job-boards.greenhouse.io/embed/job_app?for=databricks&validityToken=abc'), '');
  assert.equal(canonicalJobKey(''), '');
});

test('rows for the same posting are grouped, even with different titles', () => {
  const groups = findDuplicateGroups([
    { id: 'a', company: 'Discord', title: 'Staff Software Engineer', url: 'https://job-boards.greenhouse.io/discord/jobs/1', date: '2026-10-16' },
    { id: 'b', company: 'Discord', title: '', url: 'https://job-boards.greenhouse.io/discord/jobs/1/confirmation', date: '2026-10-16' },
    { id: 'c', company: 'Discord', title: 'Staff Software Engineer', url: 'https://job-boards.greenhouse.io/discord/jobs/2', date: '2026-10-16' },
  ]);

  // c shares company and title with a, logged the same day: also the same application.
  assert.deepEqual(groups.map((group) => group.map((app) => app.id).sort()), [['a', 'b', 'c']]);
});

test('same company and title alone is not a duplicate when the dates are far apart', () => {
  const groups = findDuplicateGroups([
    { id: 'a', company: 'Acme', title: 'Platform Engineer', url: '', date: '2026-01-05' },
    { id: 'b', company: 'Acme', title: 'Platform Engineer', url: '', date: '2026-06-20' },
  ]);
  assert.deepEqual(groups, []);
});

test('ambiguous rows from embedded forms are left alone', () => {
  // Real rows from one session: two embedded Databricks forms (different
  // jobs) and the parent page of one of them. Nothing ties them together
  // beyond "Databricks, same day", so nothing is merged.
  const groups = findDuplicateGroups([
    { id: 'x', company: 'Databricks', title: '', url: 'https://job-boards.greenhouse.io/embed/job_app?for=databricks&validityToken=Ad', date: '2026-10-16' },
    { id: 'y', company: 'Databricks', title: '', url: 'https://job-boards.greenhouse.io/embed/job_app?for=databricks&validityToken=HQ', date: '2026-10-16' },
    { id: 'z', company: '', title: 'Delivery Solutions Architect - Digital Native Business', url: 'https://www.databricks.com/company/careers/x?gh_jid=8548986002', date: '2026-10-16' },
  ]);
  assert.deepEqual(groups, []);
});

test('merging keeps the furthest-along status, the earliest date and every known detail', () => {
  const { keep, removeIds } = mergeDuplicateGroup([
    { id: 'a', status: 'filled', company: 'Discord', title: 'Staff Software Engineer', url: 'https://job-boards.greenhouse.io/discord/jobs/1', date: '2026-10-14', location: 'Remote', verdict: 'Lean yes', updated_at: '2026-10-14T00:00:00Z' },
    { id: 'b', status: 'submitted', company: 'Discord', title: '', url: 'https://job-boards.greenhouse.io/embed/job_app?for=discord&validityToken=t', date: '2026-10-16', pay_min: 248000, updated_at: '2026-10-16T00:00:00Z' },
  ]);

  assert.equal(keep.id, 'b');
  assert.deepEqual(removeIds, ['a']);
  assert.equal(keep.status, 'submitted');
  assert.equal(keep.date, '2026-10-14');
  assert.equal(keep.title, 'Staff Software Engineer');
  assert.equal(keep.location, 'Remote');
  assert.equal(keep.verdict, 'Lean yes');
  assert.equal(keep.pay_min, 248000);
  assert.equal(keep.url, 'https://job-boards.greenhouse.io/discord/jobs/1', 'a posting URL beats a one-time embed URL');
});

test('a rejection outranks an interview for the same application', () => {
  const { keep } = mergeDuplicateGroup([
    { id: 'a', status: 'interview', company: 'Acme', title: 'SRE', date: '2026-10-01' },
    { id: 'b', status: 'rejected', company: 'Acme', title: 'SRE', date: '2026-10-02' },
  ]);
  assert.equal(keep.status, 'rejected');
});
