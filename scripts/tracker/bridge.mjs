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

/**
 * Write Chrome's HKCU registration from Explorer's context and wait for proof.
 * Programs started by a packaged Windows app (the Claude desktop app is one)
 * can get a private copy of HKCU: a plain `reg add` from an assistant's shell
 * then succeeds but stays invisible to Chrome, which reports "Specified native
 * messaging host not found". Explorer always runs outside any package.
 * @returns {boolean} true once the write is confirmed
 */
export function registerViaExplorer(manifestPath, dir, { run = execFileSync, timeoutMs = 15_000 } = {}) {
  const script = join(dir, 'register.cmd');
  const result = join(dir, 'register.out');
  rmSync(result, { force: true });
  writeFileSync(script, `@echo off\r\nreg add "${WIN_REG_KEY}" /ve /t REG_SZ /d "${manifestPath}" /f > "${result}" 2>&1\r\n`);
  // explorer.exe returns before the script finishes (and often exits 1), so
  // the result file is the only signal.
  try { run('explorer.exe', [script], { stdio: 'ignore' }); } catch { /* checked below */ }
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let ok = false;
  for (let waited = 0; waited < timeoutMs && !ok; waited += 250) {
    Atomics.wait(pause, 0, 0, 250);
    try { ok = /success/i.test(readFileSync(result, 'utf8')); } catch { /* not written yet */ }
  }
  rmSync(script, { force: true });
  rmSync(result, { force: true });
  return ok;
}

/**
 * Make sure the helper is installed and registered. Idempotent and cheap:
 * only writes files or the registry when something changed.
 * @returns {{changed:boolean, manifestPath:string, registered:boolean}}
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

  let registered = true;
  if (process.platform === 'win32') {
    // The marker records a registration Explorer confirmed, so this runs once
    // per manifest path rather than on every command.
    const marker = join(dir, 'registered.txt');
    let previous = '';
    try { previous = readFileSync(marker, 'utf8'); } catch { /* first run */ }
    if (previous !== manifestPath) {
      registered = registerViaExplorer(manifestPath, dir);
      if (registered) writeFileSync(marker, manifestPath);
      else execFileSync('reg', ['add', WIN_REG_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'ignore' });
      changed = true;
    }
  }
  return { changed, manifestPath, registered };
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

let enqueueSeq = 0;

/**
 * Queue one change for ats-fill to apply. The helper hands changes over in
 * file-name order, so ids sort by time and then by a per-process counter:
 * two changes queued in the same millisecond still apply in the order given.
 */
export function enqueue(type, payload, env = process.env) {
  enqueueSeq = (enqueueSeq + 1) % 1_000_000;
  const id = `${String(Date.now()).padStart(15, '0')}-${String(enqueueSeq).padStart(6, '0')}-${randomUUID().slice(0, 8)}`;
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
