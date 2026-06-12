import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserContext, Route, Request as PlaywrightRequest } from 'playwright';
import type { Logger } from 'pino';

// Mirror safeFetch.test.ts: mock the DNS resolver so we can simulate rebinding
// without touching the network. safeBrowsing reuses resolveHostnameSafely,
// which calls lookup() from node:dns/promises.
const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { assertNavigableUrl, installSsrfGuard } from './safeBrowsing.js';

const log = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

beforeEach(() => {
  lookupMock.mockReset();
  vi.clearAllMocks();
});

describe('assertNavigableUrl', () => {
  it('allows a public host (DNS resolves public)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const result = await assertNavigableUrl('https://example.com/');
    expect(result.ok).toBe(true);
  });

  it('rejects a literal private IP without any DNS lookup', async () => {
    const result = await assertNavigableUrl('http://10.0.0.5/');
    expect(result.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects a host that resolves to loopback (DNS rebinding)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const result = await assertNavigableUrl('https://evil.example.com/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-host');
  });

  it('rejects the cloud metadata IP', async () => {
    const result = await assertNavigableUrl('http://169.254.169.254/latest/meta-data/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('link-local');
  });

  it('rejects non-http(s) schemes', async () => {
    const result = await assertNavigableUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('reports dns-failed distinctly so the caller can retry', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const result = await assertNavigableUrl('https://nope.invalid/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('dns-failed');
  });
});

// ── Guard handler ────────────────────────────────────────────────────

type Captured = (route: Route, request: PlaywrightRequest) => Promise<void>;

function fakeContext(): { context: BrowserContext; getHandler: () => Captured } {
  let handler: Captured | undefined;
  const context = {
    route: vi.fn(async (_pattern: string, h: Captured) => {
      handler = h;
    }),
  } as unknown as BrowserContext;
  return {
    context,
    getHandler: () => {
      if (!handler) throw new Error('handler not registered');
      return handler;
    },
  };
}

function fakeRequest(url: string, navigation = false) {
  const route = {
    abort: vi.fn(async () => {}),
    continue: vi.fn(async () => {}),
  } as unknown as Route;
  const request = {
    url: () => url,
    isNavigationRequest: () => navigation,
  } as unknown as PlaywrightRequest;
  return { route, request };
}

describe('installSsrfGuard', () => {
  it('allows requests to a public host', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const { context, getHandler } = fakeContext();
    const state = await installSsrfGuard(context, log);
    const { route, request } = fakeRequest('https://example.com/app.js');

    await getHandler()(route, request);

    expect(route.continue).toHaveBeenCalled();
    expect(route.abort).not.toHaveBeenCalled();
    expect(state.blockedRequests).toBe(0);
  });

  it('blocks a subresource that resolves to a private IP', async () => {
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const { context, getHandler } = fakeContext();
    const state = await installSsrfGuard(context, log);
    const { route, request } = fakeRequest('https://attacker.test/beacon');

    await getHandler()(route, request);

    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(route.continue).not.toHaveBeenCalled();
    expect(state.blockedRequests).toBe(1);
    expect(state.navigationBlock).toBeNull();
  });

  it('records navigationBlock when the blocked request is a navigation (redirect SSRF)', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const { context, getHandler } = fakeContext();
    const state = await installSsrfGuard(context, log);
    const { route, request } = fakeRequest('http://internal.svc/', true);

    await getHandler()(route, request);

    expect(route.abort).toHaveBeenCalled();
    expect(state.navigationBlock).toEqual({ reason: 'blocked-host' });
  });

  it('blocks a literal private IP request', async () => {
    const { context, getHandler } = fakeContext();
    await installSsrfGuard(context, log);
    const { route, request } = fakeRequest('http://192.168.1.1/');

    await getHandler()(route, request);

    expect(route.abort).toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('blocks non-http(s) network schemes', async () => {
    const { context, getHandler } = fakeContext();
    await installSsrfGuard(context, log);
    const { route, request } = fakeRequest('ftp://example.com/file');

    await getHandler()(route, request);

    expect(route.abort).toHaveBeenCalled();
  });

  it('allows internal data: and about: schemes without DNS', async () => {
    const { context, getHandler } = fakeContext();
    await installSsrfGuard(context, log);

    for (const url of ['data:text/html,<p>hi', 'about:blank', 'blob:https://x/y']) {
      const { route, request } = fakeRequest(url);
      await getHandler()(route, request);
      expect(route.continue).toHaveBeenCalled();
    }
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('caches host decisions so repeat subresources do not re-resolve DNS', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const { context, getHandler } = fakeContext();
    await installSsrfGuard(context, log);
    const handler = getHandler();

    for (let i = 0; i < 3; i++) {
      const { route, request } = fakeRequest(`https://example.com/asset-${i}.js`);
      await handler(route, request);
      expect(route.continue).toHaveBeenCalled();
    }
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it('blocks an unparseable URL', async () => {
    const { context, getHandler } = fakeContext();
    await installSsrfGuard(context, log);
    const { route, request } = fakeRequest('::::not-a-url');

    await getHandler()(route, request);

    expect(route.abort).toHaveBeenCalled();
  });
});
