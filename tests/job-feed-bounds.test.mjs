import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { searchJobs, buildCustomJobSources } from '../lib/job-search.js';

const HACKAJOB_SITEMAP = 'https://hackajob.com/sitemap-jobs.xml';
const JOB_UUID = '11111111-aaaa-bbbb-cccc-000000000001';

const RSS = `<?xml version="1.0"?><rss><channel>
  <item>
    <title>Program Analyst at Tennessee Department of Labor</title>
    <link>https://jobs4tn.gov/jobs/1</link>
    <pubDate>Mon, 02 Jun 2026 10:00:00 +0000</pubDate>
    <description>Remote-eligible.</description>
  </item>
</channel></rss>`;

const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body });
const notFound = () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => '' });
const redirectTo = (location) => ({
  ok: false,
  status: 302,
  headers: { get: (name) => (name.toLowerCase() === 'location' ? location : null) },
  text: async () => '',
});

/**
 * A fetch stub that records every request. Requests without `redirect: 'manual'`
 * are followed here, the way the platform fetch does by default, so a fetch
 * that follows a redirect to a host it should not reach is visible in `calls`.
 */
function recordingFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    let target = String(url);
    calls.push({ url: target, redirect: init.redirect ?? 'follow' });
    for (let hop = 0; hop < 5; hop += 1) {
      // Routes match on the URL without its query string: the feed fetch appends ?q=.
      const response = routes(target.split('?')[0]) || notFound();
      const isRedirect = response.status >= 300 && response.status < 400;
      if (!isRedirect || init.redirect === 'manual') return response;
      const location = response.headers.get('location');
      target = new URL(location, target).toString();
      calls.push({ url: target, redirect: 'follow' });
    }
    return notFound();
  };
  return { fetchImpl, calls };
}

function withDomParser(fn) {
  return async (...args) => {
    const original = globalThis.DOMParser;
    globalThis.DOMParser = new JSDOM().window.DOMParser;
    try {
      return await fn(...args);
    } finally {
      if (original === undefined) delete globalThis.DOMParser;
      else globalThis.DOMParser = original;
    }
  };
}

const JOBS4TN_CONFIG = {
  customSources: [{ id: 'custom-jobs4tn', label: 'JOBS4TN', url: 'https://jobs4tn.gov/rss' }],
};

test('custom feed redirect to a host outside the allowlist is refused without fetching the target', withDomParser(async () => {
  const { fetchImpl, calls } = recordingFetch((url) => {
    if (url === 'https://jobs4tn.gov/rss') return redirectTo('https://evil-target.example/steal');
    if (url.startsWith('https://evil-target.example/')) return ok(RSS);
    return undefined;
  });

  const outcome = await searchJobs('analyst', { fetchImpl, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] })
    .then(() => 'resolved', (err) => err.message);
  assert.equal(calls.some((c) => c.url.includes('evil-target.example')), false, 'the redirect target must never be requested');
  assert.equal(calls[0].redirect, 'manual', 'the first request must not follow redirects automatically');
  assert.match(outcome, /unavailable/i);
}));

test('custom feed on an allowed host works, and a same-host redirect hop is re-checked and followed', withDomParser(async () => {
  const { fetchImpl, calls } = recordingFetch((url) => {
    if (url === 'https://jobs4tn.gov/rss') return redirectTo('https://jobs4tn.gov/rss-current');
    if (url === 'https://jobs4tn.gov/rss-current') return ok(RSS);
    return undefined;
  });

  const { jobs, sources } = await searchJobs('analyst', { fetchImpl, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] });
  assert.equal(sources[0].ok, true);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].source, 'JOBS4TN');
  assert.deepEqual(calls.map((c) => c.url), ['https://jobs4tn.gov/rss?q=analyst', 'https://jobs4tn.gov/rss-current']);
}));

test('custom feed with a non-https URL is never registered or fetched', async () => {
  const entries = buildCustomJobSources([{ id: 'custom-plain', label: 'Plain', url: 'http://jobs4tn.gov/rss' }]);
  assert.deepEqual(entries, []);

  const { fetchImpl, calls } = recordingFetch(() => ok(RSS));
  const { jobs, sources } = await searchJobs('analyst', {
    fetchImpl,
    config: { customSources: [{ id: 'custom-plain', label: 'Plain', url: 'http://jobs4tn.gov/rss' }] },
    sources: ['custom-plain'],
  });
  assert.deepEqual(jobs, []);
  assert.deepEqual(sources, []);
  assert.equal(calls.length, 0, 'no request may be sent for a non-https feed');
});

test('custom feed on a numeric private IPv4 or bracketed IPv6 literal is not registered', () => {
  const entries = buildCustomJobSources([
    { id: 'custom-private-v4', label: 'Private', url: 'https://10.0.0.5/rss' },
    { id: 'custom-loopback-v6', label: 'Loopback', url: 'https://[::1]/rss' },
  ]);
  assert.deepEqual(entries, []);
});

test('job-board detail URLs whose host only contains an allowed name are not fetched', withDomParser(async () => {
  const sitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://hackajob.com/job/${JOB_UUID}</loc><lastmod>2026-06-02</lastmod></url>
    <url><loc>https://hackajob.com.evil-target.example/job/11111111-aaaa-bbbb-cccc-000000000002</loc><lastmod>2026-06-01</lastmod></url>
    <url><loc>https://evilhackajob.com/job/11111111-aaaa-bbbb-cccc-000000000003</loc><lastmod>2026-05-30</lastmod></url>
    <url><loc>http://hackajob.com/job/11111111-aaaa-bbbb-cccc-000000000004</loc><lastmod>2026-05-29</lastmod></url>
  </urlset>`;
  const { fetchImpl, calls } = recordingFetch((url) => {
    if (url === HACKAJOB_SITEMAP) return ok(sitemap);
    if (url.startsWith('https://hackajob.com/job/')) return ok('<html></html>');
    return undefined;
  });

  const { sources } = await searchJobs('engineer', { fetchImpl, sources: ['hackajob'] });
  assert.equal(sources[0].ok, true);
  assert.deepEqual(
    calls.map((c) => c.url),
    [HACKAJOB_SITEMAP, `https://hackajob.com/job/${JOB_UUID}`],
    'only the sitemap and the allowed detail page may be requested'
  );
}));

test('a feed that never answers is abandoned after the time limit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchImpl = () => new Promise(() => {});
  const pending = searchJobs('analyst', { fetchImpl, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] })
    .then(() => 'resolved', (err) => err.message);
  t.mock.timers.tick(15_000);
  // setImmediate is not mocked, so this settles after the pending request's microtasks have run.
  const outcome = await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve('still waiting')))]);
  assert.match(outcome, /unavailable/i);
});

test('a feed declaring a body larger than the cap is refused before its body is read', withDomParser(async () => {
  let bodyRead = false;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-length' ? '5000000' : null) },
    text: async () => { bodyRead = true; return RSS; },
  });
  await assert.rejects(
    () => searchJobs('analyst', { fetchImpl, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] }),
    /unavailable/i
  );
  assert.equal(bodyRead, false);
}));
