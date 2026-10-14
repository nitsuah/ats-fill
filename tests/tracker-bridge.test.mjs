import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';

import { handleHostMessage, encodeFrame, decodeFrame } from '../scripts/tracker/native-host.mjs';
import { enqueue, waitForResults, bridgeStatus } from '../scripts/tracker/bridge.mjs';
import { checkInWithBridge, setupNativeBridge, BRIDGE_ALLOWED_TYPES, BRIDGE_ALARM } from '../background/native-bridge.js';

const HOST = fileURLToPath(new URL('../scripts/tracker/native-host.mjs', import.meta.url));
const tempDir = () => mkdtempSync(join(tmpdir(), 'ats-fill-bridge-'));

test('frames round-trip in native messaging format', () => {
  const frame = encodeFrame({ type: 'poll', n: 'é' });
  assert.equal(frame.readUInt32LE(0), frame.length - 4);
  assert.deepEqual(decodeFrame(frame), { type: 'poll', n: 'é' });
  assert.equal(decodeFrame(frame.subarray(0, 6)), null);
});

test('host hands queued changes over in order and records a heartbeat', () => {
  const dir = tempDir();
  const env = { ATS_FILL_BRIDGE_DIR: dir };
  const a = enqueue('UPDATE_APPLICATION', { id: 'x', patch: { status: 'interview' } }, env);
  const b = enqueue('LOG_APPLICATION', { company: 'Contoso' }, env);
  writeFileSync(join(dir, 'outbox', 'not.an.id.json'), '{}'); // not a valid id: never handed over
  writeFileSync(join(dir, 'outbox', 'zz-broken.json'), '{not json');

  const reply = handleHostMessage({ type: 'poll', version: '1.0.2' }, { dir, origin: 'chrome-extension://abc/' });
  assert.deepEqual(reply.ops.map((op) => op.id), [a, b]);
  assert.equal(reply.ops.find((op) => op.id === a).type, 'UPDATE_APPLICATION');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'results', 'zz-broken.json'), 'utf8')).ok, false);

  const beat = JSON.parse(readFileSync(join(dir, 'heartbeat.json'), 'utf8'));
  assert.equal(beat.origin, 'chrome-extension://abc/');
  assert.equal(bridgeStatus(env).connected, true);
  assert.equal(bridgeStatus(env, Date.now() + 10 * 60 * 1000).connected, false);
});

test('host stores results, clears the outbox, and the CLI collects them', async () => {
  const dir = tempDir();
  const env = { ATS_FILL_BRIDGE_DIR: dir };
  const id = enqueue('LOG_APPLICATION', { company: 'Contoso' }, env);
  const waiting = waitForResults([id, 'never-1'], { env, timeoutMs: 1500, intervalMs: 20 });
  handleHostMessage({ type: 'results', results: [{ id, ok: true, result: { success: true } }, { id: '../bad', ok: true }] }, { dir });
  const { done, pending } = await waiting;
  assert.deepEqual(done.map((r) => [r.id, r.ok]), [[id, true]]);
  assert.deepEqual(pending, ['never-1']);
  assert.equal(existsSync(join(dir, 'outbox', `${id}.json`)), false);
  assert.deepEqual(readdirSync(join(dir, 'results')), []);
});

test('the host process speaks the native messaging protocol over stdio', async () => {
  const dir = tempDir();
  mkdirSync(join(dir, 'outbox'), { recursive: true });
  enqueue('UPDATE_APPLICATION', { id: 'x' }, { ATS_FILL_BRIDGE_DIR: dir });
  const child = spawn(process.execPath, [HOST, 'chrome-extension://abc/'], { env: { ...process.env, ATS_FILL_BRIDGE_DIR: dir } });
  const out = [];
  child.stdout.on('data', (d) => out.push(d));
  child.stdin.end(encodeFrame({ type: 'poll' }));
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  const reply = decodeFrame(Buffer.concat(out));
  assert.equal(reply.ops.length, 1);
  assert.equal(reply.ops[0].type, 'UPDATE_APPLICATION');
});

function installChromeMock({ granted = true, hostReply, hostError } = {}) {
  const calls = { native: [], alarms: [], listeners: {} };
  const storage = {};
  globalThis.chrome = {
    permissions: {
      contains: async () => granted,
      onAdded: { addListener: (fn) => { calls.listeners.added = fn; } },
      onRemoved: { addListener: (fn) => { calls.listeners.removed = fn; } },
    },
    runtime: {
      getManifest: () => ({ version: '1.0.2' }),
      sendNativeMessage: async (host, msg) => {
        calls.native.push({ host, msg });
        if (hostError) throw new Error(hostError);
        return msg.type === 'poll' ? hostReply : { ok: true };
      },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} },
    },
    alarms: {
      get: async () => undefined,
      create: async (name, info) => { calls.alarms.push({ name, ...info }); },
      clear: async (name) => { calls.alarms.push({ name, cleared: true }); },
      onAlarm: { addListener: (fn) => { calls.listeners.alarm = fn; } },
    },
    storage: { local: { get: async (k) => ({ [k]: storage[k] }), set: async (v) => Object.assign(storage, v) } },
  };
  return { calls, storage };
}

test('extension bridge stays off without the optional permission', async () => {
  const { calls } = installChromeMock({ granted: false });
  setupNativeBridge(async () => ({}));
  assert.deepEqual(await checkInWithBridge(), { enabled: false });
  assert.equal(calls.native.length, 0);
  assert.deepEqual(calls.alarms, [{ name: BRIDGE_ALARM, cleared: true }]);
});

test('extension bridge applies only allowed tracker changes and reports back', async () => {
  const dispatched = [];
  const { calls, storage } = installChromeMock({
    hostReply: { ops: [
      { id: '1', type: 'UPDATE_APPLICATION', payload: { id: 'a', patch: { status: 'interview' } } },
      { id: '2', type: 'RESET_ALL_DATA', payload: {} },
      { id: '3', type: 'LOG_APPLICATION', payload: { company: 'Contoso' } },
    ] },
  });
  setupNativeBridge(async (msg) => {
    dispatched.push(msg.type);
    if (msg.payload.company === 'Contoso') throw new Error('boom');
    return { success: true };
  });

  const status = await checkInWithBridge();
  assert.deepEqual(dispatched, ['UPDATE_APPLICATION', 'LOG_APPLICATION']);
  assert.equal(BRIDGE_ALLOWED_TYPES.has('RESET_ALL_DATA'), false);
  const report = calls.native.find((c) => c.msg.type === 'results').msg.results;
  assert.deepEqual(report.map((r) => [r.id, r.ok]), [['1', true], ['2', false], ['3', false]]);
  assert.match(report[1].error, /doesn't accept "RESET_ALL_DATA"/);
  assert.equal(report[2].error, 'boom');
  assert.equal(calls.native[0].host, 'com.nitsuah.ats_fill');
  assert.deepEqual(calls.alarms[0], { name: BRIDGE_ALARM, delayInMinutes: 1, periodInMinutes: 1 });
  assert.equal(status.connected, true);
  assert.equal(storage.nativeBridgeStatus.connected, true);
});

test('extension bridge backs off when the helper is not installed', async () => {
  const { calls, storage } = installChromeMock({ hostError: 'Specified native messaging host not found.' });
  setupNativeBridge(async () => ({}));
  const status = await checkInWithBridge();
  assert.equal(status.connected, false);
  assert.match(status.error, /not found/);
  assert.equal(calls.alarms[0].periodInMinutes, 30);
  assert.equal(storage.nativeBridgeStatus.connected, false);
});

test('changes queued in the same millisecond keep their order', () => {
  const dir = tempDir();
  const env = { ATS_FILL_BRIDGE_DIR: dir };
  const ids = Array.from({ length: 50 }, (_, i) => enqueue('UPDATE_APPLICATION', { n: i }, env));
  const reply = handleHostMessage({ type: 'poll' }, { dir });
  assert.deepEqual(reply.ops.map((op) => op.id), ids);
  assert.deepEqual(reply.ops.map((op) => op.payload.n), ids.map((_, i) => i));
});
