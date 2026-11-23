import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Load the shipped classic content script and exercise its pure auto-submit guard.
const CONTENT_JS = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');

function load() {
  const url = new URL('https://job-boards.greenhouse.io/acme/jobs/1');
  const sandbox = {
    document: { referrer: '', addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], readyState: 'complete', documentElement: {}, body: null },
    location: url, URL, URLSearchParams, console, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.MutationObserver = class { observe() {} disconnect() {} };
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.chrome = { runtime: { id: 'ext-id', onMessage: { addListener() {} }, sendMessage: () => Promise.resolve({}) } };
  vm.createContext(sandbox);
  vm.runInContext(CONTENT_JS, sandbox);
  return sandbox;
}

const good = { enabled: true, hostname: 'job-boards.greenhouse.io', hasCaptcha: false, unresolvedCount: 0, warning: null, requiredEmpty: [], reviewAnswered: [], resumeMissing: false, submitCount: 1, formInvalid: false };

test('a clean, recognized form passes every guard', () => {
  const { evaluateAutoSubmit } = load();
  const result = evaluateAutoSubmit(good);
  assert.equal(result.ok, true);
  assert.deepEqual([...result.reasons], []);
});

test('the toggle is off unless it is exactly true', () => {
  const { evaluateAutoSubmit } = load();
  for (const enabled of [undefined, false, 'true', 1, null]) {
    assert.equal(evaluateAutoSubmit({ ...good, enabled }).ok, false, String(enabled));
  }
  assert.equal(evaluateAutoSubmit().ok, false);
});

test('each blocking condition stops the submit on its own', () => {
  const { evaluateAutoSubmit } = load();
  const blockers = {
    hostname: 'careers.example.com',
    hasCaptcha: true,
    unresolvedCount: 2,
    warning: 'Gemini fell back',
    requiredEmpty: ['Email'],
    reviewAnswered: ['Veteran status'],
    resumeMissing: true,
    formInvalid: true,
    submitCount: 0,
  };
  for (const [key, value] of Object.entries(blockers)) {
    const result = evaluateAutoSubmit({ ...good, [key]: value });
    assert.equal(result.ok, false, key);
    assert.equal(result.reasons.length, 1, key);
  }
  assert.equal(evaluateAutoSubmit({ ...good, submitCount: 2 }).ok, false);
});

test('only known ATS hosts qualify; look-alikes and LinkedIn do not', () => {
  const { isAutoSubmitAtsHost } = load();
  for (const host of ['boards.greenhouse.io', 'jobs.ashbyhq.com', 'jobs.lever.co', 'acme.myworkdayjobs.com']) assert.equal(isAutoSubmitAtsHost(host), true, host);
  for (const host of ['greenhouse.io.evil.test', 'evilgreenhouse.io', 'www.linkedin.com', 'careers.example.com', '']) assert.equal(isAutoSubmitAtsHost(host), false, host);
});

test('legal and demographic labels are recognised for review', () => {
  const sandbox = load();
  const re = vm.runInContext('AUTO_SUBMIT_REVIEW_LABEL_RE', sandbox);
  for (const label of ['Veteran status', 'Gender', 'Are you authorized to work in the US?', 'Will you require sponsorship?', 'I certify the above is true', 'Disability status']) {
    assert.equal(re.test(label), true, label);
  }
  for (const label of ['First name', 'Email', 'Why are you interested in this role?']) assert.equal(re.test(label), false, label);
});
