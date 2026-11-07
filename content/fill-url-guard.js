const ATS_FRAME_HOSTS = ['greenhouse.io', 'ashbyhq.com', 'ashby.io', 'lever.co', 'workday.com', 'myworkdayjobs.com', 'icims.com', 'jobvite.com', 'phenompeople.com'];

function frameOriginAllowed(expected) {
  const own = window.location;
  if (own.origin === expected.origin) return true;
  if (own.protocol !== 'https:') return false;
  const host = own.hostname.toLowerCase();
  return ATS_FRAME_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// Tenant of an ATS-hosted URL, as "family:tenant", or null when the host does
// not encode one in a way we can read. Callers treat null as "refuse".
export function atsFrameTenant(url) {
  // Location objects lack searchParams; normalise to a URL first.
  url = new URL(url.href);
  const host = url.hostname.toLowerCase();
  const inDomain = (domain) => host === domain || host.endsWith(`.${domain}`);
  const seg = () => (url.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
  const label = (skip) => {
    const first = host.split('.')[0];
    return skip.test(first) ? '' : first;
  };
  let family = '';
  let tenant = '';
  if (inDomain('greenhouse.io')) {
    family = 'greenhouse';
    // Read the first raw `for=`; an encoded value is refused rather than decoded.
    const rawFor = /[?&]for=([^&]*)/.exec(url.search);
    tenant = rawFor ? rawFor[1].toLowerCase() : (seg() === 'embed' ? '' : seg());
  } else if (inDomain('lever.co')) {
    family = 'lever'; tenant = seg();
  } else if (inDomain('ashbyhq.com') || inDomain('ashby.io')) {
    family = 'ashby'; tenant = seg();
  } else if (inDomain('jobvite.com')) {
    // The legacy CompanyJobs endpoint is shared by all companies; refuse it.
    family = 'jobvite'; tenant = seg() === 'companyjobs' ? '' : seg();
  } else if (inDomain('myworkdayjobs.com') || inDomain('workday.com')) {
    family = 'workday'; tenant = label(/^(www|jobs|careers|wd\d+|myworkdayjobs|workday)$/);
  } else if (inDomain('icims.com')) {
    family = 'icims'; tenant = label(/^(www|jobs|careers|icims)$/);
  } else if (inDomain('phenompeople.com')) {
    family = 'phenom'; tenant = label(/^(www|jobs|careers|phenompeople)$/);
  }
  return family && /^[a-z0-9][a-z0-9_-]*$/.test(tenant) ? `${family}:${tenant}` : null;
}

// A cross-origin frame may receive a request only if it is the iframe the top
// page actually embeds (origin + path) and belongs to the same ATS tenant.
function frameMatchesReportedIframe(own, frameSrcs) {
  if (!Array.isArray(frameSrcs) || frameSrcs.length > 100) return false;
  const ownTenant = atsFrameTenant(own);
  if (!ownTenant) return false;
  return frameSrcs.some((value) => {
    if (typeof value !== 'string') return false;
    let src;
    try { src = new URL(value); } catch { return false; }
    return src.protocol === 'https:' && src.origin === own.origin && src.pathname === own.pathname
      && atsFrameTenant(src) === ownTenant;
  });
}

/** Bind fill requests to the selected document, including embedded application frames. */
export function matchesExpectedFillDocument(msg) {
  if (typeof msg?.expectedUrl !== 'string') return false;
  let expected;
  try { expected = new URL(msg.expectedUrl); } catch { return false; }
  if (expected.protocol !== 'https:' && expected.protocol !== 'http:') return false;
  try {
    if (window.top === window) return window.location.href === expected.href;
    if (!frameOriginAllowed(expected)) return false;
    if (window.location.origin !== expected.origin && !frameMatchesReportedIframe(window.location, msg.frameSrcs)) return false;
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
