import { describe, it, expect } from 'vitest';
import { classifyIpString, urlSchema, validateAnalyzableUrl } from './url.js';

describe('validateAnalyzableUrl — valid URLs', () => {
  it('accepts a plain https URL', () => {
    const result = validateAnalyzableUrl('https://example.com/');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.hostname).toBe('example.com');
  });

  it('accepts http URLs', () => {
    expect(validateAnalyzableUrl('http://example.com/').ok).toBe(true);
  });

  it('accepts URLs with paths, queries, and fragments', () => {
    expect(
      validateAnalyzableUrl('https://example.com/foo/bar?q=hello&n=1#section').ok,
    ).toBe(true);
  });

  it('accepts URLs with explicit ports', () => {
    expect(validateAnalyzableUrl('https://example.com:8443/').ok).toBe(true);
  });

  it('accepts public IPv4 addresses', () => {
    expect(validateAnalyzableUrl('https://8.8.8.8/').ok).toBe(true);
  });

  it('accepts public IPv6 addresses', () => {
    expect(validateAnalyzableUrl('https://[2606:4700:4700::1111]/').ok).toBe(true);
  });

  it('accepts 172.15.x.x (just outside RFC1918)', () => {
    expect(validateAnalyzableUrl('http://172.15.0.1/').ok).toBe(true);
  });

  it('accepts 172.32.x.x (just outside RFC1918)', () => {
    expect(validateAnalyzableUrl('http://172.32.0.1/').ok).toBe(true);
  });
});

describe('validateAnalyzableUrl — protocol restrictions', () => {
  it('rejects file:// URLs', () => {
    const r = validateAnalyzableUrl('file:///etc/passwd');
    expect(r).toMatchObject({ ok: false, reason: 'unsupported-protocol' });
  });

  it('rejects ftp:// URLs', () => {
    const r = validateAnalyzableUrl('ftp://example.com/');
    expect(r).toMatchObject({ ok: false, reason: 'unsupported-protocol' });
  });

  it('rejects javascript: URLs', () => {
    const r = validateAnalyzableUrl('javascript:alert(1)');
    expect(r.ok).toBe(false);
  });

  it('rejects data: URLs', () => {
    const r = validateAnalyzableUrl('data:text/plain,hello');
    expect(r.ok).toBe(false);
  });

  it('rejects gopher:// URLs', () => {
    expect(validateAnalyzableUrl('gopher://example.com/').ok).toBe(false);
  });
});

describe('validateAnalyzableUrl — embedded credentials', () => {
  it('rejects URLs with user:pass', () => {
    const r = validateAnalyzableUrl('https://user:pass@example.com/');
    expect(r).toMatchObject({ ok: false, reason: 'embedded-credentials' });
  });

  it('rejects URLs with just a username', () => {
    const r = validateAnalyzableUrl('https://admin@internal.example.com/');
    expect(r).toMatchObject({ ok: false, reason: 'embedded-credentials' });
  });
});

describe('validateAnalyzableUrl — localhost and loopback', () => {
  it('rejects literal localhost', () => {
    const r = validateAnalyzableUrl('http://localhost/');
    expect(r).toMatchObject({ ok: false, reason: 'blocked-hostname' });
  });

  it('rejects localhost on a port', () => {
    expect(validateAnalyzableUrl('http://localhost:3000/').ok).toBe(false);
  });

  it('rejects 127.0.0.1', () => {
    const r = validateAnalyzableUrl('http://127.0.0.1/');
    expect(r).toMatchObject({ ok: false, reason: 'loopback-ip' });
  });

  it('rejects anything in 127.0.0.0/8', () => {
    expect(validateAnalyzableUrl('http://127.5.5.5/')).toMatchObject({
      ok: false,
      reason: 'loopback-ip',
    });
  });

  it('rejects IPv6 ::1', () => {
    const r = validateAnalyzableUrl('http://[::1]/');
    expect(r).toMatchObject({ ok: false, reason: 'loopback-ip' });
  });
});

describe('validateAnalyzableUrl — private networks', () => {
  it('rejects 10.x.x.x (RFC1918)', () => {
    expect(validateAnalyzableUrl('http://10.0.0.1/')).toMatchObject({
      ok: false,
      reason: 'private-ip',
    });
  });

  it('rejects the bottom of 172.16.0.0/12', () => {
    expect(validateAnalyzableUrl('http://172.16.0.1/')).toMatchObject({
      ok: false,
      reason: 'private-ip',
    });
  });

  it('rejects the top of 172.16.0.0/12', () => {
    expect(validateAnalyzableUrl('http://172.31.255.255/')).toMatchObject({
      ok: false,
      reason: 'private-ip',
    });
  });

  it('rejects 192.168.x.x (RFC1918)', () => {
    expect(validateAnalyzableUrl('http://192.168.1.1/')).toMatchObject({
      ok: false,
      reason: 'private-ip',
    });
  });

  it('rejects CGNAT 100.64.x.x', () => {
    expect(validateAnalyzableUrl('http://100.64.0.1/')).toMatchObject({
      ok: false,
      reason: 'private-ip',
    });
  });

  it('rejects IPv6 ULA fc00::/7', () => {
    expect(validateAnalyzableUrl('http://[fc00::1]/')).toMatchObject({
      ok: false,
      reason: 'private-ip',
    });
  });
});

describe('validateAnalyzableUrl — link-local and cloud metadata (SSRF)', () => {
  it('rejects the AWS/GCP/Azure metadata IP 169.254.169.254', () => {
    const r = validateAnalyzableUrl('http://169.254.169.254/latest/meta-data/');
    expect(r).toMatchObject({ ok: false, reason: 'link-local' });
  });

  it('rejects the rest of 169.254.0.0/16', () => {
    expect(validateAnalyzableUrl('http://169.254.1.1/')).toMatchObject({
      ok: false,
      reason: 'link-local',
    });
  });

  it('rejects IPv6 link-local fe80::/10', () => {
    expect(validateAnalyzableUrl('http://[fe80::1]/')).toMatchObject({
      ok: false,
      reason: 'link-local',
    });
  });

  it('rejects IPv4-mapped IPv6 form of the AWS metadata IP', () => {
    expect(
      validateAnalyzableUrl('http://[::ffff:169.254.169.254]/'),
    ).toMatchObject({ ok: false, reason: 'link-local' });
  });
});

describe('validateAnalyzableUrl — IPv4 obfuscation', () => {
  // The WHATWG URL parser canonicalizes most of these to dotted-quad before
  // we see them, but our own parseIpv4 also handles the raw forms — so we
  // just assert that the URL is rejected, regardless of which path catches
  // it. The point is that obfuscation can't bypass the SSRF check.

  it('rejects 127.0.0.1 written as a single decimal (2130706433)', () => {
    expect(validateAnalyzableUrl('http://2130706433/').ok).toBe(false);
  });

  it('rejects 127.0.0.1 written with hex octets', () => {
    expect(validateAnalyzableUrl('http://0x7f.0.0.1/').ok).toBe(false);
  });

  it('rejects 127.0.0.1 written with octal octets', () => {
    expect(validateAnalyzableUrl('http://0177.0.0.1/').ok).toBe(false);
  });

  it('rejects the AWS metadata IP in hex form', () => {
    expect(validateAnalyzableUrl('http://0xa9fea9fe/').ok).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 form of localhost', () => {
    expect(validateAnalyzableUrl('http://[::ffff:127.0.0.1]/')).toMatchObject({
      ok: false,
      reason: 'loopback-ip',
    });
  });
});

describe('validateAnalyzableUrl — reserved ranges', () => {
  it('rejects 0.0.0.0', () => {
    expect(validateAnalyzableUrl('http://0.0.0.0/')).toMatchObject({
      ok: false,
      reason: 'reserved-ip',
    });
  });

  it('rejects 224.x.x.x multicast', () => {
    expect(validateAnalyzableUrl('http://224.0.0.1/')).toMatchObject({
      ok: false,
      reason: 'reserved-ip',
    });
  });

  it('rejects 255.255.255.255 broadcast', () => {
    expect(validateAnalyzableUrl('http://255.255.255.255/')).toMatchObject({
      ok: false,
      reason: 'reserved-ip',
    });
  });
});

describe('validateAnalyzableUrl — bad input', () => {
  it('rejects an empty string', () => {
    expect(validateAnalyzableUrl('')).toMatchObject({
      ok: false,
      reason: 'invalid-url',
    });
  });

  it('rejects non-string input', () => {
    expect(validateAnalyzableUrl(null)).toMatchObject({
      ok: false,
      reason: 'invalid-url',
    });
    expect(validateAnalyzableUrl(undefined)).toMatchObject({
      ok: false,
      reason: 'invalid-url',
    });
    expect(validateAnalyzableUrl(42)).toMatchObject({
      ok: false,
      reason: 'invalid-url',
    });
  });

  it('rejects gibberish that the URL parser cannot handle', () => {
    expect(validateAnalyzableUrl('not a url at all')).toMatchObject({
      ok: false,
      reason: 'invalid-url',
    });
  });
});

describe('classifyIpString — DNS resolution gate', () => {
  it('returns null for a public IPv4 address', () => {
    expect(classifyIpString('8.8.8.8')).toBeNull();
  });

  it('flags 127.0.0.1 as loopback', () => {
    expect(classifyIpString('127.0.0.1')).toBe('loopback-ip');
  });

  it('flags 169.254.169.254 (AWS metadata) as link-local', () => {
    expect(classifyIpString('169.254.169.254')).toBe('link-local');
  });

  it('flags 10.0.0.5 as private', () => {
    expect(classifyIpString('10.0.0.5')).toBe('private-ip');
  });

  it('flags IPv6 ::1 as loopback', () => {
    expect(classifyIpString('::1')).toBe('loopback-ip');
  });

  it('flags IPv4-mapped IPv6 of 127.0.0.1 as loopback', () => {
    expect(classifyIpString('::ffff:127.0.0.1')).toBe('loopback-ip');
  });

  it('returns null for a public IPv6 address', () => {
    expect(classifyIpString('2606:4700:4700::1111')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(classifyIpString('')).toBe('invalid-url');
  });

  it('rejects garbage', () => {
    expect(classifyIpString('not-an-ip')).toBe('invalid-url');
  });
});

describe('urlSchema', () => {
  it('accepts http and https URLs', () => {
    expect(urlSchema.safeParse('http://example.com/').success).toBe(true);
    expect(urlSchema.safeParse('https://example.com/').success).toBe(true);
  });

  it('rejects non-http(s) protocols', () => {
    expect(urlSchema.safeParse('file:///etc/passwd').success).toBe(false);
    expect(urlSchema.safeParse('ftp://example.com/').success).toBe(false);
  });

  it('rejects empty and malformed strings', () => {
    expect(urlSchema.safeParse('').success).toBe(false);
    expect(urlSchema.safeParse('not a url').success).toBe(false);
  });
});
