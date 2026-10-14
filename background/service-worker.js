/**
 * apply-bot — service-worker.js
 * Thin entry point: wires up the message router. All storage/state sync and
 * message-type handlers live in ./message-router.js and ./modules/handlers/.
 */

import { setupMessageRouter, handleMessage } from './message-router.js';
import { setupNativeBridge } from './native-bridge.js';

setupMessageRouter();
// Optional AI-assistant access to the tracker; inert until the user turns it on.
setupNativeBridge(handleMessage);
