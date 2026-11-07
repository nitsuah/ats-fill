// Classification of custom job-feed URLs.
//
// A browser extension cannot resolve DNS, so this works on the URL text only:
// IP literals (as normalised by `new URL()`), `localhost`, single-label names
// and a list of suffixes that are conventionally local. A public-looking name
// that resolves to a local address cannot be told apart from any other name.

/** Hostname suffixes that conventionally name local-network hosts. */
export const LOCAL_NETWORK_SUFFIXES = [
  'localhost', 'local', 'internal', 'lan', 'home', 'home.arpa', 'corp', 'intranet', 'private',
];

/** Lowercase, without brackets or a trailing dot. */
function bareHost(hostname) {
  return String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

/** True for loopback, private, link-local, shared (CGNAT), unspecified, multicast and reserved IPv4. */
function isLocalIpv4([a, b, c]) {
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 0)
    || (a === 198 && (b === 18 || b === 19));
}

/** Expand an IPv6 literal (lowercase, no brackets) into eight 16-bit groups, or null. */
function parseIpv6Groups(addr) {
  let s = addr;
  const lastColon = s.lastIndexOf(':');
  const tailPart = s.slice(lastColon + 1);
  if (tailPart.includes('.')) {
    const quad = tailPart.split('.').map(Number);
    if (quad.length !== 4 || quad.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = `${s.slice(0, lastColon + 1)}${((quad[0] << 8) | quad[1]).toString(16)}:${((quad[2] << 8) | quad[3]).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (parts.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

const embeddedV4 = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/**
 * True for unspecified/loopback, IPv4-mapped / NAT64 / 6to4 forms whose
 * embedded IPv4 is local, IPv4-compatible forms, fc00::/7, fe80::/10 and
 * ff00::/8. Literals that do not parse count as local.
 */
function isLocalIpv6(addr) {
  const g = parseIpv6Groups(addr);
  if (!g) return true;
  const zeros = (count) => g.slice(0, count).every((x) => x === 0);
  if (zeros(5) && g[5] === 0xffff) return isLocalIpv4(embeddedV4(g[6], g[7]));
  if (zeros(6)) return true; // ::, ::1 and the deprecated IPv4-compatible form
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isLocalIpv4(embeddedV4(g[6], g[7])); // 64:ff9b::/96
  }
  if (g[0] === 0x2002) return isLocalIpv4(embeddedV4(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8
  return false;
}

/**
 * True when a hostname (as produced by `new URL().hostname`) names the local
 * network: a local IP literal, `localhost`, a single-label name, or a name
 * under one of LOCAL_NETWORK_SUFFIXES.
 * @param {string} hostname
 */
export function isLocalNetworkHost(hostname) {
  const host = bareHost(hostname);
  if (!host) return true;
  if (host.includes(':')) return isLocalIpv6(host);
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    return octets.some((n) => n > 255) || isLocalIpv4(octets);
  }
  if (!host.includes('.')) return true;
  return LOCAL_NETWORK_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * Decide whether a feed URL may be added or fetched.
 *  - http(s) only, no embedded credentials.
 *  - Local-network hosts need `allowLocalNetwork`, and may then use http.
 *  - Every other host must use https.
 * @param {string} url
 * @param {{ allowLocalNetwork?: boolean }} [opts]
 * @returns {{ ok: boolean, localNetwork: boolean, error: string }}
 */
export function checkFeedUrl(url, { allowLocalNetwork = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return { ok: false, localNetwork: false, error: 'That is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, localNetwork: false, error: 'Feed URLs must start with https://.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, localNetwork: false, error: 'Feed URLs cannot contain a username or password.' };
  }
  const localNetwork = isLocalNetworkHost(parsed.hostname);
  if (localNetwork && !allowLocalNetwork) {
    return {
      ok: false,
      localNetwork,
      error: 'This is a local-network address. Turn on "Allow local-network feeds" to use it.',
    };
  }
  if (!localNetwork && parsed.protocol !== 'https:') {
    return { ok: false, localNetwork, error: 'Feed URLs must use https:// — search terms are sent in the URL.' };
  }
  return { ok: true, localNetwork, error: '' };
}
