import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { USER_AGENT, TIMEOUTS } from '@areyouagentic/shared';
import { PermanentJobError } from '../context.js';
import type { AnalysisContext, Stage } from '../context.js';
import {
  assertNavigableUrl,
  installSsrfGuard,
  BLOCKED_TARGET_MESSAGE,
  type SsrfGuardState,
} from '../../lib/safeBrowsing.js';

export const renderStage: Stage = async (ctx: AnalysisContext): Promise<AnalysisContext> => {
  let numRequests = 0;
  let pageSize = 0;

  // SSRF gate #1: validate + DNS-resolve the target before we launch a browser
  // at it. A directly-private or rebinding target fails fast and permanently
  // with a leak-free message (the resolved IP stays in the server log only).
  const nav = await assertNavigableUrl(ctx.url);
  if (!nav.ok) {
    ctx.log.warn(
      { reason: nav.reason, detail: nav.message },
      'render: target blocked pre-navigation',
    );
    if (nav.reason === 'dns-failed') {
      // Transient — let BullMQ retry rather than burning the permanent path.
      throw new Error('render: DNS resolution failed');
    }
    throw new PermanentJobError(BLOCKED_TARGET_MESSAGE);
  }

  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const context: BrowserContext = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
    });

    // SSRF gate #2: re-validate every request the browser makes — main
    // navigation, redirect hops, and JS-driven subresources. This is what
    // closes the render-path SSRF gap (Chromium otherwise resolves DNS and
    // follows redirects itself, bypassing safeFetch entirely).
    const guard: SsrfGuardState = await installSsrfGuard(context, ctx.log);

    const page: Page = await context.newPage();

    page.setDefaultNavigationTimeout(TIMEOUTS.render);

    page.on('request', () => {
      numRequests++;
    });

    page.on('response', (response) => {
      const contentLength = response.headers()['content-length'];
      pageSize += contentLength ? parseInt(contentLength, 10) : 0;
    });

    const navStart = Date.now();
    await navigateGuarded(page, ctx.url, guard);
    const networkIdle = Date.now() - navStart;

    const timing = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = (performance.getEntriesByType as (type: string) => any[])('navigation')[0] as
        | { responseStart: number; domContentLoadedEventEnd: number }
        | undefined;
      return nav
        ? { ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd }
        : { ttfb: 0, dcl: 0 };
    });

    const renderedHtml = await page.content();

    const screenshotBytes = (await page.screenshot({ fullPage: true, type: 'png' })) as Buffer;

    const performanceMetrics = {
      ttfb: timing.ttfb,
      pageSize,
      numRequests,
      domContentLoaded: timing.dcl,
      networkIdle,
    };

    ctx.log.info(
      { ttfb: performanceMetrics.ttfb, pageSize, numRequests, networkIdle },
      'render stage complete',
    );

    return {
      ...ctx,
      renderedHtml,
      screenshotBytes,
      performanceMetrics,
    };
  } finally {
    await browser.close();
  }
};

/**
 * Navigate with the SSRF guard active. Tries `networkidle` first and falls
 * back to `domcontentloaded` on timeout — but if the guard aborted the
 * navigation (a redirect into a blocked range), convert that into a permanent,
 * leak-free failure instead of retrying or surfacing a raw browser error.
 */
async function navigateGuarded(page: Page, url: string, guard: SsrfGuardState): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUTS.render });
  } catch {
    if (guard.navigationBlock) throw new PermanentJobError(BLOCKED_TARGET_MESSAGE);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.render });
    } catch (err2) {
      if (guard.navigationBlock) throw new PermanentJobError(BLOCKED_TARGET_MESSAGE);
      throw err2;
    }
  }
}
