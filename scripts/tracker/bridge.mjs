/**
 * ats-fill — scripts/tracker/bridge.mjs
 * CLI side of the native messaging bridge (see native-host.mjs).
 *
 * installHost() registers the helper for the current user only (no admin):
 * a copy of native-host.mjs plus a launcher in ~/.ats-fill/native-host/, and
 * Chrome's per-user host registration (an HKCU registry value on Windows, a
 * JSON file under Chrome's NativeMessagingHosts folder elsewhere). The
 * manifest's allowed_origins names only ats-fill's extension IDs.
 *
 * Writes are queued in ~/.ats-fill/bridge/outbox; ats-fill picks them up on
 * its next check-in (about once a minute) once the user has turned on
 * "Let AI assistants update my tracker" in Settings.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { bridgeDir } from './native-host.mjs';
import { STORE_EXTENSION_ID } from './leveldb.mjs';

export const HOST_NAME = 'com.nitsuah.ats_fill';
const HEARTBEAT_FRESH_MS = 3 * 60 * 1000;
const WIN_REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;

function hostDir(env) {
  return env.ATS_FILL_HOST_DIR || join(homedir(), '.ats-fill', 'native-host');
}

function chromeHostManifestPath(env) {
  if (process.platform === 'win32') return join(hostDir(env), `${HOST_NAME}.json`);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
  return join(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
}

function writeIfChanged(path, content, mode) {
  let current = null;
  try { current = readFileSync(path, 'utf8'); } catch { /* new file */ }
  if (current === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode) chmodSync(path, mode);
  return true;
}

function windowsRegisteredPath() {
  try {
    const out = execFileSync('reg', ['query', WIN_REG_KEY, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.match(/REG_SZ\s+(.+)\s*$/m)?.[1]?.trim() || '';
  } catch {
    return '';
  }
}

/**
 * Make sure the helper is installed and registered. Idempotent and cheap:
 * only writes files or the registry when something changed.
 * @returns {{changed:boolean, manifestPath:string}}
 */
export function installHost(env = process.env) {
  const dir = hostDir(env);
  const hostSource = readFileSync(fileURLToPath(new URL('./native-host.mjs', import.meta.url)), 'utf8');
  let changed = writeIfChanged(join(dir, 'host.mjs'), hostSource);

  const node = process.execPath;
  const launcher = process.platform === 'win32'
    ? { path: join(dir, 'host.bat'), body: `@echo off\r\n"${node}" "%~dp0host.mjs" %*\r\n` }
    : { path: join(dir, 'host.sh'), body: `#!/bin/sh\nexec "${node}" "${join(dir, 'host.mjs')}" "$@"\n`, mode: 0o755 };
  changed = writeIfChanged(launcher.path, launcher.body, launcher.mode) || changed;

  const ids = [...new Set([STORE_EXTENSION_ID, env.ATS_FILL_EXTENSION_ID].filter(Boolean))];
  const manifest = {
    name: HOST_NAME,
    description: 'ats-fill tracker bridge for local AI assistants',
    path: launcher.path,
    type: 'stdio',
    allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
  };
  const manifestPath = chromeHostManifestPath(env);
  changed = writeIfChanged(manifestPath, JSON.stringify(manifest, null, 2) + '\n') || changed;

  if (process.platform === 'win32' && windowsRegisteredPath() !== manifestPath) {
    execFileSync('reg', ['add', WIN_REG_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'ignore' });
    changed = true;
  }
  return { changed, manifestPath };
}

export function uninstallHost(env = process.env) {
  if (process.platform === 'win32') {
    try { execFileSync('reg', ['delete', WIN_REG_KEY, '/f'], { stdio: 'ignore' }); } catch { /* not registered */ }
  }
  rmSync(chromeHostManifestPath(env), { force: true });
  rmSync(hostDir(env), { recursive: true, force: true });
}

/** When did ats-fill last check in with the helper? */
export function bridgeStatus(env = process.env, now = Date.now()) {
  try {
    const beat = JSON.parse(readFileSync(join(bridgeDir(env), 'heartbeat.json'), 'utf8'));
    const age = now - Date.parse(beat.at);
    return { connected: Number.isFinite(age) && age < HEARTBEAT_FRESH_MS, lastSeen: beat.at, origin: beat.origin };
  } catch {
    return { connected: false, lastSeen: null, origin: '' };
  }
}

/** Queue one change for ats-fill to apply. */
export function enqueue(type, payload, env = process.env) {
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const outbox = join(bridgeDir(env), 'outbox');
  mkdirSync(outbox, { recursive: true });
  const tmp = join(outbox, `${id}.json.tmp`);
  writeFileSync(tmp, JSON.stringify({ type, payload }));
  renameSync(tmp, join(outbox, `${id}.json`));
  return id;
}

/**
 * Wait for results of queued ids. Resolves with {done:[...], pending:[...]};
 * anything still pending is applied on a later check-in.
 */
export async function waitForResults(ids, { env = process.env, timeoutMs = 90000, intervalMs = 500 } = {}) {
  const resultsDir = join(bridgeDir(env), 'results');
  const deadline = Date.now() + timeoutMs;
  const done = new Map();
  while (done.size < ids.length && Date.now() < deadline) {
    for (const id of ids) {
      if (done.has(id)) continue;
      const path = join(resultsDir, `${id}.json`);
      if (!existsSync(path)) continue;
      try {
        done.set(id, JSON.parse(readFileSync(path, 'utf8')));
        rmSync(path, { force: true });
      } catch { /* mid-write; next pass */ }
    }
    if (done.size < ids.length) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { done: [...done.values()], pending: ids.filter((id) => !done.has(id)) };
}
