import { DEMO_NOW, DEMO_JOBS, DEMO_SEARCH_SOURCES, DEMO_ACTIVE_TAB } from './demo-state.mjs';

/**
 * Install the page-side fixtures used for marketing captures: freeze the clock
 * at DEMO_NOW, answer SEARCH_JOBS from DEMO_JOBS, and pretend the active tab is
 * the DEMO_ACTIVE_TAB Greenhouse page. Every other message reaches the real
 * service worker, so seeded storage drives the Pipeline, Analytics, Memory and
 * Interview Prep screens.
 */
export async function installDemoFixtures(context) {
  await context.addInitScript(({ timestamp }) => {
    const OriginalDate = Date;
    class FixedDate extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [timestamp])); }
      static now() { return timestamp; }
    }
    globalThis.Date = FixedDate;
  }, { timestamp: DEMO_NOW });

  await context.addInitScript(({ jobs, sources, activeTab }) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) return;
    const realSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, callback) => {
      if (msg?.type === 'SEARCH_JOBS') {
        const response = { success: true, jobs, sources };
        if (typeof callback === 'function') setTimeout(() => callback(response), 50);
        return Promise.resolve(response);
      }
      return realSend(msg, callback);
    };
    if (chrome.tabs) {
      const fakeTab = { id: 424242, url: activeTab.url, active: true };
      chrome.tabs.query = async () => [fakeTab];
      chrome.tabs.sendMessage = (_tabId, msg, callback) => {
        let response;
        if (msg?.type === 'DETECT_ATS') response = { ats: activeTab.ats };
        else if (msg?.type === 'GET_JOB_INFO') response = { success: true, job: activeTab.job };
        else response = { success: false, error: 'Demo fixture: no live job page.' };
        setTimeout(() => callback?.(response), 0);
      };
    }
  }, { jobs: DEMO_JOBS, sources: DEMO_SEARCH_SOURCES, activeTab: DEMO_ACTIVE_TAB });
}
