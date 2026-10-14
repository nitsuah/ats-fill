/**
 * ats-fill — background/native-bridge.js
 * Lets a local AI assistant (or the ats-fill CLI) update the tracker through
 * Chrome native messaging, without remote debugging or any open port.
 *
 * Off until the user turns on "Let AI assistants update my tracker" in
 * Settings, which grants the optional nativeMessaging permission. Then, about
 * once a minute, ats-fill asks the local helper (com.nitsuah.ats_fill, set up
 * by the CLI) for queued changes and applies only the tracker changes listed
 * in BRIDGE_ALLOWED_TYPES, through the same handlers the popup uses.
 */

export const NATIVE_HOST = 'com.nitsuah.ats_fill';
export const BRIDGE_ALARM = 'ats-fill-bridge-poll';
const ACTIVE_MINUTES = 1;
// No helper installed yet: check rarely so Chrome isn't asked every minute.
const IDLE_MINUTES = 30;

// Add and update only: nothing here can delete data or read other settings.
export const BRIDGE_ALLOWED_TYPES = new Set(['LOG_APPLICATION', 'UPDATE_APPLICATION', 'IMPORT_APPLICATIONS_CSV']);

let dispatch = null;

async function bridgeEnabled() {
  try {
    return Boolean(await chrome.permissions.contains({ permissions: ['nativeMessaging'] }))
      && typeof chrome.runtime.sendNativeMessage === 'function';
  } catch {
    return false;
  }
}

async function scheduleCheckIn(minutes) {
  if (!chrome.alarms) return;
  const existing = await chrome.alarms.get(BRIDGE_ALARM);
  if (existing?.periodInMinutes === minutes) return;
  await chrome.alarms.create(BRIDGE_ALARM, { delayInMinutes: minutes, periodInMinutes: minutes });
}

async function recordStatus(status) {
  const { nativeBridgeStatus: previous } = await chrome.storage.local.get('nativeBridgeStatus');
  // Only write on a change, so a quiet minute doesn't touch storage.
  if (previous?.connected === status.connected && previous?.error === status.error && !status.applied) return;
  await chrome.storage.local.set({ nativeBridgeStatus: { ...status, at: new Date().toISOString() } });
}

/**
 * One check-in with the helper: fetch queued changes, apply the allowed ones,
 * report results back.
 * @returns {Promise<{enabled:boolean, connected?:boolean, applied?:number, error?:string}>}
 */
export async function checkInWithBridge() {
  if (!(await bridgeEnabled())) {
    if (chrome.alarms) await chrome.alarms.clear(BRIDGE_ALARM);
    return { enabled: false };
  }

  let reply;
  try {
    reply = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: 'poll', version: chrome.runtime.getManifest().version });
  } catch (err) {
    await scheduleCheckIn(IDLE_MINUTES);
    const status = { enabled: true, connected: false, error: err?.message || String(err) };
    await recordStatus(status);
    return status;
  }
  await scheduleCheckIn(ACTIVE_MINUTES);

  const ops = Array.isArray(reply?.ops) ? reply.ops : [];
  const results = [];
  for (const op of ops) {
    if (!BRIDGE_ALLOWED_TYPES.has(op?.type) || typeof dispatch !== 'function') {
      results.push({ id: op?.id, ok: false, error: `ats-fill doesn't accept "${op?.type}" from assistants.` });
      continue;
    }
    try {
      results.push({ id: op.id, ok: true, result: await dispatch({ type: op.type, payload: op.payload }) });
    } catch (err) {
      results.push({ id: op.id, ok: false, error: err?.message || String(err) });
    }
  }
  if (results.length) {
    try {
      await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: 'results', results });
    } catch { /* applied anyway; the CLI reports them as pending */ }
  }

  const status = { enabled: true, connected: true, error: '', applied: results.length };
  await recordStatus(status);
  return status;
}

/**
 * Register listeners. Call once at service-worker top level.
 * @param {(msg:{type:string,payload:any})=>Promise<any>} handleMessage The router's dispatcher.
 */
export function setupNativeBridge(handleMessage) {
  dispatch = handleMessage;
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === BRIDGE_ALARM) checkInWithBridge().catch(() => {});
  });
  chrome.permissions?.onAdded?.addListener((perms) => {
    if (perms?.permissions?.includes('nativeMessaging')) checkInWithBridge().catch(() => {});
  });
  chrome.permissions?.onRemoved?.addListener((perms) => {
    if (perms?.permissions?.includes('nativeMessaging')) chrome.alarms?.clear(BRIDGE_ALARM);
  });
  chrome.runtime.onStartup?.addListener(() => { checkInWithBridge().catch(() => {}); });
  chrome.runtime.onInstalled?.addListener(() => { checkInWithBridge().catch(() => {}); });
}
