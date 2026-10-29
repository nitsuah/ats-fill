import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addApplication,
  deleteApplication,
  getApplications,
  importApplicationsFromCsv,
  updateApplication,
  updateApplicationStatus,
  MAX_IMPORT_CSV_CHARS,
  MAX_IMPORT_ROWS,
} from '../lib/tracker.js';

function installChromeStorageMock(seed = {}) {
  const state = { ...seed };
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') {
            return { [key]: state[key] };
          }
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map((item) => [item, state[item]]));
          }
          return { ...state };
        },
        async set(value) {
          Object.assign(state, value);
        },
      },
    },
  };
  return state;
}

test('tracker CRUD helpers persist and normalize stored applications', async () => {
  const state = installChromeStorageMock({ applications: [] });

  const saved = await addApplication({
    company: 'Acme',
    title: 'Platform Engineer',
    url: 'https://example.com/jobs/acme',
    status: 'applied',
    salary_range: '$120,000 - $140,000',
    location: 'Remote',
  });

  assert.equal(saved.status, 'submitted');
  assert.equal(saved.pay_min, 120000);
  assert.equal(saved.pay_max, 140000);

  const updated = await updateApplication(saved.id, {
    status: 'interview',
    verdict: 'Strong fit',
    remote: true,
  });

  assert.equal(updated.status, 'interview');
  assert.equal(updated.verdict, 'Strong fit');
  assert.equal(updated.remote, true);

  const statusUpdated = await updateApplicationStatus(saved.id, 'offer');
  assert.equal(statusUpdated, true);

  const apps = await getApplications();
  assert.equal(apps.length, 1);
  assert.equal(apps[0].status, 'offer');

  const imported = await importApplicationsFromCsv(`Company,Role Title,Status,Date,Remote,Location,URL,Notes\nNorthwind,Infra Engineer,Applied,2026-05-01,Yes,Denver,https://example.com/jobs/northwind,Great role`);
  assert.equal(imported.imported, 1);
  assert.equal(state.applications.length, 2);

  const removed = await deleteApplication(saved.id);
  assert.equal(removed.id, saved.id);

  const finalApps = await getApplications();
  assert.equal(finalApps.length, 1);
  assert.equal(finalApps[0].company, 'Northwind');
});

test('importApplicationsFromCsv: single write for bulk import', async () => {
  const state = installChromeStorageMock({ applications: [] });
  let sets = 0;
  const origSet = global.chrome.storage.local.set;
  global.chrome.storage.local.set = async (v) => {
    sets++;
    return origSet(v);
  };

  const rows = Array.from({ length: 50 }, (_, i) =>
    `Co${i},Role${i},Applied,https://example.com/j/${i}`
  ).join('\n');
  const csv = `Company,Role Title,Status,URL\n${rows}`;
  const result = await importApplicationsFromCsv(csv);

  assert.equal(result.imported, 50);
  assert.equal(sets, 1);
  assert.equal(state.applications.length, 50);
});

test('importApplicationsFromCsv: row cap at MAX_IMPORT_ROWS', async () => {
  const state = installChromeStorageMock({ applications: [] });
  const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) =>
    `Co${i},Role${i},Applied,https://example.com/j/${i}`
  ).join('\n');
  const csv = `Company,Role Title,Status,URL\n${rows}`;
  const result = await importApplicationsFromCsv(csv);

  assert.equal(result.imported, MAX_IMPORT_ROWS);
  assert.equal(result.skipped, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Only the first/);
  assert.equal(state.applications.length, MAX_IMPORT_ROWS);
});

test('importApplicationsFromCsv: size cap throws', async () => {
  const huge = 'a'.repeat(MAX_IMPORT_CSV_CHARS + 1);
  await assert.rejects(
    () => importApplicationsFromCsv(huge),
    /too large/
  );
});

test('importApplicationsFromCsv: duplicate URLs in one CSV collapse to one stored application', async () => {
  const state = installChromeStorageMock({ applications: [] });
  const csv = `Company,Role Title,Status,URL\nAcme,Role1,Applied,https://example.com/same\nAcme,Role2,Applied,https://example.com/same`;
  const result = await importApplicationsFromCsv(csv);

  assert.equal(result.imported, 2);
  assert.equal(state.applications.length, 1);
});
