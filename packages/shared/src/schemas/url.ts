import { z } from 'zod';

/**
 * urlSchema — validates URL format and restricts protocol to http/https.
 * Use this for plain shape validation (e.g. form input). To additionally
 * defend against SSRF, use {@link validateAnalyzableUrl}.
 */
export const urlSchema = z
  .string()
  .min(1, 'URL is required')
  .url('Must be a valid URL')
  .refine((val) => /^https?:\/\//i.test(val), {
    message: 'URL must use http or https',
  });

export type UrlInput = z.infer<typeof urlSchema>;

/**
 * Reasons {@link validateAnalyzableUrl} can reject a URL.
 *
 * Kept as a small, action-oriented set instead of a long taxonomy so callers
 * can map each reason to a user-facing message without a giant switch.
 */
export type UrlValidationReason =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'embedded-credentials'
  | 'blocked-hostname'
  | 'loopback-ip'
  | 'private-ip'
  | 'link-local'
  | 'reserved-ip';

export type UrlValidationResult =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlValidationReason; message: string };

// Hostnames that are *names* rather than addresses, but still resolve to the
// local machine on most systems. The IP form (127.0.0.1, ::1) is handled
// numerically below.
const BLOCKED_HOSTNAMES = new Set<string>([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
]);

// ── IPv4 ────────────────────────────────────────────────────────────

type Ipv4 = readonly [number, number, number, number];

/**
 * Parses an IPv4 address from any of the WHATWG-recognized forms:
 * dotted-quad, decimal, hex, octal, and 1–3 part shortcut forms.
 * Returns null if `input` doesn't look like any IPv4 form.
 *
 * We do this even though Node's URL parser canonicalizes most forms,
 * because (a) older runtimes don't, (b) we don't want our security to
 * depend on parser version, and (c) callers may pass raw hostnames.
 */
function parseIpv4(input: string): Ipv4 | null {
  if (input.length === 0) return null;
  // Reject trailing dots and consecutive dots up front.
  if (input.endsWith('.') || input.includes('..')) return null;

  const parts = input.split('.');
  if (parts.length === 0 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const part of parts) {
    if (part.length === 0) return null;
    let n: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
      n = parseInt(part.slice(2), 16);
    } else if (/^0[0-7]+$/.test(part)) {
      n = parseInt(part, 8);
    } else if (/^(?:0|[1-9][0-9]*)$/.test(part)) {
      n = parseInt(part, 10);
    } else {
      return null;
    }
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }

  // 1–3 part forms pack the trailing number into the remaining bytes.
  switch (nums.length) {
    case 1: {
      const [n] = nums as [number];
      if (n > 0xff_ff_ff_ff) return null;
      return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    }
    case 2: {
      const [a, b] = nums as [number, number];
      if (a > 0xff || b > 0xff_ff_ff) return null;
      return [a, (b >>> 16) & 0xff, (b >>> 8) & 0xff, b & 0xff];
    }
    case 3: {
      const [a, b, c] = nums as [number, number, number];
      if (a > 0xff || b > 0xff || c > 0xff_ff) return null;
      return [a, b, (c >>> 8) & 0xff, c & 0xff];
    }
    case 4: {
      if (nums.some((n) => n > 0xff)) return null;
      return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
    }
    default:
      return null;
  }
}

function classifyIpv4([a, b, c, d]: Ipv4): UrlValidationReason | null {
  // 0.0.0.0/8 — "this network", incl. unspecified address
  if (a === 0) return 'reserved-ip';

  // 127.0.0.0/8 — loopback
  if (a === 127) return 'loopback-ip';

  // 10.0.0.0/8 — RFC1918
  if (a === 10) return 'private-ip';

  // 172.16.0.0/12 — RFC1918 (172.16.x.x – 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) return 'private-ip';

  // 192.168.0.0/16 — RFC1918
  if (a === 192 && b === 168) return 'private-ip';

  // 100.64.0.0/10 — CGNAT (RFC6598). Treat as private to be safe.
  if (a === 100 && b >= 64 && b <= 127) return 'private-ip';

  // 169.254.0.0/16 — link-local. Includes the cloud metadata IP
  // 169.254.169.254 used by AWS, GCP, Azure, etc.
  if (a === 169 && b === 254) return 'link-local';

  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return 'reserved-ip';

  // 240.0.0.0/4 — reserved (incl. 255.255.255.255 broadcast)
  if (a >= 240) return 'reserved-ip';

  // Quiet down "unused" lints for c/d when no further check uses them.
  void c;
  void d;
  return null;
}

// ── IPv6 ────────────────────────────────────────────────────────────

/**
 * Parse an IPv6 hostname (without surrounding brackets) into its 16 bytes.
 * Supports `::` compression and IPv4-mapped suffixes (`::ffff:1.2.3.4`).
 */
function parseIpv6(input: string): Uint8Array | null {
  if (input.length === 0) return null;

  // Pull off a trailing IPv4 suffix if present (used in IPv4-mapped form).
  let v6Part = input;
  let ipv4Tail: Ipv4 | null = null;
  const lastColon = input.lastIndexOf(':');
  if (lastColon !== -1 && input.includes('.', lastColon)) {
    const tail = input.slice(lastColon + 1);
    const head = input.slice(0, lastColon);
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    ipv4Tail = v4;
    v6Part = head + ':0:0';
  }

  const compressionSplit = v6Part.split('::');
  if (compressionSplit.length > 2) return null;

  const expectedGroups = 8;
  let groups: string[];
  if (compressionSplit.length === 2) {
    const head = compressionSplit[0]!.length === 0 ? [] : compressionSplit[0]!.split(':');
    const tail = compressionSplit[1]!.length === 0 ? [] : compressionSplit[1]!.split(':');
    if (head.length + tail.length >= expectedGroups) return null;
    const fill = new Array(expectedGroups - head.length - tail.length).fill('0');
    groups = [...head, ...fill, ...tail];
  } else {
    groups = v6Part.split(':');
    if (groups.length !== expectedGroups) return null;
  }

  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < expectedGroups; i++) {
    const v = parseInt(groups[i]!, 16);
    bytes[i * 2] = (v >>> 8) & 0xff;
    bytes[i * 2 + 1] = v & 0xff;
  }

  // Overwrite the last 32 bits with the IPv4 tail if we extracted one.
  if (ipv4Tail) {
    bytes[12] = ipv4Tail[0];
    bytes[13] = ipv4Tail[1];
    bytes[14] = ipv4Tail[2];
    bytes[15] = ipv4Tail[3];
  }

  return bytes;
}

function classifyIpv6(bytes: Uint8Array): UrlValidationReason | null {
  const isAllZero = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (bytes[i] !== 0) return false;
    return true;
  };

  // ::1 — loopback
  if (isAllZero(0, 15) && bytes[15] === 1) return 'loopback-ip';

  // :: — unspecified
  if (isAllZero(0, 16)) return 'reserved-ip';

  // ::ffff:0:0/96 — IPv4-mapped IPv6: reuse IPv4 classification
  if (isAllZero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return classifyIpv4([bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!]);
  }

  // fe80::/10 — link-local
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return 'link-local';

  // fc00::/7 — unique local (ULA)
  if ((bytes[0]! & 0xfe) === 0xfc) return 'private-ip';

  // ff00::/8 — multicast
  if (bytes[0] === 0xff) return 'reserved-ip';

  return null;
}

// ── Public API ──────────────────────────────────────────────────────

const reject = (reason: UrlValidationReason, message: string): UrlValidationResult => ({
  ok: false,
  reason,
  message,
});

/**
 * Defense-in-depth URL validator for analysis targets.
 *
 * Blocks:
 *  - Non-http(s) protocols (file, ftp, javascript, data, …)
 *  - Embedded credentials (`user:pass@host`)
 *  - localhost / loopback IPs (127.0.0.0/8, ::1)
 *  - Private networks (RFC1918, CGNAT, IPv6 ULA)
 *  - Link-local — including the cloud metadata IP 169.254.169.254
 *  - 0.0.0.0, multicast, broadcast, other reserved ranges
 *  - IPv4 obfuscation: decimal, hex, octal, short-form
 *  - IPv4-mapped IPv6 of any of the above
 */
export function validateAnalyzableUrl(input: unknown): UrlValidationResult {
  if (typeof input !== 'string' || input.length === 0) {
    return reject('invalid-url', 'URL must be a non-empty string');
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return reject('invalid-url', 'URL could not be parsed');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return reject('unsupported-protocol', `Protocol "${parsed.protocol}" is not allowed`);
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return reject('embedded-credentials', 'URLs with embedded credentials are not allowed');
  }

  // Hostname comes lower-cased by the URL parser. IPv6 hostnames are wrapped
  // in [brackets]; strip those before parsing.
  const rawHost = parsed.hostname;
  if (rawHost.length === 0) {
    return reject('invalid-url', 'URL is missing a hostname');
  }

  const isBracketed = rawHost.startsWith('[') && rawHost.endsWith(']');
  const host = isBracketed ? rawHost.slice(1, -1) : rawHost;

  // IPv6 path
  if (isBracketed || host.includes(':')) {
    const bytes = parseIpv6(host);
    if (!bytes) return reject('invalid-url', 'Invalid IPv6 address');
    const reason = classifyIpv6(bytes);
    if (reason) {
      return reject(reason, `Hostname ${rawHost} is in a blocked range`);
    }
    return { ok: true, url: parsed };
  }

  // IPv4 path — try our own parser even if the URL parser already canonicalized.
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    const reason = classifyIpv4(ipv4);
    if (reason) {
      return reject(reason, `Hostname ${rawHost} resolves to a blocked IPv4 range`);
    }
    return { ok: true, url: parsed };
  }

  // Otherwise it's a regular DNS name.
  if (BLOCKED_HOSTNAMES.has(host.toLowerCase())) {
    return reject('blocked-hostname', `Hostname "${host}" is not allowed`);
  }

  return { ok: true, url: parsed };
}
