import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { USER_AGENT, TIMEOUTS } from '@areyouagentic/shared';
import type { AnalysisContext, Stage } from '../context.js';

export const renderStage: Stage = async (ctx: AnalysisContext): Promise<AnalysisContext> => {
  let numRequests = 0;
  let pageSize = 0;

  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const context: BrowserContext = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
    });
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
    try {
      await page.goto(ctx.url, { waitUntil: 'networkidle', timeout: TIMEOUTS.render });
    } catch {
      // networkidle timed out or was unavailable — fall back to domcontentloaded
      await page.goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.render });
    }
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
