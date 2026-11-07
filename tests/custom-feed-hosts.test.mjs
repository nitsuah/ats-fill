import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { checkFeedUrl, isLocalNetworkHost } from '../lib/feed-hosts.js';
import { searchJobs, fetchJobFeedText, buildCustomJobSources } from '../lib/job-search.js';

const RSS = `<?xml version="1.0"?><rss><channel>
  <item>
    <title>Program Analyst at Example Agency</title>
    <link>https://jobs.example.org/1</link>
    <description>Remote-eligible.</description>
  </item>
</channel></rss>`;

function response(body, { contentType = 'application/rss+xml', url, headers = {} } = {}) {
  const all = { 'content-type': contentType, 'content-length': String(Buffer.byteLength(body)), ...headers };
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: (name) => all[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

/** A fetch stub that records every call and answers with a feed for the requested URL. */
function feedFetch(options = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return response(RSS, { ...options, url: String(url) });
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

const source = (url) => ({ customSources: [{ id: 'custom-x', label: 'X', url }] });
const run = (url, { allow = false, fetchImpl } = {}) => searchJobs('analyst', {
  fetchImpl,
  config: { ...source(url), allowLocalNetworkFeeds: allow },
  sources: ['custom-x'],
});

// ── Classification ─────────────────────────────────────────────────────────

const LOCAL_HOST_URLS = {
  'IPv4 loopback': 'http://127.0.0.1/rss',
  'IPv4 loopback, whole /8': 'http://127.200.3.4/rss',
  'IPv4 private 10/8': 'http://10.1.2.3/rss',
  'IPv4 private 172.16/12': 'http://172.16.0.1/rss',
  'IPv4 private 172.31': 'http://172.31.255.255/rss',
  'IPv4 private 192.168/16': 'http://192.168.1.10/rss',
  'IPv4 link-local': 'http://169.254.169.254/rss',
  'IPv4 CGNAT low edge': 'http://100.64.0.1/rss',
  'IPv4 CGNAT high edge': 'http://100.127.255.255/rss',
  'IPv4 unspecified': 'http://0.0.0.0/rss',
  'IPv4 multicast': 'http://224.0.0.1/rss',
  'IPv4 broadcast': 'http://255.255.255.255/rss',
  'IPv4 as one decimal number': 'http://2130706433/rss',
  'IPv4 octal octets': 'http://0177.0.0.1/rss',
  'IPv4 hex octets': 'http://0x7f.0.0.1/rss',
  'IPv4 hex single number': 'http://0x7f000001/rss',
  'IPv4 short form': 'http://127.1/rss',
  'IPv4 short form, private': 'http://10.1/rss',
  'IPv6 loopback': 'http://[::1]/rss',
  'IPv6 unspecified': 'http://[::]/rss',
  'IPv6 unique-local fc00::/7': 'http://[fc00::1]/rss',
  'IPv6 unique-local fd': 'http://[fd12:3456:789a::1]/rss',
  'IPv6 link-local': 'http://[fe80::1]/rss',
  'IPv6 link-local, top of fe80::/10': 'http://[febf::1]/rss',
  'IPv6 multicast': 'http://[ff02::1]/rss',
  'IPv4-mapped loopback (hex)': 'http://[::ffff:7f00:1]/rss',
  'IPv4-mapped private (dotted)': 'http://[::ffff:10.0.0.1]/rss',
  'IPv4-mapped link-local': 'http://[::ffff:a9fe:a9fe]/rss',
  'localhost': 'http://localhost/rss',
  'localhost with port': 'http://localhost:8080/rss',
  'localhost with trailing dot': 'http://localhost./rss',
  'subdomain of localhost': 'http://jobs.localhost/rss',
  'single-label name': 'http://intranet/rss',
  'single-label name over https': 'https://hr/rss',
  '.local': 'http://printer.local/rss',
  '.internal': 'https://careers.internal/rss',
  '.lan': 'http://nas.lan/rss',
  '.home': 'http://box.home/rss',
  '.home.arpa': 'http://box.home.arpa/rss',
  '.corp': 'https://jobs.corp/rss',
  '.intranet': 'https://hr.intranet/rss',
  '.private': 'https://hr.private/rss',
  'suffix with trailing dot': 'http://printer.local./rss',
  'suffix is case-insensitive': 'http://Printer.LOCAL/rss',
};

for (const [name, url] of Object.entries(LOCAL_HOST_URLS)) {
  test(`local-network class: ${name}`, () => {
    const hostname = new URL(url).hostname;
    assert.equal(isLocalNetworkHost(hostname), true, `${url} (${hostname})`);
    const off = checkFeedUrl(url);
    assert.equal(off.ok, false);
    assert.equal(off.localNetwork, true);
    assert.match(off.error, /Allow local-network feeds/);
    const on = checkFeedUrl(url, { allowLocalNetwork: true });
    assert.equal(on.ok, true, `${url} should be allowed once the setting is on`);
    assert.equal(on.localNetwork, true);
  });
}

const PUBLIC_URLS = [
  'https://jobs4tn.gov/rss',
  'https://www.example.com/feed.xml',
  'https://8.8.8.8/rss',
  'https://100.63.255.255/rss',
  'https://100.128.0.1/rss',
  'https://172.15.0.1/rss',
  'https://172.32.0.1/rss',
  'https://169.253.0.1/rss',
  'https://192.169.0.1/rss',
  'https://[2606:4700:4700::1111]/rss',
  'https://[::ffff:808:808]/rss',
  'https://intranet.example.com/rss',
  'https://corp.example.com/rss',
  'https://notlocal.com/rss',
  'https://mylocal.com/rss',
  'https://localhost.example.com/rss',
];

for (const url of PUBLIC_URLS) {
  test(`public host is not local-network: ${url}`, () => {
    assert.equal(isLocalNetworkHost(new URL(url).hostname), false);
    const result = checkFeedUrl(url);
    assert.equal(result.ok, true);
    assert.equal(result.localNetwork, false);
  });
}

test('public feeds must use https, with or without the local-network setting', () => {
  for (const allowLocalNetwork of [false, true]) {
    const result = checkFeedUrl('http://jobs4tn.gov/rss', { allowLocalNetwork });
    assert.equal(result.ok, false);
    assert.match(result.error, /https/);
    assert.equal(checkFeedUrl('http://8.8.8.8/rss', { allowLocalNetwork }).ok, false);
  }
});

test('http is allowed only for local-network hosts, and only with the setting on', () => {
  assert.equal(checkFeedUrl('http://hr.intranet/rss', { allowLocalNetwork: true }).ok, true);
  assert.equal(checkFeedUrl('http://hr.intranet/rss').ok, false);
});

test('other schemes, embedded credentials and non-URLs are refused', () => {
  const opts = { allowLocalNetwork: true };
  for (const url of ['ftp://jobs4tn.gov/rss', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@jobs4tn.gov/rss',
    'http://user@localhost/rss', 'not a url', '']) {
    assert.equal(checkFeedUrl(url, opts).ok, false, url);
  }
});

// ── Fetch behaviour ────────────────────────────────────────────────────────

test('stored local-network feeds are refused at fetch time while the setting is off and fetched once it is on', withDomParser(async () => {
  const url = 'http://hr.intranet/rss';
  const off = feedFetch();
  await assert.rejects(() => run(url, { allow: false, fetchImpl: off.fetchImpl }), /unavailable/i);
  assert.equal(off.calls.length, 0, 'no request may be sent while the setting is off');

  const on = feedFetch();
  const { jobs, sources } = await run(url, { allow: true, fetchImpl: on.fetchImpl });
  assert.equal(sources[0].ok, true);
  assert.equal(jobs.length, 1);
  assert.equal(on.calls.length, 1);
  assert.match(on.calls[0].url, /^http:\/\/hr\.intranet\/rss/);
}));

test('the refusal names the setting, and the same stored feed works once the setting is on', withDomParser(async () => {
  const entries = buildCustomJobSources([{ id: 'custom-x', label: 'X', url: 'http://192.168.1.5/rss' }]);
  assert.equal(entries.length, 1);
  const { fetchImpl } = feedFetch();
  await assert.rejects(
    () => entries[0].run('', { doFetch: fetchImpl, config: {} }),
    /Allow local-network feeds/
  );
  const jobs = await entries[0].run('', { doFetch: fetchImpl, config: { allowLocalNetworkFeeds: true } });
  assert.equal(jobs.length, 1);
}));

test('the setting must be exactly true: other truthy values do not enable local-network feeds', withDomParser(async () => {
  const { fetchImpl, calls } = feedFetch();
  await assert.rejects(
    () => searchJobs('', { fetchImpl, config: { ...source('http://localhost/rss'), allowLocalNetworkFeeds: 'false' }, sources: ['custom-x'] }),
    /unavailable/i
  );
  assert.equal(calls.length, 0);
}));

test('a public feed over http is neither registered nor fetched, even with the setting on', withDomParser(async () => {
  assert.deepEqual(buildCustomJobSources([{ id: 'custom-x', label: 'X', url: 'http://jobs4tn.gov/rss' }]), []);
  const { fetchImpl, calls } = feedFetch();
  const { sources } = await run('http://jobs4tn.gov/rss', { allow: true, fetchImpl });
  assert.deepEqual(sources, []);
  assert.equal(calls.length, 0);
}));

test('custom feed requests omit credentials, bypass the cache, refuse redirects and send no custom headers', withDomParser(async () => {
  const { fetchImpl, calls } = feedFetch();
  await run('https://jobs.example.org/rss', { fetchImpl });
  assert.equal(calls.length, 1);
  const { init } = calls[0];
  assert.equal(init.credentials, 'omit');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers, undefined);
  assert.ok(init.signal, 'a timeout signal is attached');
}));

test('built-in board requests also omit credentials and bypass the cache', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(init);
    return { ok: true, status: 200, url, headers: { get: () => null }, json: async () => ({ jobs: [] }), text: async () => '' };
  };
  await searchJobs('analyst', { fetchImpl, sources: ['remotive'] }).catch(() => {});
  assert.ok(calls.length >= 1);
  for (const init of calls) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
  }
});

test('a feed larger than the cap is refused after streaming stops, local-network feeds included', withDomParser(async () => {
  let cancelled = false;
  let pulled = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(400_000));
    },
    cancel() { cancelled = true; },
  });
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/xml' : null) },
    body,
    text: async () => { throw new Error('the whole body must not be buffered'); },
  });
  await assert.rejects(() => run('http://hr.intranet/rss', { allow: true, fetchImpl }), /unavailable/i);
  assert.equal(cancelled, true);
  assert.ok(pulled < 10, `stream was read ${pulled} times`);
}));

test('a declared content-length over the cap is refused before the body is read', async () => {
  let bodyRead = false;
  const fetchImpl = async (url) => ({
    ...response(RSS, { url, headers: { 'content-length': '50000000' } }),
    text: async () => { bodyRead = true; return RSS; },
  });
  await assert.rejects(
    () => fetchJobFeedText('https://jobs.example.org/rss', {
      doFetch: fetchImpl, allowedHosts: ['jobs.example.org'], contentTypes: ['xml'],
    }),
    /too large/
  );
  assert.equal(bodyRead, false);
});

test('a feed that never answers is aborted at the timeout', async () => {
  let aborted = false;
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  });
  await assert.rejects(
    () => fetchJobFeedText('https://jobs.example.org/rss', {
      doFetch: fetchImpl, allowedHosts: ['jobs.example.org'], timeoutMs: 25, label: 'Slow feed',
    }),
    /timed out/
  );
  assert.equal(aborted, true);
});

test('responses with a non-feed content type are refused before the body is read', withDomParser(async () => {
  for (const contentType of ['text/html; charset=utf-8', 'application/octet-stream', 'image/png', '']) {
    let bodyRead = false;
    const fetchImpl = async (url) => ({
      ...response(RSS, { url, contentType }),
      text: async () => { bodyRead = true; return RSS; },
    });
    await assert.rejects(
      () => run('https://jobs.example.org/rss', { fetchImpl }),
      /unavailable/i,
      contentType || '(missing)'
    );
    assert.equal(bodyRead, false, `${contentType || '(missing)'} body must not be read`);
  }
}));

test('xml, rss and atom content types are accepted', withDomParser(async () => {
  for (const contentType of ['application/rss+xml', 'application/xml; charset=utf-8', 'text/xml', 'application/atom+xml']) {
    const { fetchImpl } = feedFetch({ contentType });
    const { jobs } = await run('https://jobs.example.org/rss', { fetchImpl });
    assert.equal(jobs.length, 1, contentType);
  }
}));

test('a redirect from a local-network feed is refused rather than followed', withDomParser(async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init.redirect);
    if (init.redirect === 'error') throw new TypeError('redirect mode is set to error');
    return response(RSS, { url: 'http://169.254.169.254/latest' });
  };
  await assert.rejects(() => run('http://hr.intranet/rss', { allow: true, fetchImpl }), /unavailable/i);
  assert.deepEqual(calls, ['error']);
}));

// ── Adding a feed in the popup ─────────────────────────────────────────────

function setupPopup({ allowChecked }) {
  const dom = new JSDOM(`
    <input id="custom-source-name" />
    <input id="custom-source-url" />
    <input type="checkbox" id="allow-local-network-feeds" ${allowChecked ? 'checked' : ''} />
    <div id="custom-source-status"></div>
    <ul id="custom-job-sources-list"></ul>
  `, { url: 'https://example.com/popup' });
  global.window = dom.window;
  global.document = dom.window.document;
  const sent = [];
  const permissionRequests = [];
  global.chrome = {
    runtime: { sendMessage: (msg, cb) => { sent.push(msg); cb({ success: true }); } },
    permissions: { request: async (req) => { permissionRequests.push(req); return true; } },
  };
  return { sent, permissionRequests };
}

let importCount = 0;
async function addFeed({ allowChecked, url }) {
  const env = setupPopup({ allowChecked });
  importCount += 1;
  const mod = await import(`../popup/ai/ai.js?feedhosts=${importCount}`);
  mod.renderCustomJobSourcesList([]);
  document.getElementById('custom-source-name').value = 'Feed';
  document.getElementById('custom-source-url').value = url;
  await mod.addCustomJobSource();
  return {
    ...env,
    status: document.getElementById('custom-source-status').textContent,
    items: document.querySelectorAll('#custom-job-sources-list .custom-source-item').length,
  };
}

test('adding a local-network feed is refused when the setting is off: no permission prompt, nothing saved', async () => {
  for (const url of ['https://192.168.0.9/rss', 'http://localhost:3000/rss', 'https://hr.intranet/rss', 'http://2130706433/rss']) {
    const r = await addFeed({ allowChecked: false, url });
    assert.match(r.status, /Allow local-network feeds/, url);
    assert.equal(r.items, 0, url);
    assert.equal(r.sent.length, 0, url);
    assert.equal(r.permissionRequests.length, 0, url);
  }
});

test('adding a local-network feed works when the setting is on and asks for that one host only', async () => {
  const r = await addFeed({ allowChecked: true, url: 'http://hr.intranet:8080/rss' });
  assert.match(r.status, /Added/);
  assert.equal(r.items, 1);
  assert.deepEqual(r.permissionRequests, [{ origins: ['http://hr.intranet/*'] }]);
  assert.deepEqual(r.sent[0].payload.settings.custom_job_sources.map((s) => s.url), ['http://hr.intranet:8080/rss']);
});

test('adding a public http feed is refused even with the setting on', async () => {
  const r = await addFeed({ allowChecked: true, url: 'http://jobs4tn.gov/rss' });
  assert.match(r.status, /https/);
  assert.equal(r.items, 0);
  assert.equal(r.permissionRequests.length, 0);
});

test('a public https feed still requests permission for its own origin', async () => {
  const r = await addFeed({ allowChecked: false, url: 'https://jobs4tn.gov/rss' });
  assert.match(r.status, /Added/);
  assert.deepEqual(r.permissionRequests, [{ origins: ['https://jobs4tn.gov/*'] }]);
});

test('toggling the setting saves it, and a failed save puts the checkbox back', async () => {
  const env = setupPopup({ allowChecked: true });
  importCount += 1;
  const mod = await import(`../popup/ai/ai.js?feedhosts=${importCount}`);
  await mod.setAllowLocalNetworkFeeds(true);
  assert.deepEqual(env.sent[0].payload.settings, { allow_local_network_feeds: true });

  global.chrome.runtime.sendMessage = (msg, cb) => cb(null);
  await mod.setAllowLocalNetworkFeeds(true);
  assert.equal(document.getElementById('allow-local-network-feeds').checked, false);
});

// ── Additional address ranges ──────────────────────────────────────────────

for (const [name, url] of Object.entries({
  'IPv6 site-local fec0::/10': 'http://[fec0::1]/rss',
  'IPv6 site-local, top of range': 'http://[feff::1]/rss',
  'IPv6 Teredo 2001::/32': 'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/rss',
  'NAT64 local-use 64:ff9b:1::/48': 'http://[64:ff9b:1::1]/rss',
  'NAT64 well-known prefix with a private IPv4': 'http://[64:ff9b::10.0.0.1]/rss',
})) {
  test(`local-network class: ${name}`, () => {
    assert.equal(isLocalNetworkHost(new URL(url).hostname), true, url);
    assert.equal(checkFeedUrl(url).ok, false);
    assert.equal(checkFeedUrl(url, { allowLocalNetwork: true }).ok, true);
  });
}

for (const url of ['https://[2001:db8::1]/rss', 'https://[2001:1::1]/rss', 'https://[64:ff9b::808:808]/rss', 'https://[fe00::1]/rss']) {
  test(`public host is not local-network: ${url}`, () => {
    assert.equal(isLocalNetworkHost(new URL(url).hostname), false);
  });
}

// ── Responses without a body stream ────────────────────────────────────────

test('a response with no body stream and no declared size is refused without being read', async () => {
  let read = false;
  const fetchImpl = async (url) => ({
    ...response(RSS, { url, headers: { 'content-length': '' } }),
    body: null,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/xml' : null) },
    text: async () => { read = true; return RSS; },
  });
  await assert.rejects(
    () => fetchJobFeedText('https://jobs.example.org/rss', { doFetch: fetchImpl, allowedHosts: ['jobs.example.org'] }),
    /too large/
  );
  assert.equal(read, false);
});

test('a response with no body stream is read only when its declared size is within the cap', async () => {
  const mk = (length) => async (url) => ({ ...response(RSS, { url, headers: { 'content-length': length } }), body: null });
  const opts = { allowedHosts: ['jobs.example.org'], maxBytes: 5000 };
  assert.equal(await fetchJobFeedText('https://jobs.example.org/rss', { ...opts, doFetch: mk('4000') }), RSS);
  await assert.rejects(() => fetchJobFeedText('https://jobs.example.org/rss', { ...opts, doFetch: mk('6000') }), /too large/);
});

// ── Permission cleanup when saving fails ───────────────────────────────────

test('the origin permission is revoked when saving the feed fails after the prompt', async () => {
  const env = setupPopup({ allowChecked: false });
  const removed = [];
  global.chrome.permissions.remove = async (req) => { removed.push(req); return true; };
  global.chrome.runtime.sendMessage = (msg, cb) => cb(null);
  importCount += 1;
  const mod = await import(`../popup/ai/ai.js?feedhosts=${importCount}`);
  mod.renderCustomJobSourcesList([]);
  document.getElementById('custom-source-name').value = 'Feed';
  document.getElementById('custom-source-url').value = 'https://jobs4tn.gov/rss';
  await mod.addCustomJobSource();
  assert.deepEqual(env.permissionRequests, [{ origins: ['https://jobs4tn.gov/*'] }]);
  assert.deepEqual(removed, [{ origins: ['https://jobs4tn.gov/*'] }]);
  assert.equal(document.querySelectorAll('.custom-source-item').length, 0);
});

test('the permission is kept when saving succeeds, and when another saved feed uses the same host', async () => {
  const env = setupPopup({ allowChecked: false });
  const removed = [];
  global.chrome.permissions.remove = async (req) => { removed.push(req); return true; };
  importCount += 1;
  const mod = await import(`../popup/ai/ai.js?feedhosts=${importCount}`);
  mod.renderCustomJobSourcesList([]);
  document.getElementById('custom-source-name').value = 'Feed';
  document.getElementById('custom-source-url').value = 'https://jobs4tn.gov/rss';
  await mod.addCustomJobSource();
  assert.equal(env.sent.length, 1);
  assert.deepEqual(removed, []);

  // A second feed on the same host that fails to save must not revoke the first one's access.
  global.chrome.runtime.sendMessage = (msg, cb) => cb(null);
  document.getElementById('custom-source-name').value = 'Feed 2';
  document.getElementById('custom-source-url').value = 'https://jobs4tn.gov/other';
  await mod.addCustomJobSource();
  assert.deepEqual(removed, []);
});
