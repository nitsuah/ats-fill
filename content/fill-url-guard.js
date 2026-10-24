/** Bind fill requests to the selected document, including embedded application frames. */
export function matchesExpectedFillDocument(msg) {
  if (typeof msg?.expectedUrl !== 'string') return true;
  let expected;
  try { expected = new URL(msg.expectedUrl); } catch { return false; }
  if (expected.protocol !== 'https:' && expected.protocol !== 'http:') return false;
  try {
    if (window.top === window) return window.location.href === expected.href;
    const referrer = new URL(document.referrer);
    // Referrers omit fragments, so an embedded frame cannot prove a hash-bearing top-level URL.
    return !expected.hash && referrer.origin === expected.origin && referrer.pathname === expected.pathname && referrer.search === expected.search;
  } catch { return false; }
}
