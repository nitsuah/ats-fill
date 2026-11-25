import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { detectAts } = await import('../content/ats-detector.js');

function detect(url, body = '') {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url });
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'location', { value: dom.window.location, configurable: true, writable: true });
  return detectAts();
}

test('Greenhouse host rule', () => {
  assert.equal(detect('https://boards.greenhouse.io/acme/jobs/123'), 'Greenhouse');
});

test('Lever host rule', () => {
  assert.equal(detect('https://jobs.lever.co/acme/abc/apply'), 'Lever');
});

test('LinkedIn Easy Apply host rule', () => {
  assert.equal(detect('https://www.linkedin.com/jobs/view/42'), 'LinkedIn Easy Apply');
});

test('Workday: myworkdayjobs subdomain falls to embedded sniff', () => {
  const body = '<a href="https://acme.myworkdayjobs.com/x">apply</a>';
  assert.equal(detect('https://acme.wd1.myworkdayjobs.com/en/job/x', body), 'Workday');
});

test('Ashby host rule', () => {
  assert.equal(detect('https://jobs.ashbyhq.com/acme/uuid/application'), 'Ashby');
});

test('iCIMS host rule', () => {
  assert.equal(detect('https://careers.icims.com/jobs/77/x'), 'iCIMS');
});

test('Look-alike host is not matched (evilgreenhouse.io)', () => {
  assert.equal(detect('https://evilgreenhouse.io/jobs/1'), 'Generic');
});

test('Embedded Greenhouse via iframe', () => {
  const body = '<iframe src="https://job-boards.greenhouse.io/embed/job_app?for=acme"></iframe>';
  assert.equal(detect('https://example.com/jobs', body), 'Greenhouse');
});

test('Embedded Jobvite via script src', () => {
  const body = '<script src="https://jobvite.com/js/app.js"></script>';
  assert.equal(detect('https://example.com/jobs', body), 'Jobvite');
});

test('Embedded Phenom via link', () => {
  const body = '<a href="https://phenompeople.com/apply">apply</a>';
  assert.equal(detect('https://example.com/jobs', body), 'Phenom');
});

test('Plain page gives Generic', () => {
  assert.equal(detect('https://example.com/jobs', '<div>hello</div>'), 'Generic');
});

test('Greenhouse host root path without #application_form/#content gives Generic', () => {
  assert.equal(detect('https://boards.greenhouse.io/'), 'Generic');
});

test('Greenhouse host root path with #content element gives Greenhouse', () => {
  const body = '<div id="content"></div>';
  assert.equal(detect('https://boards.greenhouse.io/', body), 'Greenhouse');
});
