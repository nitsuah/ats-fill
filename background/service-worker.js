/**
 * apply-bot — service-worker.js
 * Thin entry point: wires up the message router. All storage/state sync and
 * message-type handlers live in ./message-router.js and ./modules/handlers/.
 */

import { setupMessageRouter } from './message-router.js';

setupMessageRouter();
