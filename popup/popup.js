// popup.js
// Main orchestrator for popup UI — wires up all split modules and initializes

import { showScreen, isStandaloneView, initHeaderMenuToggle } from './ux/navigation.js';
import { loadMainScreen, initMainHandlers, initStatusNavHandlers, applyInitialRequestedScreen } from './ux/main.js';
import { initSetupHandlers, initTabs } from './ux/profile.js';
import { initTrackerHandlers, setLoadMainScreen } from './tracker.js';
import { initAiHandlers } from './ai/ai.js';
import { initHelpHandlers } from './ux/help.js';
import { initPreviewHandlers } from './forms/preview.js';
import { initMemoryHandlers } from './forms/memory.js';
import { initJobSearchHandlers } from './search/job-search.js';
import { initAnalyticsHandlers } from './analytics/analytics.js';
import { initInterviewPrep } from './ux/interview-prep.js';
import { applyAccessibleNames } from './ux/a11y.js';

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Mark standalone mode on body
  document.body.dataset.standalone = isStandaloneView() ? 'true' : 'false';

  // Show setup screen immediately so the popup is never blank while waiting for
  // the service worker to respond. loadMainScreen() will update it once state loads.
  showScreen('setup');

  // Wire the loadMainScreen callback into tracker handlers (avoids circular import)
  setLoadMainScreen(loadMainScreen);
  initHeaderMenuToggle();

  // Initialize all modules in the original sequence
  await initTabs();
  await initSetupHandlers();
  await loadMainScreen();
  await initMainHandlers();
  initTrackerHandlers();
  initPreviewHandlers();
  initAiHandlers();
  initHelpHandlers();
  initStatusNavHandlers();
  initMemoryHandlers();
  initJobSearchHandlers(showScreen);
  initAnalyticsHandlers();
  await initInterviewPrep();

  // Give every placeholder-only control an accessible name for screen readers.
  applyAccessibleNames(document);

  // Apply initial screen from URL params (for standalone workspace tabs)
  await applyInitialRequestedScreen();
});
