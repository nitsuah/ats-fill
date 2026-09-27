/**
 * Preview harness — routes popup messages into the real background handlers,
 * with deterministic stand-ins for the handful that would hit the network.
 */

import { setupMessageRouter } from '../../background/message-router.js';
import { DEMO_JOBS, DEMO_SEARCH_SOURCES } from '../../tests/e2e/helpers/demo-state.mjs';

const OFFLINE_STUBS = {
  SEARCH_JOBS: () => ({ success: true, jobs: DEMO_JOBS, sources: DEMO_SEARCH_SOURCES }),
};

setupMessageRouter();

const realSend = chrome.runtime.sendMessage;
chrome.runtime.sendMessage = (msg, cb) => {
  const stub = OFFLINE_STUBS[msg?.type];
  if (!stub) return realSend(msg, cb);
  const value = stub(msg.payload);
  setTimeout(() => cb?.(value), 150);
  return Promise.resolve(value);
};
