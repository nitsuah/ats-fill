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

/** A response whose body reads are counted in `tracker.reads`. */
function ok(body, tracker = { reads: 0 }, headers = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => ({ 'content-type': 'application/rss+xml', ...headers })[name.toLowerCase()] ?? null },
    text: async () => { tracker.reads += 1; return body; },
  };
}
const notFound = () => ({ ok: false, status: 404, headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/rss+xml' : null) }, text: async () => '' });
const redirectTo = (location) => ({
  ok: false,
  status: 302,
  headers: { get: (name) => (name.toLowerCase() === 'location' ? location : null) },
  text: async () => '',
});

/**
 * A fetch stub that behaves like the platform fetch for the default
 * redirect mode: it follows 3xx responses and returns a response whose `url`
 * is the final URL and whose `redirected` says whether a hop happened. Every
 * request, and every followed hop, is recorded in `calls`. Routes are matched
 * on the URL without its query string, because the feed fetch appends ?q=.
 */
function recordingFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    let target = String(url);
    calls.push({ url: target, redirect: init.redirect });
    let redirected = false;
    for (let hop = 0; hop < 5; hop += 1) {
      const response = routes(target.split('?')[0]) || notFound();
      const isRedirect = response.status >= 300 && response.status < 400;
      if (isRedirect && init.redirect === 'error') throw new TypeError('redirect mode is set to error');
      if (!isRedirect || init.redirect === 'manual') return { ...response, url: target, redirected };
      target = new URL(response.headers.get('location'), target).toString();
      calls.push({ url: target, redirect: 'hop' });
      redirected = true;
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

test('custom feed whose final URL is on another host is refused before its body is read', withDomParser(async () => {
  const evil = { reads: 0 };
  const { fetchImpl, calls } = recordingFetch((url) => {
    if (url === 'https://jobs4tn.gov/rss') return redirectTo('https://evil-target.example/steal');
    if (url === 'https://evil-target.example/steal') return ok(RSS, evil);
    return undefined;
  });

  const outcome = await searchJobs('analyst', { fetchImpl, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] })
    .then(() => 'resolved', (err) => err.message);
  assert.equal(evil.reads, 0, 'the body of a response on a disallowed final host must not be read');
  assert.equal(calls[0].redirect, 'error', 'custom feed requests refuse redirects');
  assert.deepEqual(calls.map((c) => c.url), ['https://jobs4tn.gov/rss?q=analyst'], 'the redirect target is never requested');
  assert.match(outcome, /unavailable/i);
}));

test('custom feed redirect, even within the same host, is refused', withDomParser(async () => {
  const { fetchImpl, calls } = recordingFetch((url) => {
    if (url === 'https://jobs4tn.gov/rss') return redirectTo('https://jobs4tn.gov/rss-current');
    if (url === 'https://jobs4tn.gov/rss-current') return ok(RSS);
    return undefined;
  });

  const outcome = await searchJobs('analyst', { fetchImpl, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] })
    .then(() => 'resolved', (err) => err.message);
  assert.match(outcome, /unavailable/i);
  assert.deepEqual(calls.map((c) => c.url), ['https://jobs4tn.gov/rss?q=analyst']);
}));

test('a trailing dot on the configured host does not change the host match', withDomParser(async () => {
  const { fetchImpl } = recordingFetch((url) => (url === 'https://jobs4tn.gov./rss' ? ok(RSS) : undefined));
  const config = { customSources: [{ id: 'custom-dot', label: 'Dot', url: 'https://jobs4tn.gov./rss' }] };
  const { jobs, sources } = await searchJobs('analyst', { fetchImpl, config, sources: ['custom-dot'] });
  assert.equal(sources[0].ok, true);
  assert.equal(jobs.length, 1);
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

test('custom feeds on local-network addresses are refused at fetch time while the setting is off', async () => {
  const blocked = [
    'https://127.0.0.1/rss',
    'https://10.0.0.5/rss',
    'https://192.0.0.8/rss',
    'https://198.18.0.1/rss',
    'https://224.0.0.1/rss',
    'https://[::1]/rss',
    'https://[::]/rss',
    'https://[fd12:3456::1]/rss',
    'https://[fe80::1]/rss',
    'https://[::ffff:7f00:1]/rss',
    'https://[::ffff:10.0.0.1]/rss',
    'https://[::ffff:a9fe:a9fe]/rss',
    'https://intranet.internal/rss',
    'https://printer.local/rss',
    'https://app.localhost./rss',
    'https://printer.local./rss',
  ];
  for (const url of blocked) {
    const { fetchImpl, calls } = recordingFetch(() => ok(RSS));
    const config = { customSources: [{ id: 'custom-blocked', label: 'Blocked', url }] };
    const outcome = await searchJobs('analyst', { fetchImpl, config, sources: ['custom-blocked'] }).catch((e) => e.message);
    assert.match(String(outcome), /unavailable/i, `${url} must not return jobs`);
    assert.equal(calls.length, 0, `${url} must not be requested`);
  }
  assert.deepEqual(
    buildCustomJobSources([{ id: 'custom-ok', label: 'OK', url: 'https://jobs4tn.gov/rss' }]).map((e) => e.id),
    ['custom-ok'],
    'a public host is still registered'
  );
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
    if (url === `https://hackajob.com/job/${JOB_UUID}`) return ok('<html></html>');
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

test('a hackajob detail URL with a trailing dot on the allowed host is fetched', withDomParser(async () => {
  const sitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://hackajob.com./job/${JOB_UUID}</loc><lastmod>2026-06-02</lastmod></url>
  </urlset>`;
  const { fetchImpl, calls } = recordingFetch((url) => {
    if (url === HACKAJOB_SITEMAP) return ok(sitemap);
    if (url === `https://hackajob.com./job/${JOB_UUID}`) return ok('<html></html>');
    return undefined;
  });
  await searchJobs('engineer', { fetchImpl, sources: ['hackajob'] });
  assert.equal(calls.some((c) => c.url === `https://hackajob.com./job/${JOB_UUID}`), true);
}));

test('a hackajob detail page whose final URL is another host is refused before its body is read', withDomParser(async () => {
  const evil = { reads: 0 };
  const sitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://hackajob.com/job/${JOB_UUID}</loc><lastmod>2026-06-02</lastmod></url>
  </urlset>`;
  const { fetchImpl } = recordingFetch((url) => {
    if (url === HACKAJOB_SITEMAP) return ok(sitemap);
    if (url === `https://hackajob.com/job/${JOB_UUID}`) return redirectTo('https://evil-target.example/job');
    if (url === 'https://evil-target.example/job') return ok('<html></html>', evil);
    return undefined;
  });
  const { jobs, sources } = await searchJobs('engineer', { fetchImpl, sources: ['hackajob'] });
  assert.equal(sources[0].ok, true);
  assert.deepEqual(jobs, []);
  assert.equal(evil.reads, 0, 'the disallowed final host must not have its body read');
}));

test('hackajob detail pages accept up to 3 MB while custom feeds still stop at 1 MB', withDomParser(async () => {
  const detailReads = { reads: 0 };
  const sitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://hackajob.com/job/${JOB_UUID}</loc><lastmod>2026-06-02</lastmod></url>
  </urlset>`;
  const { fetchImpl } = recordingFetch((url) => {
    if (url === HACKAJOB_SITEMAP) return ok(sitemap);
    if (url === `https://hackajob.com/job/${JOB_UUID}`) return ok('<html></html>', detailReads, { 'content-length': '2000000' });
    return undefined;
  });
  await searchJobs('engineer', { fetchImpl, sources: ['hackajob'] });
  assert.equal(detailReads.reads, 1, 'a 2 MB detail page is within the detail cap');

  const feedReads = { reads: 0 };
  const feedFetch = recordingFetch(() => ok(RSS, feedReads, { 'content-length': '2000000' })).fetchImpl;
  await assert.rejects(
    () => searchJobs('analyst', { fetchImpl: feedFetch, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] }),
    /unavailable/i
  );
  assert.equal(feedReads.reads, 0, 'a 2 MB custom feed is over the feed cap and is not read');
}));

test('a feed that never answers is abandoned after the time limit and its request is aborted', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requestSignal;
  const fetchImpl = (_url, init = {}) => {
    requestSignal = init.signal;
    return new Promise(() => {});
  };
  const pending = searchJobs('analyst', { fetchImpl, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] })
    .then(() => 'resolved', (err) => err.message);
  t.mock.timers.tick(15_000);
  // setImmediate is not mocked, so this settles after the pending request's microtasks have run.
  const outcome = await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve('still waiting')))]);
  assert.match(outcome, /unavailable/i);
  assert.equal(requestSignal?.aborted, true, 'the timed-out request must be aborted, not left running');
});

/** A streamed response whose cancel() is observable. */
function streamedResponse(status, headers, tracker) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => ({ 'content-type': 'application/rss+xml', ...headers })[name.toLowerCase()] ?? null },
    body: new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(RSS)); },
      cancel() { tracker.cancelled = true; },
    }),
    text: async () => { tracker.read = true; return RSS; },
  };
}

test('a response refused for its status or declared size has its body cancelled', withDomParser(async () => {
  for (const [status, headers] of [[500, {}], [200, { 'content-length': '5000000' }]]) {
    const tracker = { cancelled: false, read: false };
    const fetchImpl = async () => streamedResponse(status, headers, tracker);
    await assert.rejects(
      () => searchJobs('analyst', { fetchImpl, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] }),
      /unavailable/i
    );
    assert.equal(tracker.cancelled, true, `status ${status} body must be cancelled`);
    assert.equal(tracker.read, false, `status ${status} body must not be read`);
  }
}));

test('a text-only response is measured in bytes, so multibyte text over the cap is refused', withDomParser(async () => {
  // 600,000 two-byte characters: 600,000 UTF-16 units but 1,200,000 UTF-8 bytes, over the 1 MB feed cap.
  const big = 'é'.repeat(600_000);
  const reads = { reads: 0 };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'https://jobs4tn.gov/rss',
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/rss+xml' : null) },
    text: async () => { reads.reads += 1; return big; },
  });
  await assert.rejects(
    () => searchJobs('analyst', { fetchImpl, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] }),
    /unavailable/i
  );
  assert.equal(reads.reads, 1);
}));

test('the Hackajob sitemap is bounded: a declared size over the cap or a disallowed final host is refused', withDomParser(async () => {
  const tooLarge = { cancelled: false, read: false };
  const { fetchImpl: largeFetch } = recordingFetch((url) => {
    if (url === HACKAJOB_SITEMAP) return streamedResponse(200, { 'content-length': '4000000' }, tooLarge);
    return undefined;
  });
  const large = await searchJobs('engineer', { fetchImpl: largeFetch, sources: ['hackajob'] })
    .then((r) => r.sources[0], () => 'rejected');
  assert.equal(large.ok === true, false, 'an oversized sitemap must not succeed');
  assert.equal(tooLarge.read, false);

  const evil = { reads: 0 };
  const { fetchImpl: redirected } = recordingFetch((url) => {
    if (url === HACKAJOB_SITEMAP) return redirectTo('https://evil-target.example/sitemap.xml');
    if (url === 'https://evil-target.example/sitemap.xml') return ok('<urlset></urlset>', evil);
    return undefined;
  });
  await searchJobs('engineer', { fetchImpl: redirected, sources: ['hackajob'] }).catch(() => {});
  assert.equal(evil.reads, 0, 'a sitemap whose final host is not allowed must not be read');
}));

test('a feed declaring a body larger than the cap is refused before its body is read', withDomParser(async () => {
  const reads = { reads: 0 };
  const fetchImpl = async () => ok(RSS, reads, { 'content-length': '5000000' });
  await assert.rejects(
    () => searchJobs('analyst', { fetchImpl, config: JOBS4TN_CONFIG, sources: ['custom-jobs4tn'] }),
    /unavailable/i
  );
  assert.equal(reads.reads, 0);
}));

test('fetchJobFeedText passes the redirect option through and defaults to follow', async () => {
  const { fetchJobFeedText } = await import('../lib/job-search.js');
  const seen = [];
  const doFetch = async (url, init) => { seen.push(init.redirect); return { ...ok('x'), url }; };
  const allowedHosts = ['jobs4tn.gov'];
  await fetchJobFeedText('https://jobs4tn.gov/rss', { doFetch, allowedHosts });
  await fetchJobFeedText('https://jobs4tn.gov/rss', { doFetch, allowedHosts, redirect: 'error' });
  assert.deepEqual(seen, ['follow', 'error']);
});
