import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { classifyIpString, validateAnalyzableUrl } from '@areyouagentic/shared';

/**
 * Result of an SSRF-safe fetch attempt. Errors carry a structured reason so
 * callers can map to a stable JobError code rather than parsing strings.
 */
export type SafeFetchError = {
  ok: false;
  reason:
    | 'invalid-url'
    | 'blocked-host'
    | 'dns-failed'
    | 'too-many-redirects'
    | 'response-too-large'
    | 'timeout'
    | 'network'
    | 'http-error';
  message: string;
  status?: number;
};

export type SafeFetchOk = {
  ok: true;
  finalUrl: string;
  status: number;
  headers: Headers;
  body: Buffer;
};

export type SafeFetchResult = SafeFetchOk | SafeFetchError;

/** Generic, leak-free message surfaced to users for a blocked target. */
export const BLOCKED_TARGET_MESSAGE = 'This URL is not allowed for analysis.';

/**
 * Map a {@link SafeFetchError} to a message that is safe to show an end user.
 * The structured `reason` and any internal detail (e.g. a resolved private IP
 * from a DNS-rebinding attempt) stay in the server logs; users get a stable,
 * non-revealing sentence. This is what prevents the analyzer's error path from
 * doubling as an internal-network/DNS oracle.
 */
export function safeFetchUserMessage(err: SafeFetchError): string {
  switch (err.reason) {
    case 'blocked-host':
    case 'invalid-url':
      return BLOCKED_TARGET_MESSAGE;
    case 'dns-failed':
      return "The site's DNS name could not be resolved.";
    case 'too-many-redirects':
      return 'The site redirected too many times.';
    case 'response-too-large':
      return 'The page is too large to analyze.';
    case 'timeout':
      return 'The site took too long to respond.';
    case 'http-error':
      return err.status ? `The site returned HTTP ${err.status}.` : 'The site returned an error.';
    case 'network':
    default:
      return 'The site could not be reached.';
  }
}

export type SafeFetchOptions = {
  /** Max redirect hops. Each hop is re-validated for SSRF. */
  maxRedirects?: number;
  /** Per-attempt timeout in ms (each hop gets its own). */
  timeoutMs?: number;
  /** Hard cap on response size. Larger responses are aborted. */
  maxBytes?: number;
  /** User-Agent to send. Default identifies our crawler. */
  userAgent?: string;
};

const DEFAULTS: Required<SafeFetchOptions> = {
  maxRedirects: 5,
  timeoutMs: 15_000,
  maxBytes: 10 * 1024 * 1024, // 10 MB
  userAgent: 'AreYouAgenticBot/1.0 (+https://areyouagentic.com)',
};

/**
 * Resolve a hostname through DNS and confirm every A/AAAA record points at a
 * public address. Blocks DNS-rebinding ("evil.example.com" → 127.0.0.1) and
 * multi-record poisoning (one public, one private).
 *
 * Returns the validated IPs so callers can connect to one directly and pin
 * Host header — but we do NOT do that here because Node's fetch does not
 * support custom resolvers natively. The TOCTOU window between this check
 * and the actual connection is documented as a known limitation in
 * SECURITY.md; the URL-validator + per-redirect check still block the most
 * common attack paths.
 */
export async function resolveHostnameSafely(
  hostname: string,
): Promise<{ ok: true; addresses: LookupAddress[] } | SafeFetchError> {
  // Skip DNS if the hostname is already a literal IP — validateAnalyzableUrl
  // has already classified it.
  if (looksLikeIp(hostname)) {
    return { ok: true, addresses: [{ address: hostname, family: hostname.includes(':') ? 6 : 4 }] };
  }

  let records: LookupAddress[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    return {
      ok: false,
      reason: 'dns-failed',
      message: `DNS resolution failed for ${hostname}: ${(err as Error).message}`,
    };
  }

  if (records.length === 0) {
    return { ok: false, reason: 'dns-failed', message: `No DNS records for ${hostname}` };
  }

  for (const record of records) {
    const classified = classifyIpString(record.address);
    if (classified !== null) {
      return {
        ok: false,
        reason: 'blocked-host',
        message: `Hostname ${hostname} resolves to ${record.address}, which is in a blocked range (${classified})`,
      };
    }
  }

  return { ok: true, addresses: records };
}

function looksLikeIp(host: string): boolean {
  // Rough check — classifyIpString is the source of truth, but a literal IPv6
  // hostname comes wrapped in brackets via URL parsing; tolerate both.
  return /^\[?[0-9a-fA-F:.]+\]?$/.test(host);
}

/**
 * Fetch a URL with SSRF defenses applied at every hop:
 *  - URL is validated by `validateAnalyzableUrl` first.
 *  - Hostname is resolved and every IP is checked against blocked ranges.
 *  - `redirect: 'manual'` so we re-validate the next URL ourselves.
 *  - Response size is capped.
 *  - Per-hop timeout via AbortController.
 *
 * Returns a discriminated union — never throws. Callers should branch on `.ok`.
 */
export async function safeFetch(
  inputUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const opts = { ...DEFAULTS, ...options };

  let currentUrl = inputUrl;
  let hops = 0;

  while (hops <= opts.maxRedirects) {
    const validation = validateAnalyzableUrl(currentUrl);
    if (!validation.ok) {
      return {
        ok: false,
        reason: validation.reason === 'invalid-url' ? 'invalid-url' : 'blocked-host',
        message: validation.message,
      };
    }

    const url = validation.url;

    const dns = await resolveHostnameSafely(url.hostname);
    if (!dns.ok) return dns;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': opts.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as Error).name === 'AbortError';
      return {
        ok: false,
        reason: aborted ? 'timeout' : 'network',
        message: aborted
          ? `Request to ${url.hostname} timed out after ${opts.timeoutMs}ms`
          : `Network error: ${(err as Error).message}`,
      };
    }

    clearTimeout(timer);

    // Manual redirect handling — re-enter the loop with the new URL so it
    // goes through the same validation gate.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        // Some servers return 3xx with no Location — treat as the final response.
      } else {
        const next = new URL(location, url).toString();
        hops += 1;
        if (hops > opts.maxRedirects) {
          return {
            ok: false,
            reason: 'too-many-redirects',
            message: `Exceeded ${opts.maxRedirects} redirects`,
          };
        }
        currentUrl = next;
        continue;
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: 'http-error',
        message: `Upstream returned ${response.status}`,
        status: response.status,
      };
    }

    // Stream the body with a hard byte ceiling. Stops a hostile server from
    // exhausting memory by sending a multi-gigabyte response.
    const body = await readWithLimit(response, opts.maxBytes);
    if (!body.ok) return body;

    return {
      ok: true,
      finalUrl: url.toString(),
      status: response.status,
      headers: response.headers,
      body: body.buffer,
    };
  }

  return {
    ok: false,
    reason: 'too-many-redirects',
    message: `Exceeded ${opts.maxRedirects} redirects`,
  };
}

async function readWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; buffer: Buffer } | SafeFetchError> {
  const reader = response.body?.getReader();
  if (!reader) {
    // No streaming reader (e.g. mocked Response) — fall back to arrayBuffer
    // with the same cap applied after the fact.
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) {
      return {
        ok: false,
        reason: 'response-too-large',
        message: `Response exceeded ${maxBytes} bytes`,
      };
    }
    return { ok: true, buffer: buf };
  }

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // best effort — connection might already be closed
      }
      return {
        ok: false,
        reason: 'response-too-large',
        message: `Response exceeded ${maxBytes} bytes`,
      };
    }
    chunks.push(Buffer.from(value));
  }
  return { ok: true, buffer: Buffer.concat(chunks) };
}
