import { describe, it, expect, vi, afterEach } from 'vitest';
import { siteverify } from './turnstile.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('siteverify', () => {
  it('returns true only on an explicit success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true })));
    expect(await siteverify('secret', 'token')).toBe(true);
  });

  it('returns false when Cloudflare reports failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, 'error-codes': ['x'] })));
    expect(await siteverify('secret', 'token')).toBe(false);
  });

  it('returns false on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect(await siteverify('secret', 'token')).toBe(false);
  });

  it('fails closed when the request throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await siteverify('secret', 'token')).toBe(false);
  });

  it('posts the secret, token, and remote ip to Cloudflare', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await siteverify('mysecret', 'mytoken', '1.2.3.4');

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = call[1].body as URLSearchParams;
    expect(body.get('secret')).toBe('mysecret');
    expect(body.get('response')).toBe('mytoken');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });
});
