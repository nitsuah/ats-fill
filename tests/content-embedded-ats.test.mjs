import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Greenhouse forms embedded in a career page (databricks.com/careers embedding
// job-boards.greenhouse.io/embed/job_app). The host page and the iframe both run
// the content script; exactly one of them must answer and log each fill.
const CONTENT_JS = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');

const EMBED_URL = 'https://job-boards.greenhouse.io/embed/job_app?for=databricks&token=8548986002';
const PARENT_JOB_URL = 'https://databricks.com/company/careers/open-positions/job?gh_jid=8548986002';
const EMBED_SCRIPT = `window.__remixContext = {"state":{"loaderData":{"routes/embed.job_app":{"jobPost":{"post_type":"job_post","title":"Delivery Solutions Architect - Digital Native Business","content":"\\u003cp\\u003eAt Databricks\\u003c/p\\u003e","public_url":"${PARENT_JOB_URL}","company_name":"Databricks"}}}}};`;
const EMBED_BODY = `<script>${EMBED_SCRIPT}</script><form id="application-form"><input id="first_name" /></form>`;

// A stand-in `window` whose `top` is another window, which is how the script
// learns it runs inside an iframe. Methods are bound to the real window;
// constructors are left alone so `window.HTMLInputElement.prototype` still works.
function framedWindow(window) {
  return new Proxy(window, {
    get(target, key) {
      if (key === 'top') return {};
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' && !/^[A-Z]/.test(String(key)) ? value.bind(target) : value;
    },
  });
}

// The script is evaluated as a function body so the `window` it sees can be
// the framed stand-in. The returned helpers are the ones these tests exercise.
const EXPORTS = '\nreturn { extractJobInfo, jobPageUrl, frameOwnsMessage, handleFillForm };';

function load({ url, body = '', referrer = '', framed = false }) {
  const dom = new JSDOM(`<!doctype html><html><head><title>Jobs</title></head><body>${body}</body></html>`, {
    url,
    ...(referrer ? { referrer } : {}),
    runScripts: 'outside-only',
  });
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    configurable: true,
  });
  window.chrome = {
    runtime: { onMessage: { addListener() {} }, sendMessage: () => Promise.resolve({}) },
  };
  const factory = window.eval(`(function (window) {\n${CONTENT_JS}${EXPORTS}\n})`);
  const api = factory(framed ? framedWindow(window) : window);
  return { window, api };
}

test('embedded Greenhouse form reads the job title from its Remix data and the company from `for`', () => {
  const { window, api } = load({ url: EMBED_URL, body: EMBED_BODY, framed: true });
  const info = api.extractJobInfo();
  assert.equal(info.title, 'Delivery Solutions Architect - Digital Native Business');
  assert.equal(info.company, 'Databricks');
  window.close();
});

test('embedded Greenhouse form records the parent job page, not the one-time embed URL', () => {
  const { window, api } = load({
    url: EMBED_URL,
    body: EMBED_BODY,
    referrer: PARENT_JOB_URL,
    framed: true,
  });
  assert.equal(api.jobPageUrl(), PARENT_JOB_URL);
  window.close();
});

test('embedded Greenhouse form falls back to public_url when the referrer is only an origin', () => {
  // Cross-origin iframes often get just "https://host/" as their referrer.
  const { window, api } = load({ url: EMBED_URL, body: EMBED_BODY, referrer: 'https://www.databricks.com/', framed: true });
  assert.equal(api.jobPageUrl(), PARENT_JOB_URL);
  window.close();
});

test('top-level pages keep their own URL as the tracker URL', () => {
  const { window, api } = load({ url: 'https://jobs.ashbyhq.com/acme/123/application', body: '<h1>Engineer</h1>' });
  assert.equal(api.jobPageUrl(), 'https://jobs.ashbyhq.com/acme/123/application');
  window.close();
});

test('the host page defers FILL_FORM, INJECT_ANSWERS, DETECT_ATS and GET_JOB_INFO to an embedded ATS form', () => {
  const { window, api } = load({
    url: PARENT_JOB_URL,
    body: `<h1>Delivery Solutions Architect</h1><input id="newsletter" />
      <iframe src="${EMBED_URL}"></iframe>`,
  });
  for (const type of ['FILL_FORM', 'INJECT_ANSWERS', 'DETECT_ATS', 'GET_JOB_INFO']) {
    assert.equal(api.frameOwnsMessage(type === 'FILL_FORM' ? { type, expectedUrl: PARENT_JOB_URL } : { type }), false, `${type} should be left to the iframe`);
  }
  window.close();
});

test('a hosted ATS page keeps the fill even when it frames its own domain', () => {
  const { window, api } = load({
    url: 'https://job-boards.greenhouse.io/acme/jobs/123',
    body: `<h1>Engineer</h1><input id="first_name" />
      <iframe src="https://job-boards.greenhouse.io/embed/widget"></iframe>`,
  });
  assert.equal(api.frameOwnsMessage({ type: 'FILL_FORM', expectedUrl: 'https://job-boards.greenhouse.io/acme/jobs/123' }), true);
  assert.equal(api.frameOwnsMessage({ type: 'DETECT_ATS' }), true);
  window.close();
});

test('the host page answers when it has no embedded ATS form', () => {
  const { window, api } = load({
    url: 'https://www.example.com/careers/engineer',
    body: '<h1>Engineer</h1><input id="q" /><iframe src="https://www.youtube.com/embed/abc"></iframe>',
  });
  assert.equal(api.frameOwnsMessage({ type: 'FILL_FORM', expectedUrl: 'https://www.example.com/careers/engineer' }), true);
  assert.equal(api.frameOwnsMessage({ type: 'DETECT_ATS' }), true);
  assert.equal(api.frameOwnsMessage({ type: 'GET_JOB_INFO' }), true);
  window.close();
});

test('the embedded Greenhouse form owns the messages once it has fields', () => {
  const { window, api } = load({ url: EMBED_URL, body: EMBED_BODY, referrer: PARENT_JOB_URL, framed: true });
  assert.equal(api.frameOwnsMessage({ type: 'FILL_FORM', expectedUrl: PARENT_JOB_URL }), true);
  assert.equal(api.frameOwnsMessage({ type: 'DETECT_ATS' }), true);
  assert.equal(api.frameOwnsMessage({ type: 'GET_JOB_INFO' }), true);
  window.close();
});

test('embedded fill accepts an origin-only referrer while binding to the exact parent URL', () => {
  const { window, api } = load({
    url: EMBED_URL,
    body: EMBED_BODY,
    referrer: 'https://databricks.com/',
    framed: true,
  });
  assert.equal(api.frameOwnsMessage({ type: 'FILL_FORM', expectedUrl: PARENT_JOB_URL }), true);
  window.close();
});

test('an unrelated iframe with fields does not claim DETECT_ATS on a generic page', () => {
  const { window, api } = load({
    url: 'https://ads.example.net/frame',
    body: '<input id="x" />',
    framed: true,
  });
  assert.equal(api.frameOwnsMessage({ type: 'DETECT_ATS' }), false);
  window.close();
});

test('filling an embedded Greenhouse form logs one tracker entry with company and title', async () => {
  const logged = [];
  const { window, api } = load({
    url: EMBED_URL,
    body: EMBED_BODY,
    referrer: PARENT_JOB_URL,
    framed: true,
  });
  window.chrome.runtime.sendMessage = (msg) => {
    if (msg.type === 'LOG_APPLICATION') logged.push(msg.payload);
    if (msg.type === 'GENERATE_ANSWERS') return Promise.resolve({ success: true, answers: {} });
    return Promise.resolve({});
  };
  await api.handleFillForm(PARENT_JOB_URL);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].company, 'Databricks');
  assert.equal(logged[0].title, 'Delivery Solutions Architect - Digital Native Business');
  assert.equal(logged[0].url, PARENT_JOB_URL);
  window.close();
});
