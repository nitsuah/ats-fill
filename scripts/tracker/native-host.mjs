#!/usr/bin/env node
/**
 * ats-fill — scripts/tracker/native-host.mjs
 * Chrome native messaging host for the ats-fill bridge.
 *
 * Chrome starts this for one message at a time when ats-fill (and only
 * ats-fill: see allowed_origins in the host manifest) calls
 * chrome.runtime.sendNativeMessage. It never listens on a port. Its whole
 * world is ~/.ats-fill/bridge/:
 *   outbox/<id>.json   tracker changes queued by the CLI or an AI assistant
 *   results/<id>.json  what the extension did with each one
 *   heartbeat.json     when the extension last checked in
 *
 * Messages (from the extension):
 *   {type:'poll'}                → {ops:[{id,type,payload}]}
 *   {type:'results', results:[]} → {ok:true}; writes results, clears outbox
 * The extension decides which change types it accepts; this file only moves
 * queued files.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_OPS_PER_POLL = 50;

export function bridgeDir(env = process.env) {
  return env.ATS_FILL_BRIDGE_DIR || join(homedir(), '.ats-fill', 'bridge');
}

function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

/** Handle one message from the extension; pure apart from the bridge folder. */
export function handleHostMessage(message, { dir = bridgeDir(), origin = '' } = {}) {
  const outbox = join(dir, 'outbox');
  const results = join(dir, 'results');
  mkdirSync(outbox, { recursive: true });
  mkdirSync(results, { recursive: true });

  if (message?.type === 'poll') {
    writeJsonAtomic(join(dir, 'heartbeat.json'), { at: new Date().toISOString(), origin, version: String(message.version || '') });
    const ops = [];
    for (const name of readdirSync(outbox).filter((n) => n.endsWith('.json')).sort()) {
      const id = name.slice(0, -5);
      if (!ID_PATTERN.test(id)) continue;
      try {
        const op = JSON.parse(readFileSync(join(outbox, name), 'utf8'));
        ops.push({ id, type: String(op.type || ''), payload: op.payload ?? {} });
      } catch {
        writeJsonAtomic(join(results, `${id}.json`), { id, ok: false, error: 'Unreadable request file' });
        rmSync(join(outbox, name), { force: true });
      }
      if (ops.length >= MAX_OPS_PER_POLL) break;
    }
    return { ops };
  }

  if (message?.type === 'results') {
    let written = 0;
    for (const result of Array.isArray(message.results) ? message.results : []) {
      const id = String(result?.id || '');
      if (!ID_PATTERN.test(id)) continue;
      writeJsonAtomic(join(results, `${id}.json`), { ...result, id, at: new Date().toISOString() });
      rmSync(join(outbox, `${id}.json`), { force: true });
      written += 1;
    }
    return { ok: true, written };
  }

  return { ok: false, error: `Unknown message type: ${message?.type}` };
}

/** Native messaging framing: 4-byte little-endian length, then UTF-8 JSON. */
export function encodeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function decodeFrame(buffer) {
  if (buffer.length < 4) return null;
  const length = buffer.readUInt32LE(0);
  if (buffer.length < 4 + length) return null;
  return JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    const message = decodeFrame(Buffer.concat(chunks));
    if (message === null) continue;
    let reply;
    try {
      reply = handleHostMessage(message, { origin: process.argv[2] || '' });
    } catch (err) {
      reply = { ok: false, error: err.message };
    }
    process.stdout.write(encodeFrame(reply));
    return;
  }
}

const self = process.argv[1] && existsSync(process.argv[1]) && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (self) main().catch(() => { process.exitCode = 1; });
