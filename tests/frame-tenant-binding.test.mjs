import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { matchesExpectedFillDocument as moduleGuard } from '../content/fill-url-guard.js';
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
