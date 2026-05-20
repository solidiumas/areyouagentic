/**
 * Normalize a URL for deduplication. Two URLs that resolve to the same page
 * (modulo tracking params, fragment, default port, trailing slash) should
 * normalize to the same string so we can cheaply look up "is there already
 * a job for this URL?" via an indexed equality match.
 *
 * Not a security boundary — `validateAnalyzableUrl` is the SSRF gate. This
 * function assumes its input has already been validated.
 */
const TRACKING_PARAM_PREFIXES = ['utm_', 'mc_', 'icid_', 'oly_'];
const TRACKING_PARAMS = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'yclid',
  'dclid',
  'twclid',
  'igshid',
  '_ga',
  '_gl',
  'ref',
  'ref_src',
  'ref_url',
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p));
}

export function normalizeUrl(input: string | URL): string {
  const url = typeof input === 'string' ? new URL(input) : new URL(input.toString());

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  // Strip default ports for http(s).
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  // Drop tracking params, then sort the rest so order doesn't fragment the key.
  const params = new URLSearchParams();
  const entries = [...url.searchParams.entries()]
    .filter(([k]) => !isTrackingParam(k))
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of entries) params.append(k, v);
  url.search = params.toString();

  // Collapse `/` and trailing slash on non-root paths.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
}
