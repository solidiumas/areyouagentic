import type { BrowserContext, Route, Request as PlaywrightRequest } from 'playwright';
import type { Logger } from 'pino';
import { validateAnalyzableUrl } from '@areyouagentic/shared';
import { resolveHostnameSafely, BLOCKED_TARGET_MESSAGE } from './safeFetch.js';

// Re-exported so render-stage callers have a single import surface.
export { BLOCKED_TARGET_MESSAGE };

/**
 * SSRF defense for the Playwright render stage.
 *
 * `safeFetch` protects the *fetch* path, but the render stage navigates a real
 * headless browser to the target URL. Chromium does its own DNS resolution and
 * follows redirects automatically, so without a guard it bypasses every
 * safeFetch defense — DNS-rebinding, redirect-to-metadata, and JS-driven
 * `fetch()` to internal hosts all become reachable.
 *
 * This module re-applies the same two gates (URL-shape validation + DNS
 * classification of every resolved address) to *every* request the browser
 * makes: the main navigation, each redirect hop, and every subresource.
 */

/**
 * Schemes the renderer uses internally that never touch the network. We let
 * these through untouched so the page can render; none of them is an SSRF
 * vector (data:/blob: are in-memory, about: is a browser-internal page).
 */
const SAFE_INTERNAL_SCHEMES = new Set(['data:', 'blob:', 'about:']);

export type NavGuardResult = { ok: true } | { ok: false; reason: string; message: string };

/**
 * Validate a URL we are about to navigate a real browser to. Mirrors the
 * fetch-stage gate: URL-shape validation followed by DNS resolution with every
 * resolved address classified against blocked ranges. Call this before
 * `page.goto` so a directly-private target fails fast and permanently.
 */
export async function assertNavigableUrl(input: string): Promise<NavGuardResult> {
  const shape = validateAnalyzableUrl(input);
  if (!shape.ok) return { ok: false, reason: shape.reason, message: shape.message };

  const dns = await resolveHostnameSafely(shape.url.hostname);
  if (!dns.ok) return { ok: false, reason: dns.reason, message: dns.message };

  return { ok: true };
}

/**
 * Mutable state shared with the caller so the render stage can tell a blocked
 * navigation (turn into a permanent, leak-free failure) apart from an ordinary
 * network/timeout error.
 */
export type SsrfGuardState = {
  /** Total http(s) requests aborted by the guard (nav + subresources). */
  blockedRequests: number;
  /** Set when a top-level navigation (incl. a redirect hop) was blocked. */
  navigationBlock: { reason: string } | null;
};

/**
 * Install the SSRF guard on a browser context. Returns mutable state the
 * caller can inspect after navigation. Fails closed: anything we cannot prove
 * safe (unparseable URL, DNS failure, blocked range) is aborted.
 */
export async function installSsrfGuard(
  context: BrowserContext,
  log: Logger,
): Promise<SsrfGuardState> {
  const state: SsrfGuardState = { blockedRequests: 0, navigationBlock: null };

  // Cache host → allowed for the lifetime of this render so a page with many
  // subresources on the same host doesn't trigger a DNS lookup per request.
  // The window is short (one render, capped by TIMEOUTS.render); the
  // network-egress firewall is the backstop against in-render rebinding.
  const decisions = new Map<string, boolean>();

  const block = (route: Route, request: PlaywrightRequest, reason: string): Promise<void> => {
    state.blockedRequests += 1;
    if (request.isNavigationRequest()) state.navigationBlock = { reason };
    log.warn(
      { url: request.url(), reason, navigation: request.isNavigationRequest() },
      'ssrf-guard: blocked request',
    );
    return route.abort('blockedbyclient');
  };

  await context.route('**/*', async (route: Route, request: PlaywrightRequest) => {
    const rawUrl = request.url();

    let scheme: string;
    try {
      scheme = new URL(rawUrl).protocol;
    } catch {
      return block(route, request, 'unparseable-url');
    }

    if (SAFE_INTERNAL_SCHEMES.has(scheme)) return route.continue();

    const shape = validateAnalyzableUrl(rawUrl);
    if (!shape.ok) return block(route, request, shape.reason);

    const host = shape.url.hostname;
    let allowed = decisions.get(host);
    if (allowed === undefined) {
      const dns = await resolveHostnameSafely(host);
      allowed = dns.ok;
      decisions.set(host, allowed);
    }

    if (!allowed) return block(route, request, 'blocked-host');
    return route.continue();
  });

  return state;
}
