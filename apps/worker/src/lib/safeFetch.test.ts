import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// dns/promises is mocked to simulate DNS-rebinding without hitting the real
// resolver. Hoisted via vi.mock so the import in safeFetch.ts gets it.
const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}));

const fetchMock = vi.hoisted(() => vi.fn());

import {
  safeFetch,
  resolveHostnameSafely,
  safeFetchUserMessage,
  BLOCKED_TARGET_MESSAGE,
} from './safeFetch.js';

describe('resolveHostnameSafely', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('passes through public IPs without calling DNS', async () => {
    const result = await resolveHostnameSafely('8.8.8.8');
    expect(result.ok).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects when the hostname resolves to 127.0.0.1', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const result = await resolveHostnameSafely('evil.example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('blocked-host');
      expect(result.message).toContain('127.0.0.1');
    }
  });

  it('rejects when ANY resolved address is private (multi-record poisoning)', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 }, // public
      { address: '10.0.0.5', family: 4 }, // private — must reject
    ]);
    const result = await resolveHostnameSafely('mixed.example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-host');
  });

  it('rejects when DNS resolution fails', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const result = await resolveHostnameSafely('nonexistent.invalid');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('dns-failed');
  });

  it('accepts when all resolved addresses are public', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    const result = await resolveHostnameSafely('example.com');
    expect(result.ok).toBe(true);
  });

  it('rejects when AWS metadata IP is in the response', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    const result = await resolveHostnameSafely('rebind.example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('blocked-host');
      expect(result.message).toContain('169.254.169.254');
    }
  });
});

describe('safeFetch — URL validation gate', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects http://127.0.0.1 without ever reaching DNS or fetch', async () => {
    const result = await safeFetch('http://127.0.0.1/');
    expect(result.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    if (!result.ok) expect(result.reason).toBe('blocked-host');
  });

  it('rejects IPv4-mapped IPv6 form of localhost', async () => {
    const result = await safeFetch('http://[::ffff:127.0.0.1]/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-host');
  });

  it('rejects when DNS rebinds a hostname to 127.0.0.1', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const result = await safeFetch('http://rebind.example.com/');
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    if (!result.ok) expect(result.reason).toBe('blocked-host');
  });

  it('rejects file:// URLs at the validator', async () => {
    const result = await safeFetch('file:///etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-host');
  });

  it('re-validates redirect targets', async () => {
    // First hop: a real public site that 302s to 169.254.169.254
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    fetchMock.mockResolvedValueOnce(
      new Response('', {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
    );
    const result = await safeFetch('http://example.com/redirect');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-host');
  });

  it('returns the body when the URL and DNS are both safe', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html><p>ok', { status: 200 }));

    const result = await safeFetch('http://example.com/');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.body.toString('utf8')).toContain('<!doctype html>');
    }
  });

  it('caps response size at maxBytes', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const big = 'x'.repeat(100);
    fetchMock.mockResolvedValueOnce(new Response(big, { status: 200 }));

    const result = await safeFetch('http://example.com/big', { maxBytes: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('response-too-large');
  });

  it('aborts after maxRedirects hops', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    fetchMock.mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: 'http://example.com/next' },
      }),
    );
    const result = await safeFetch('http://example.com/', { maxRedirects: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-many-redirects');
  });
});

describe('safeFetchUserMessage', () => {
  it('returns a leak-free message for a blocked host (no IP in output)', () => {
    const msg = safeFetchUserMessage({
      ok: false,
      reason: 'blocked-host',
      message: 'Hostname evil.example.com resolves to 10.0.0.5, which is in a blocked range',
    });
    expect(msg).toBe(BLOCKED_TARGET_MESSAGE);
    expect(msg).not.toMatch(/10\.0\.0\.5/);
    expect(msg).not.toMatch(/evil\.example\.com/);
  });

  it('never echoes the internal detail for any reason', () => {
    const reasons = [
      'invalid-url',
      'dns-failed',
      'too-many-redirects',
      'response-too-large',
      'timeout',
      'network',
    ] as const;
    for (const reason of reasons) {
      const msg = safeFetchUserMessage({
        ok: false,
        reason,
        message: 'secret-internal-host-10.1.2.3 detail',
      });
      expect(msg).not.toMatch(/10\.1\.2\.3/);
      expect(msg).not.toMatch(/secret-internal-host/);
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it('surfaces only the upstream HTTP status for http-error', () => {
    const msg = safeFetchUserMessage({
      ok: false,
      reason: 'http-error',
      message: 'Upstream returned 503',
      status: 503,
    });
    expect(msg).toContain('503');
  });
});
