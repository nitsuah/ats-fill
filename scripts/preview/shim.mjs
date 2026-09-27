/**
 * Preview harness — chrome.* shim.
 *
 * Installs just enough of the extension APIs for popup/popup.html to run as a
 * plain web page: in-memory chrome.storage.local seeded with the fictional demo
 * state, a fake active tab that looks like a Greenhouse job page, and a
 * runtime.onMessage registry that ./router.mjs wires to the real background
 * handlers. Loaded before popup.js by scripts/preview/server.mjs.
 *
 * Query params: ?empty=1 starts from blank storage (first-run / setup gate).
 */

import { DEMO_STATE, DEMO_ACTIVE_TAB } from '../../tests/e2e/helpers/demo-state.mjs';

const params = new URLSearchParams(location.search);
const store = new Map(Object.entries(params.get('empty') === '1' ? {} : structuredClone(DEMO_STATE)));
const listeners = [];
const EXTENSION_ID = 'previewharnessatsfill';

function pick(keys) {
  if (keys == null) return Object.fromEntries(store);
  if (typeof keys === 'string') keys = [keys];
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, structuredClone(store.get(k))]));
  }
  return Object.fromEntries(Object.entries(keys).map(([k, dflt]) => [k, store.has(k) ? structuredClone(store.get(k)) : dflt]));
}

function settle(value, cb) {
  if (typeof cb === 'function') setTimeout(() => cb(value), 0);
  return Promise.resolve(value);
}

const tab = { id: 1, url: DEMO_ACTIVE_TAB.url, active: true };

globalThis.chrome = {
  runtime: {
    id: EXTENSION_ID,
    lastError: null,
    getURL: (p) => new URL(`/${p}`, location.origin).href,
    onMessage: {
      addListener: (fn) => listeners.push(fn),
      removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
    },
    sendMessage(msg, cb) {
      return new Promise((resolve) => {
        const respond = (value) => { resolve(value); if (typeof cb === 'function') cb(value); };
        const fn = listeners[0];
        if (!fn) return respond(undefined);
        fn(msg, { id: EXTENSION_ID }, respond);
      });
    },
  },
  storage: {
    local: {
      get: (keys, cb) => settle(pick(keys), cb),
      set: (items, cb) => { for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v)); return settle(undefined, cb); },
      remove: (keys, cb) => { for (const k of [].concat(keys)) store.delete(k); return settle(undefined, cb); },
      clear: (cb) => { store.clear(); return settle(undefined, cb); },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  tabs: {
    query: async () => [tab],
    create: async ({ url }) => { location.href = url; },
    update: async () => tab,
    sendMessage(_tabId, msg, cb) {
      let resp;
      if (msg?.type === 'DETECT_ATS') resp = { ats: DEMO_ACTIVE_TAB.ats };
      else if (msg?.type === 'GET_JOB_INFO') resp = { success: true, job: DEMO_ACTIVE_TAB.job };
      else resp = { success: false, error: 'Preview harness: no live job page.' };
      setTimeout(() => cb?.(resp), 0);
    },
  },
  windows: { update: async () => ({}) },
  scripting: { executeScript: async () => [] },
  permissions: { contains: async () => true, request: async () => true },
  identity: {
    getRedirectURL: () => `https://${EXTENSION_ID}.chromiumapp.org/`,
    launchWebAuthFlow: (_opts, cb) => cb?.(undefined),
  },
};
