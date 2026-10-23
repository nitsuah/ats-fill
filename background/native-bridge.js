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

// Add, update, import, search, open-tab and fill-tab only. Nothing here can
// delete data, read other settings, or submit an application. OPEN_APPLICATION_TAB
// only opens a tab. FILL_APPLICATION_TAB runs the popup's fill on an open tab:
// it sets fields and never clicks submit. The candidate reviews and submits.
export const BRIDGE_ALLOWED_TYPES = new Set([
  'LOG_APPLICATION',
  'UPDATE_APPLICATION',
  'IMPORT_APPLICATIONS_CSV',
  'SEARCH_JOBS',
  'OPEN_APPLICATION_TAB',
  'FILL_APPLICATION_TAB',
]);

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
  // Skip quiet connected minutes so they don't touch storage. Failures always
  // write (at most every IDLE_MINUTES), so Settings shows when it last tried.
  if (status.connected && previous?.connected && !status.applied) return;
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
 * Turn the bridge on for a Settings click relayed from the popup. Asking from
 * here rather than the popup keeps Chrome's Allow prompt up if the popup
 * closes. The click only counts as a user gesture until the first await, so
 * the message router must reach this without awaiting anything first.
 * @returns {Promise<{enabled:boolean, connected?:boolean, error?:string}>}
 */
export function requestBridgeAccess() {
  return chrome.permissions.request({ permissions: ['nativeMessaging'] })
    .then((granted) => (granted ? checkInWithBridge() : { enabled: false }));
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
