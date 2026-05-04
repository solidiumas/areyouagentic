import type { AnalysisContext, Stage } from '../context.js';

/**
 * STUB. Will eventually:
 *   - GET the target URL with a sane UA, follow redirects, capture finalUrl
 *   - GET /robots.txt
 *   - GET /llms.txt
 *   - GET /sitemap.xml (or whatever sitemap robots.txt advertises)
 * The three auxiliary fetches are independent of the main HTML and of each
 * other, so they're started in parallel.
 */
export const fetchStage: Stage = async (ctx: AnalysisContext) => {
  ctx.log.debug('fetch stub: returning mock html + auxiliary docs');

  const [rawHtml, robotsTxt, llmsTxt, sitemapXml] = await Promise.all([
    Promise.resolve('<!doctype html><html><body>stub</body></html>'),
    Promise.resolve(null),
    Promise.resolve(null),
    Promise.resolve(null),
  ]);

  return { ...ctx, rawHtml, robotsTxt, llmsTxt, sitemapXml };
};
