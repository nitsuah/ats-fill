// navigation.js
// Handles navigation, screen switching, and section scrolling

import { $, sendToActiveTab, getReviewItemLabel } from '../../lib/utils.js';
import { setStatus } from './state.js';

// Mapping from screen name to its header nav button id
const NAV_BTN_MAP = {
  'job-search': 'header-job-search-btn',
  tracker: 'header-tracker-btn',
  analytics: 'header-analytics-btn',
  ai: 'header-ai-btn',
  setup: 'header-profile-btn',
  help: 'header-help-btn',
  'interview-prep': 'header-interview-prep-btn',
};

// Show a named screen and hide others
export function showScreen(name) {
  for (const el of document.querySelectorAll('.screen')) {
    el.classList.add('hidden');
  }
  const target = document.getElementById(name + '-screen');
  if (target) target.classList.remove('hidden');
  document.body.dataset.screen = name;

  const label = $('header-screen-label');
  if (label) {
    const labels = {
      setup: '• Profile',
      tracker: '• Pipeline',
      analytics: '• Analytics',
      ai: '• Settings',
      help: '• Help',
      preview: '• Preview',
      'job-search': '• Job Search',
      'interview-prep': '• Interview Prep',
      main: '',
    };
    label.textContent = labels[name] || '';
  }

  // Show/hide the global back button (hidden on the home/main screen)
  const backBtn = document.getElementById('global-back-btn');
  if (backBtn) {
    backBtn.classList.toggle('hidden', name === 'main' || isStandaloneView());
  }

  // Update active tab indicator on header nav buttons
  for (const [screen, btnId] of Object.entries(NAV_BTN_MAP)) {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.toggle('active-tab', screen === name);
  }
}

// ── Narrow-width nav (hamburger) ────────────────────────────────────────────
// Below the narrow breakpoint (see popup.css), secondary nav buttons (Analytics,
// Settings, Profile, Help) move into a dropdown behind a hamburger toggle so
// the 3 primary buttons (Search, Pipeline, Interview Prep) stay visible. This
// only toggles a CSS class — every button keeps its existing id/handlers.
export function initHeaderMenuToggle() {
  const toggle = document.getElementById('header-menu-toggle');
  const menu = document.getElementById('header-secondary-nav');
  if (!toggle || !menu) return;

  const closeMenu = () => {
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = !menu.classList.contains('is-open');
    menu.classList.toggle('is-open', willOpen);
    toggle.setAttribute('aria-expanded', String(willOpen));
  });

  // Selecting any nav item, clicking away, or Escape closes the dropdown.
  menu.addEventListener('click', (event) => {
    if (event.target.closest('button')) closeMenu();
  });
  document.addEventListener('click', (event) => {
    if (!menu.classList.contains('is-open')) return;
    if (event.target.closest('#header-secondary-nav') || event.target.closest('#header-menu-toggle')) return;
    closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.classList.contains('is-open')) closeMenu();
  });
}

export function scrollToSection(sectionId) {
  if (!sectionId) return;
  requestAnimationFrame(() => {
    $(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

export function bindReviewJumpHandlers(listId, statusId = 'fill-status') {
  const list = $(listId);
  if (!list || list.dataset.jumpBound === 'true') return;
  list.dataset.jumpBound = 'true';

  list.addEventListener('click', async (event) => {
    const btn = event.target.closest('.review-jump-btn');
    if (!btn) return;

    let payload = { label: btn.textContent.trim() };
    try {
      payload = JSON.parse(decodeURIComponent(btn.dataset.payload || ''));
    } catch {
      // fallback to label only
    }

    try {
      const resp = await sendToActiveTab({ type: 'FOCUS_FIELD', payload });
      if (!resp?.success) throw new Error(resp?.error || 'Could not find that field on the page.');
      setStatus(statusId, `✅ Jumped to "${resp.label || getReviewItemLabel(payload)}" on the page.`, 'success');
      window.close();
    } catch (err) {
      setStatus(statusId, '❌ ' + err.message, 'error');
    }
  });
}

// Standalone / expanded workspace helpers
export function isStandaloneView() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('standalone') === '1';
}

export function canOpenExpandedWorkspace() {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id && typeof window !== 'undefined' && window.location.protocol !== 'file:';
}

export function buildExpandedWorkspaceUrl(screen, sectionId = '') {
  const url = new URL(chrome.runtime.getURL('popup/popup.html'));
  url.searchParams.set('screen', screen);
  url.searchParams.set('standalone', '1');
  if (sectionId) {
    url.searchParams.set('section', sectionId);
  }
  return url.toString();
}

export async function openExpandedWorkspace(screen, sectionId = '') {
  if (!canOpenExpandedWorkspace()) return false;
  try {
    const url = buildExpandedWorkspaceUrl(screen, sectionId);
    const baseUrl = chrome.runtime.getURL('popup/popup.html');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => {
      if (!tab?.id || !tab.url || !tab.url.startsWith(baseUrl)) return false;
      try {
        const tabUrl = new URL(tab.url);
        return tabUrl.searchParams.get('screen') === screen;
      } catch {
        return false;
      }
    });

    if (existing?.id) {
      await chrome.tabs.update(existing.id, { active: true, url });
      if (typeof existing.windowId === 'number') {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
    } else {
      await chrome.tabs.create({ url, active: true });
    }

    if (typeof window !== 'undefined') window.close();
    return true;
  } catch {
    return false;
  }
}
