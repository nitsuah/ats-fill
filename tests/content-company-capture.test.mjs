import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Company/title capture for tracker entries. Each page below mirrors a real
// capture that saved a bad company:
//   - Ashby application page with no company element → the whole tab title
//     ("Staff Software Engineer - DevX @ Amplitude") became the company.
//   - Workday on *.myworkdayjobs.com wasn't routed as Workday, and its JSON-LD
//     hiringOrganization carries a legal-entity code ("100 Everfox Holdings, LLC").
//   - Monster apply flow → title "My Application - …", no company.
const CONTENT_JS = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');

function extractFromPage({ url, title = '', body = '', jsonLd: jsonLdInput = null }) {
  const ld = jsonLdInput ? `<script type="application/ld+json">${JSON.stringify(jsonLdInput)}</script>` : '';
  const dom = new JSDOM(`<!doctype html><html><head><title>${title}</title>${ld}</head><body>${body}</body></html>`, {
    url,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  // jsdom has no layout, so no innerText; textContent is close enough here.
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    configurable: true,
  });
  // No runtime.id: the script treats the extension context as absent and
  // skips storage-backed draft persistence; listeners are inert stubs.
  window.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: () => Promise.resolve(),
    },
  };
  window.eval(CONTENT_JS);
  const info = window.extractJobInfo();
  const jsonLd = window.parseJobPostingJsonLd(window.readJsonLdObjects());
  window.close();
  return { info, jsonLd };
}

function capture(options) {
  const { info } = extractFromPage(options);
  return { company: info.company, title: info.title };
}

function captureJsonLdDescription(options) {
  return extractFromPage(options).jsonLd?.description || '';
}

test('Ashby application page takes the company from "Role @ Company", not the whole tab title', () => {
  assert.deepEqual(capture({
    url: 'https://jobs.ashbyhq.com/amplitude/bf9c8a9c/application',
    title: 'Staff Software Engineer - DevX @ Amplitude',
    body: '<h1>Staff Software Engineer - DevX</h1><main>Apply for this job</main>',
  }), { company: 'Amplitude', title: 'Staff Software Engineer - DevX' });
});

test('Ashby falls back to the board slug when the tab title names no company', () => {
  assert.deepEqual(capture({
    url: 'https://jobs.ashbyhq.com/northwind-traders/123/application',
    title: 'Jobs',
    body: '<h1>Platform Engineer</h1>',
  }), { company: 'Northwind Traders', title: 'Platform Engineer' });
});

test('Workday on myworkdayjobs.com strips the legal-entity code from hiringOrganization', () => {
  assert.deepEqual(capture({
    url: 'https://contoso.wd1.myworkdayjobs.com/en-US/external/job/USA_VA/Collaboration-Tools-Administrator_JR1/apply',
    title: 'Collaboration Tools Administrator',
    body: '<h2 data-automation-id="jobPostingHeader">Collaboration Tools Administrator</h2>',
    jsonLd: { '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Collaboration Tools Administrator', hiringOrganization: { '@type': 'Organization', name: '100 Contoso Holdings, LLC' } },
  }), { company: 'Contoso Holdings, LLC', title: 'Collaboration Tools Administrator' });
});

test('generic apply flow drops the "My Application -" prefix from the title', () => {
  assert.deepEqual(capture({
    url: 'https://www.example-jobs.com/profile/apply/contact-info',
    title: 'Apply | Example Jobs',
    body: '<h1>My Application - Jira Optimization Consultant (Remote)</h1>',
  }), { company: '', title: 'Jira Optimization Consultant (Remote)' });
});

test('Greenhouse prefers the page company element, and JSON-LD beats the tab title', () => {
  assert.deepEqual(capture({
    url: 'https://boards.greenhouse.io/fabrikam/jobs/1',
    title: 'Job Application for Data Engineer at Fabrikam',
    body: '<div id="header"><h1 class="app-title">Data Engineer</h1><span class="company-name">Fabrikam, Inc.</span></div>',
  }), { company: 'Fabrikam, Inc.', title: 'Data Engineer' });

  assert.deepEqual(capture({
    url: 'https://boards.greenhouse.io/embed/job_app?for=fabrikam&token=1',
    title: 'Job Application for Data Engineer at Fabrikam',
    body: '<h1 class="app-title">Data Engineer</h1>',
    jsonLd: { '@type': 'JobPosting', title: 'Data Engineer', hiringOrganization: { name: 'Fabrikam Labs' } },
  }), { company: 'Fabrikam Labs', title: 'Data Engineer' });

  assert.deepEqual(capture({
    url: 'https://boards.greenhouse.io/embed/job_app?for=fabrikam&token=1',
    title: 'Job Application for Data Engineer at Fabrikam',
    body: '<h1 class="app-title">Data Engineer</h1>',
  }), { company: 'Fabrikam', title: 'Data Engineer' });
});

test('titles that only look like prefixes, and numbers outside Workday, are left alone', () => {
  assert.deepEqual(capture({
    url: 'https://careers.example.com/jobs/42',
    title: 'Applications Engineer at 84 Lumber',
    body: '<h1>Applications Engineer</h1>',
  }), { company: '84 Lumber', title: 'Applications Engineer' });
});


test('JSON-LD description decodes uppercase-X numeric entities', () => {
  assert.equal(captureJsonLdDescription({
    url: 'https://boards.greenhouse.io/fabrikam/jobs/1',
    title: 'Data Engineer',
    body: '<h1 class="app-title">Data Engineer</h1>',
    jsonLd: {
      '@type': 'JobPosting',
      title: 'Data Engineer',
      description: '<p>Fabrikam &#X41; Labs</p>',
      hiringOrganization: { name: 'Fabrikam Labs' },
    },
  }), 'Fabrikam A Labs');
});
