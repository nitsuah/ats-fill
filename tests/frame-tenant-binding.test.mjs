import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { matchesExpectedFillDocument as moduleGuard, atsFrameTenant as moduleTenant } from '../content/fill-url-guard.js';
import { findExtensionId, extensionIdFromKey, STORE_EXTENSION_ID } from '../scripts/tracker/cdp.mjs';

// Load the shipped classic content script and drive its real message listener.
const CONTENT_JS = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');
const TOP = 'https://careers.example/apply?id=1';
const GH_FRAME = 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1';

function load({ frameUrl, top = false, referrer = TOP }) {
  let listener;
  const sandbox = {
    document: { referrer, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], readyState: 'complete', documentElement: {}, body: null },
    location: new URL(frameUrl), URL, URLSearchParams, console, setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.MutationObserver = class { observe() {} disconnect() {} };
  sandbox.self = sandbox;
  sandbox.top = top ? sandbox : {};
  sandbox.chrome = { runtime: { id: 'ext-id', onMessage: { addListener(fn) { listener = fn; } }, sendMessage: () => Promise.resolve({}) } };
  vm.createContext(sandbox);
  vm.runInContext(CONTENT_JS, sandbox);
  const injected = [];
  sandbox.getFillableInputs = () => [{}];
  sandbox.loadFieldMap = async () => ({});
  sandbox.fillForm = (answers) => { injected.push(answers); return { filled: 1, unresolved: [] }; };
  return { injected, send(msg) {
    return new Promise((resolveMsg) => {
      const kept = listener(msg, { id: 'ext-id' }, resolveMsg);
      if (!kept) resolveMsg('declined');
    });
  } };
}

async function inject(frameUrl, frameSrcs) {
  const f = load({ frameUrl });
  const msg = { type: 'INJECT_ANSWERS', payload: { name: 'x' }, expectedUrl: TOP };
  if (frameSrcs !== undefined) msg.frameSrcs = frameSrcs;
  const res = await f.send(msg);
  return { res, filled: f.injected.length };
}

test('frame binding: iframe present in the page with the same tenant is accepted', async () => {
  const { res, filled } = await inject(GH_FRAME, [GH_FRAME]);
  assert.equal(res.success, true);
  assert.equal(filled, 1);
});

test('frame binding: hash and query on the frame URL do not break the match', async () => {
  const { filled } = await inject(`${GH_FRAME}#x`, ['https://job-boards.greenhouse.io/embed/job_app?for=acme']);
  assert.equal(filled, 1);
});

test('frame binding: path-tenant hosts (lever, ashby) are accepted when bound', async () => {
  for (const url of ['https://jobs.lever.co/acme/123/apply', 'https://jobs.ashbyhq.com/acme/abc/application']) {
    assert.equal((await inject(url, [url])).filled, 1, url);
  }
});

test('frame binding: subdomain-tenant hosts (workday, icims) are accepted when bound', async () => {
  for (const url of ['https://acme.wd5.myworkdayjobs.com/en-US/Careers/apply', 'https://careers-acme.icims.com/jobs/1/job']) {
    assert.equal((await inject(url, [url])).filled, 1, url);
  }
});

test('frame binding: same ATS host but a different tenant is refused', async () => {
  const other = 'https://job-boards.greenhouse.io/embed/job_app?for=other&token=1';
  const r = await inject(other, [GH_FRAME]);
  assert.equal(r.res, 'declined');
  assert.equal(r.filled, 0);
  const lever = 'https://jobs.lever.co/other/123/apply';
  assert.equal((await inject(lever, ['https://jobs.lever.co/acme/123/apply'])).res, 'declined');
});

test('frame binding: an ATS-host frame with no matching iframe in the page is refused', async () => {
  assert.equal((await inject(GH_FRAME, [])).res, 'declined');
  assert.equal((await inject(GH_FRAME)).res, 'declined', 'no list reported');
  assert.equal((await inject(GH_FRAME, ['https://jobs.lever.co/acme/1'])).res, 'declined');
  assert.equal((await inject(GH_FRAME, 'not-a-list')).res, 'declined');
});

test('frame binding: a tenant that cannot be extracted is refused', async () => {
  for (const url of ['https://job-boards.greenhouse.io/embed/job_app', 'https://jobs.lever.co/', 'https://careers.phenompeople.com/apply', 'https://wd5.myworkdayjobs.com/x']) {
    const r = await inject(url, [url]);
    assert.equal(r.res, 'declined', url);
    assert.equal(r.filled, 0);
  }
});

test('frame binding: same-origin child frame keeps working without a list', async () => {
  const { res } = await inject('https://careers.example/embedded', undefined);
  assert.equal(res.success, true);
});

test('frame binding: the module guard applies the same rules', () => {
  const frame = (href) => { globalThis.window = { top: {}, location: new URL(href) }; globalThis.document = { referrer: TOP }; };
  frame(GH_FRAME);
  assert.equal(moduleGuard({ expectedUrl: TOP, frameSrcs: [GH_FRAME] }), true);
  assert.equal(moduleGuard({ expectedUrl: TOP, frameSrcs: [] }), false);
  frame('https://job-boards.greenhouse.io/embed/job_app?for=other');
  assert.equal(moduleGuard({ expectedUrl: TOP, frameSrcs: [GH_FRAME] }), false);
});

// ── CDP target selection ────────────────────────────────────────────────────
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const BUILD = resolve('.');

function fakeCdp(ids, names = {}) {
  const targetInfos = ids.map((id) => ({ type: 'service_worker', targetId: id, url: `chrome-extension://${id}/background/service-worker.js` }));
  return {
    async send(method) {
      if (method === 'Target.getTargets') return { targetInfos };
      if (method === 'Runtime.evaluate') return { result: { value: 'ats-fill' } };
      return { sessionId: 's' };
    },
    names,
  };
}
const noKey = { manifest: {}, buildDir: BUILD };

test('cdp: picks the target by the explicit extension id', async () => {
  assert.equal(await findExtensionId(fakeCdp([A, B]), { ATS_FILL_EXTENSION_ID: B }, noKey), B);
});

test('cdp: derives the id from the manifest key', async () => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const id = extensionIdFromKey(der.toString('base64'));
  assert.match(id, /^[a-p]{32}$/);
  assert.equal(await findExtensionId(fakeCdp([A]), {}, { manifest: { key: der.toString('base64') }, buildDir: BUILD }), id);
});

test('cdp: a name-only match is refused', async () => {
  // The target reports the extension name; it is not tied to this build.
  await assert.rejects(findExtensionId(fakeCdp([A]), {}, { ...noKey, unpackedPathFor: () => null }), /Could not identify/);
  await assert.rejects(findExtensionId(fakeCdp([A]), {}, { ...noKey, unpackedPathFor: () => '/somewhere/else' }), /Could not identify/);
});

test('cdp: two targets sharing a name are refused', async () => {
  await assert.rejects(findExtensionId(fakeCdp([A, B]), {}, { ...noKey, unpackedPathFor: () => null }), /Could not identify/);
});

test('cdp: an unpacked install is accepted only when its path is this build', async () => {
  const paths = { [A]: BUILD, [B]: '/somewhere/else' };
  assert.equal(await findExtensionId(fakeCdp([A, B]), {}, { ...noKey, unpackedPathFor: (id) => paths[id] }), A);
  const both = { [A]: BUILD, [B]: BUILD };
  await assert.rejects(findExtensionId(fakeCdp([A, B]), {}, { ...noKey, unpackedPathFor: (id) => both[id] }), /Could not identify/);
});

test('cdp: the published store id is accepted by id', async () => {
  assert.equal(await findExtensionId(fakeCdp([STORE_EXTENSION_ID, A]), {}, { ...noKey, unpackedPathFor: () => null }), STORE_EXTENSION_ID);
});

// ── Host, encoding and port edge cases ──────────────────────────────────────
test('frame binding: lookalike hosts are refused even when listed', async () => {
  for (const url of ['https://greenhouse.io.evil.com/embed/job_app?for=acme', 'https://evilgreenhouse.io/embed/job_app?for=acme']) {
    const r = await inject(url, [url]);
    assert.equal(r.res, 'declined', url);
    assert.equal(r.filled, 0);
  }
});

test('frame binding: a duplicated for= uses the first value', async () => {
  const first = 'https://job-boards.greenhouse.io/embed/job_app?for=acme&for=other';
  assert.equal((await inject(first, ['https://job-boards.greenhouse.io/embed/job_app?for=acme'])).filled, 1);
  assert.equal((await inject(first, ['https://job-boards.greenhouse.io/embed/job_app?for=other&for=acme'])).res, 'declined');
});

test('frame binding: percent-encoded tenants and paths are refused', async () => {
  for (const url of [
    'https://job-boards.greenhouse.io/embed/job_app?for=ac%6De',
    'https://jobs.lever.co/ac%6De/123',
    'https://jobs.lever.co/acme%2F..%2Fother/123',
  ]) {
    const r = await inject(url, [url]);
    assert.equal(r.res, 'declined', url);
    assert.equal(r.filled, 0);
  }
});

test('frame binding: a port mismatch is refused', async () => {
  const withPort = 'https://job-boards.greenhouse.io:8443/embed/job_app?for=acme';
  assert.equal((await inject(withPort, [GH_FRAME])).res, 'declined');
  assert.equal((await inject(GH_FRAME, [withPort])).res, 'declined');
});

// ── Parity of the two atsFrameTenant copies ─────────────────────────────────
function contentTenant() {
  const sandbox = {
    document: { referrer: '', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], readyState: 'complete', documentElement: {}, body: null },
    location: new URL(TOP), URL, URLSearchParams, console, setTimeout, clearTimeout,
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.top = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.MutationObserver = class { observe() {} disconnect() {} };
  sandbox.chrome = { runtime: { id: 'ext-id', onMessage: { addListener() {} }, sendMessage: () => Promise.resolve({}) } };
  vm.createContext(sandbox);
  vm.runInContext(`${CONTENT_JS}
;globalThis.__tenant = atsFrameTenant;`, sandbox);
  return sandbox.__tenant;
}

const TENANT_CASES = [
  'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1',
  'https://job-boards.greenhouse.io/embed/job_app?for=acme&for=other',
  'https://job-boards.greenhouse.io/embed/job_app',
  'https://boards.greenhouse.io/acme/jobs/1',
  'https://boards.greenhouse.io/embed/job_app?for=ac%6De',
  'https://jobs.lever.co/acme/1', 'https://jobs.lever.co/', 'https://jobs.eu.lever.co/Acme/1',
  'https://jobs.ashbyhq.com/acme/1', 'https://jobs.ashby.io/acme',
  'https://jobs.jobvite.com/acme/job/1', 'https://app.jobvite.com/CompanyJobs/Careers.aspx?c=acme', 'https://app.jobvite.com/companyjobs/careers.aspx?c=other',
  'https://acme.wd5.myworkdayjobs.com/en-US/Careers', 'https://wd5.myworkdayjobs.com/x', 'https://acme.workday.com/x', 'https://www.workday.com/x',
  'https://careers-acme.icims.com/jobs/1', 'https://jobs.icims.com/x',
  'https://acme.phenompeople.com/apply', 'https://careers.phenompeople.com/apply',
  'https://greenhouse.io.evil.com/acme', 'https://evilgreenhouse.io/acme', 'https://other.example/acme',
  'https://jobs.lever.co/ac%6De/1', 'https://jobs.lever.co:8443/acme/1',
];

test('frame binding: both atsFrameTenant copies agree on every case', () => {
  const shipped = contentTenant();
  for (const url of TENANT_CASES) {
    assert.equal(shipped(new URL(url)), moduleTenant(new URL(url)), url);
  }
  assert.equal(shipped(new URL(TENANT_CASES[0])), 'greenhouse:acme');
  assert.equal(shipped(new URL('https://jobs.lever.co/ac%6De/1')), null);
});

// ── Extension id known-answer vector (computed independently with openssl) ──
test('cdp: extensionIdFromKey matches an openssl-computed vector', () => {
  const key = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAucscRd3S1f6seuVkT53NCaGWRJ0w8kwDLBE2xVfs/VKYmOt623QhuUurR3dmmSypWVLyD4yC6FgI7mRWhoZnS2sixI3iRexTX+Es0rIz2qXdzwh4bTCmVZRomlzwj6td1nrT1itryCST8WFMkyCgf9f4BRbc2pYfCjcMfZuU2RgZmazwiay4dblC6rsRP1hEdwYuF92qyvnaALsgFeb45loCers8B4djlkjji5hpqlB61grt3mxl+yyV1TIMFGX2WVjaNSCOTRIyQZ7frtXwlBK5eKYPYLi4jNpI/Wicip8tJ17e2YFy1DAbZu4p+5whSJ5ai+FUDrR0t2ykmcnjRwIDAQAB';
  assert.equal(extensionIdFromKey(key), 'ijmbnoeallibmnffggiimloehbhinncl');
});

test('cdp: a recorded path in any profile that matches this build is accepted', async () => {
  const paths = { [A]: ['/elsewhere', BUILD], [B]: ['/elsewhere'] };
  assert.equal(await findExtensionId(fakeCdp([A, B]), {}, { ...noKey, unpackedPathFor: (id) => paths[id] }), A);
  const none = { [A]: ['/elsewhere', '/other'] };
  await assert.rejects(findExtensionId(fakeCdp([A]), {}, { ...noKey, unpackedPathFor: (id) => none[id] }), /Could not identify/);
});

// ── Sender: iframe list collection and delivery ─────────────────────────────
const GH_SRC = 'https://job-boards.greenhouse.io/embed/job_app?for=acme';

async function withSender({ iframes, afterFirst, lazy = false }, run) {
  const prior = { chrome: globalThis.chrome, window: globalThis.window, document: globalThis.document };
  let current = iframes;
  const sent = [];
  let injected = 0;
  const page = (list) => {
    const top = {};
    globalThis.window = top; top.top = top; top.location = { href: TOP };
    globalThis.document = { querySelectorAll: () => list.map((src) => ({ src })) };
  };
  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: {
      async query() { return [{ id: 7, url: TOP }]; },
      async get() { return { url: TOP }; },
      sendMessage(_tab, message, options, cb) {
        sent.push({ message, documentId: options.documentId });
        // The page changes right after the first delivery to the child frame.
        if (afterFirst && options.documentId === 'child-doc') current = afterFirst;
        if (lazy && options.documentId === 'child-doc' && injected === 0) {
          globalThis.chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          cb();
          globalThis.chrome.runtime.lastError = null;
          return;
        }
        // The top frame declines (no reply); only the child frame answers.
        if (options.documentId === 'top-doc') { cb(); return; }
        cb({ success: true, filled: 1 });
      },
    },
    scripting: {
      async executeScript(opts) {
        if (opts.files) { injected += 1; return []; }
        page(current);
        const result = opts.func();
        if (opts.target.allFrames) {
          return [{ frameId: 0, documentId: 'top-doc', result }, { frameId: 3, documentId: 'child-doc', result: { href: GH_SRC, iframeSrcs: [] } }];
        }
        return [{ frameId: 0, documentId: 'top-doc', result }];
      },
    },
  };
  try {
    const { sendToActiveTab } = await import('../lib/utils.js');
    await run(sendToActiveTab, sent);
  } finally {
    for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

test('sender: the top frame ATS iframe list reaches the child frame', async () => {
  await withSender({ iframes: [GH_SRC, 'https://ads.example/x'] }, async (send, sent) => {
    const res = await send({ type: 'INJECT_ANSWERS', payload: { a: 1 } });
    assert.equal(res.success, true);
    const toChild = sent.find((s) => s.documentId === 'child-doc');
    assert.deepEqual(toChild.message.frameSrcs, [GH_SRC], 'only the ATS iframe is carried');
    assert.equal(toChild.message.expectedUrl, TOP);
  });
});

test('sender: the list survives the lazy-injection retry', async () => {
  await withSender({ iframes: [GH_SRC], lazy: true }, async (send, sent) => {
    await send({ type: 'INJECT_ANSWERS', payload: { a: 1 } });
    const toChild = sent.filter((s) => s.documentId === 'child-doc');
    assert.equal(toChild.length, 2);
    assert.ok(toChild.every((s) => JSON.stringify(s.message.frameSrcs) === JSON.stringify([GH_SRC])));
  });
});

test('sender: an ATS iframe is kept after many unrelated iframes', async () => {
  const noise = Array.from({ length: 150 }, (_, i) => `https://ads${i}.example/x`);
  await withSender({ iframes: [...noise, GH_SRC] }, async (send, sent) => {
    await send({ type: 'INJECT_ANSWERS', payload: { a: 1 } });
    assert.deepEqual(sent.find((s) => s.documentId === 'child-doc').message.frameSrcs, [GH_SRC]);
  });
});

test('sender: the list is re-read before each delivery', async () => {
  await withSender({ iframes: [GH_SRC], lazy: true, afterFirst: [] }, async (send, sent) => {
    await send({ type: 'INJECT_ANSWERS', payload: { a: 1 } });
    const toChild = sent.filter((s) => s.documentId === 'child-doc');
    assert.deepEqual(toChild[0].message.frameSrcs, [GH_SRC]);
    assert.deepEqual(toChild[1].message.frameSrcs, [], 'a removed iframe no longer authorises the frame');
  });
});

test('frame binding: the shared legacy Jobvite endpoint is refused', async () => {
  const url = 'https://app.jobvite.com/CompanyJobs/Careers.aspx?c=acme';
  assert.equal((await inject(url, [url])).res, 'declined');
  assert.equal(moduleTenant(new URL(url)), null);
  assert.equal((await inject('https://jobs.jobvite.com/acme/job/1', ['https://jobs.jobvite.com/acme/job/1'])).filled, 1);
});

test('cdp: relative recorded paths are never matched against the working directory', async () => {
  await assert.rejects(findExtensionId(fakeCdp([A]), {}, { ...noKey, unpackedPathFor: () => ['.'] }), /Could not identify/);
});
