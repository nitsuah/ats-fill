/** Bind fill requests to the selected document, including embedded application frames. */
export function matchesExpectedFillDocument(msg) {
  if (typeof msg?.expectedUrl !== 'string') return true;
  let expected;
  try { expected = new URL(msg.expectedUrl); } catch { return false; }
  if (expected.protocol !== 'https:' && expected.protocol !== 'http:') return false;
  try {
    if (window.top === window) return window.location.href === expected.href;
    const referrer = new URL(document.referrer);
    // Referrer-Policy: strict-origin-when-cross-origin strips path, query, and
    // fragment from cross-origin iframe referrers. The extension sender verifies
    // the exact top-level tab URL before delivery; the iframe can independently
    // verify the parent origin, and verifies path/query when the browser exposes them.
    if (referrer.origin !== expected.origin || expected.hash) return false;
    const referrerIsOriginOnly = referrer.pathname === '/' && referrer.search === '';
    return referrerIsOriginOnly || (referrer.pathname === expected.pathname && referrer.search === expected.search);
  } catch { return false; }
}
