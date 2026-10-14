import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

import { readExtensionStorage, readLevelDb, snappyUncompress } from '../scripts/tracker/leveldb.mjs';
import { changesToCsv } from '../scripts/tracker/cli.mjs';

// Written by headless Chromium running the unpacked extension: two tracker
// entries added through LOG_APPLICATION, then one moved to interview.
const FIXTURE = fileURLToPath(new URL('./fixtures/leveldb-tracker', import.meta.url));

test('readLevelDb returns the newest value per key from a Chromium store', () => {
  const raw = readLevelDb(FIXTURE);
  const apps = JSON.parse(raw.get('applications').toString('utf8'));
  assert.deepEqual(apps.map((a) => [a.company, a.status]), [['Contoso', 'interview'], ['Northwind', 'drafted']]);
});

test('readExtensionStorage snapshots the directory and parses JSON values', () => {
  const { dir, data } = readExtensionStorage({ ATS_FILL_STORAGE_DIR: FIXTURE });
  assert.equal(dir, FIXTURE);
  assert.equal(data.applications.length, 2);
  assert.equal(data.applications[0].url, 'https://jobs.example.com/contoso/1');
});

test('snappyUncompress handles literals and overlapping copies', () => {
  // "abcd" literal, then a 1-byte-offset copy of 4 bytes from 4 back.
  assert.equal(snappyUncompress(Buffer.from([8, 0x0c, 97, 98, 99, 100, 0x01, 0x04])).toString(), 'abcdabcd');
  // "ab" literal, then copy 6 bytes from 2 back: the copy overlaps itself.
  assert.equal(snappyUncompress(Buffer.from([8, 0x04, 97, 98, 0x09, 0x02])).toString(), 'abababab');
});

test('changesToCsv keeps existing fields on updates and routes URL-less ops to manual', () => {
  const tracked = { id: '1', company: 'Contoso', title: 'Staff ML Engineer', url: 'https://jobs.example.com/1', status: 'submitted', date: '2026-09-01', location: 'Remote', remote: true, employment_type: 'Contract', source: 'remotive', verdict: 'strong yes' };
  const { csv, rows, manual } = changesToCsv([
    { kind: 'update', app: tracked, to: 'interview' },
    { kind: 'update', app: { id: '2', company: 'NoLink', url: '' }, to: 'rejected' },
    { kind: 'add', fields: { company: 'Wingtip', title: 'Admin, Productivity', url: 'https://jobs.example.com/2', status: 'rejected', date: '2026-10-04', source: 'email' } },
    { kind: 'add', fields: { company: 'NoUrlAdd', title: 'Engineer', url: '', status: 'submitted', date: '2026-10-04', source: 'email' } },
  ]);
  const lines = csv.trim().split('\n');
  assert.equal(rows, 2);
  assert.equal(lines[0], 'company,title,url,status,date,location,remote,salary range,employment type,source,scorecard,verdict');
  assert.equal(lines[1], 'Contoso,Staff ML Engineer,https://jobs.example.com/1,interview,2026-09-01,Remote,yes,,Contract,remotive,,strong yes');
  assert.equal(lines[2], 'Wingtip,"Admin, Productivity",https://jobs.example.com/2,rejected,2026-10-04,Unknown,no,,Full-time,email,,');
  assert.deepEqual(manual.map((m) => m.kind), ['update', 'add']);
  assert.deepEqual(manual.map((m) => (m.kind === 'update' ? m.app.company : m.fields.company)), ['NoLink', 'NoUrlAdd']);
});
