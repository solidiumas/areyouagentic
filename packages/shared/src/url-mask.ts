/**
 * Redact secret-bearing query parameters (and any embedded credentials) from a
 * URL before it is *stored* or *displayed*. Reports are public-but-unlisted, so
 * a submitted URL like `…/reset?token=abc` must not surface its token in the
 * report, the database, or the summary we send to the LLM.
 *
 * This is a privacy/display transform, NOT a security boundary and NOT a
 * deduplication key — `normalizeUrl` (which keeps real values) is still the key
 * the API dedupes on, and the *real* URL is what the worker fetches via the
 * ephemeral queue payload. Mask only the persisted/exposed copies.
 */

export const REDACTED = '[redacted]';

/**
 * Param names that frequently carry secrets. Substring matches are intentional
 * (`token` catches `access_token`, `csrf_token`, …). Short, ambiguous names are
 * matched exactly so we don't over-redact (`key` should not hit `keyword`).
 */
const SENSITIVE_SUBSTRINGS = [
  'token',
  'secret',
  'password',
  'passwd',
  'auth',
  'session',
  'signature',
  'apikey',
  'credential',
  'otp',
];

const SENSITIVE_EXACT = new Set([
  'key',
  'api_key',
  'access_key',
  'pwd',
  'pass',
  'sig',
  'sid',
  'code',
  'state',
  'email',
  'ticket',
  'hash',
]);

function isSensitiveParam(name: string): boolean {
  const n = name.toLowerCase();
  if (SENSITIVE_EXACT.has(n)) return true;
  return SENSITIVE_SUBSTRINGS.some((s) => n.includes(s));
}

/**
 * Return `input` with secret-bearing query params replaced by `[redacted]` and
 * any embedded credentials removed. Param names are preserved so the report
 * still shows the URL's shape. Returns the input unchanged if it can't be
 * parsed as a URL.
 */
export function maskSensitiveUrl(input: string | URL): string {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : new URL(input.toString());
  } catch {
    return typeof input === 'string' ? input : input.toString();
  }

  // Embedded credentials should already be rejected by validateAnalyzableUrl,
  // but strip them here too so a masked copy never carries `user:pass@`.
  if (url.username !== '' || url.password !== '') {
    url.username = '';
    url.password = '';
  }

  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveParam(key)) {
      url.searchParams.set(key, REDACTED);
    }
  }

  return url.toString();
}
