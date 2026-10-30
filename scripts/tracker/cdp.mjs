/**
 * ats-fill — scripts/tracker/cdp.mjs
 * Minimal Chrome DevTools Protocol bridge to a running ats-fill install.
 *
 * The tracker lives in the extension's chrome.storage.local, so the only way
 * in from outside is through Chrome itself. This opens the extension's own
 * popup page in a background tab and calls chrome.runtime.sendMessage there,
 * which goes through the same message router (and sender check) the popup
 * uses. Nothing is read or written that the popup couldn't do.
 *
 * Needs Chrome's remote debugging on (chrome://inspect/#remote-debugging), or
 * a Chrome started with --remote-debugging-port. No npm dependencies: Node 22+
 * ships a global WebSocket.
 */
import process from 'node:process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const STORE_EXTENSION_ID = 'amofaeopfmaicbiijgjaojenedkkadmn';

const SENSITIVE_FIELDS = new Set([
  'secretfield',
  'apikey',
  'apisecret',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
  'token',
  'privatekey',
]);

function normalizeKey(k) {
  return k.replace(/\u200B|\u200C|\u200D|\uFEFF/g, '').toLowerCase();
}

function redactSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(normalizeKey(k))) continue;
    out[k] = redactSecrets(v);
  }
  return out;
}

function userDataDirs() {
  const home = homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return [join(local, 'Google', 'Chrome', 'User Data'), join(local, 'Google', 'Chrome Beta', 'User Data'), join(local, 'Chromium', 'User Data')];
  }
  if (process.platform === 'darwin') {
    const base = join(home, 'Library', 'Application Support');
    return [join(base, 'Google', 'Chrome'), join(base, 'Google', 'Chrome Beta'), join(base, 'Chromium')];
  }
  return [join(home, '.config', 'google-chrome'), join(home, '.config', 'google-chrome-beta'), join(home, '.config', 'chromium')];
}

/** Resolve the browser-level DevTools WebSocket URL. */
export function resolveBrowserWsUrl(env = process.env) {
  if (env.ATS_FILL_CDP_URL) return env.ATS_FILL_CDP_URL;
  const dirs = env.CHROME_USER_DATA_DIR ? [env.CHROME_USER_DATA_DIR] : userDataDirs();
  for (const dir of dirs) {
    const file = join(dir, 'DevToolsActivePort');
    if (!existsSync(file)) continue;
    const [port, path] = readFileSync(file, 'utf8').split(/\r?\n/);
    if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
  }
  throw new Error(
    'Chrome remote debugging is off. Open chrome://inspect/#remote-debugging and turn it on '
    + '(or set ATS_FILL_CDP_URL / CHROME_USER_DATA_DIR), then retry.',
  );
}

class CdpConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    });
    // Once the socket is gone no reply can arrive, so fail every in-flight
    // request instead of letting `send` promises hang the CLI.
    const onGone = (reason) => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error(reason));
      this.pending.clear();
    };
    ws.addEventListener('close', () => onGone('Chrome closed the DevTools connection'));
    ws.addEventListener('error', () => onGone('DevTools connection to Chrome failed'));
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Chrome closed the DevTools connection'));
        return;
      }
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    this.ws.close();
  }
}

export async function connect(url = resolveBrowserWsUrl(), timeoutMs = 30000) {
  const ws = new globalThis.WebSocket(url);
  await new Promise((resolve, reject) => {
    // Chrome's chrome://inspect toggle asks the user to allow each new client,
    // so the open can sit waiting on that prompt.
    const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome. Approve the "Allow remote debugging?" prompt if Chrome shows one.')), timeoutMs);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`Could not connect to Chrome at ${url}. Is remote debugging still on?`)); }, { once: true });
  });
  return new CdpConnection(ws);
}

/** Find the ats-fill extension ID from a live service worker, else fall back. */
export async function findExtensionId(cdp, env = process.env) {
  if (env.ATS_FILL_EXTENSION_ID) return env.ATS_FILL_EXTENSION_ID;
  const { targetInfos } = await cdp.send('Target.getTargets');
  const ids = [...new Set(targetInfos
    .filter((t) => t.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\/background\/service-worker\.js$/.test(t.url))
    .map((t) => t.url.slice('chrome-extension://'.length, 'chrome-extension://'.length + 32)))];
  if (ids.includes(STORE_EXTENSION_ID)) return STORE_EXTENSION_ID;
  // An unpacked dev build has its own ID; the path match is specific enough
  // when it is the only candidate.
  if (ids.length === 1) return ids[0];
  return STORE_EXTENSION_ID;
}

/**
 * Open an extension page, run `fn` inside it, close it.
 * @param {(ctx:{evaluate:(expr:string)=>Promise<any>})=>Promise<any>} fn
 */
export async function withExtensionPage(fn, { env = process.env } = {}) {
  const cdp = await connect(resolveBrowserWsUrl(env));
  let targetId;
  try {
    const extensionId = await findExtensionId(cdp, env);
    ({ targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/popup/popup.html`, background: true }));
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
      return result.value;
    };

    for (let i = 0; i < 50; i += 1) {
      const ready = await evaluate(`location.protocol === 'chrome-extension:' && typeof chrome?.runtime?.sendMessage === 'function'`).catch(() => false);
      if (ready) break;
      if (i === 49) throw new Error(`ats-fill isn't reachable at chrome-extension://${extensionId}. Is it installed and enabled? Set ATS_FILL_EXTENSION_ID for an unpacked build.`);
      await new Promise((r) => setTimeout(r, 100));
    }
    return await fn({ evaluate, extensionId });
  } finally {
    if (targetId) await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    cdp.close();
  }
}

/** Send one message through the extension's router and unwrap the result. */
export async function sendMessage(evaluate, type, payload) {
  const redactedPayload = redactSecrets(payload);
  const msg = JSON.stringify({ type, payload: redactedPayload });
  const res = await evaluate(`chrome.runtime.sendMessage(${msg})`);
  if (res && res.success === false) throw new Error(res.error || 'ats-fill rejected the request');
  return redactSecrets(res);
}

/** Read the tracker straight from storage (read-only; writes go through the router). */
export async function readApplications(evaluate) {
  const apps = await evaluate(`chrome.storage.local.get('applications').then((d) => d.applications || [])`);
  return redactSecrets(apps);
}
