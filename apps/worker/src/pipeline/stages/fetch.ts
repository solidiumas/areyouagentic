import { load } from 'cheerio';
import { TIMEOUTS } from '@areyouagentic/shared';
import { safeFetch } from '../../lib/safeFetch.js';
import { PermanentJobError } from '../context.js';
import type { AnalysisContext, Stage } from '../context.js';

function isPermanent(reason: string, status?: number): boolean {
  if (reason === 'invalid-url' || reason === 'blocked-host') return true;
  if (reason === 'http-error' && status !== undefined && status >= 400 && status < 500) return true;
  return false;
}

async function probe(url: string): Promise<string | null> {
  const result = await safeFetch(url, { timeoutMs: TIMEOUTS.probe });
  if (!result.ok) return null;
  return result.body.toString('utf8');
}

export const fetchStage: Stage = async (ctx: AnalysisContext) => {
  const mainResult = await safeFetch(ctx.url, { timeoutMs: TIMEOUTS.fetch });

  if (!mainResult.ok) {
    const { reason, message, status } = mainResult;
    if (isPermanent(reason, status)) {
      throw new PermanentJobError(`Fetch failed (${reason}): ${message}`);
    }
    throw new Error(`Fetch failed (${reason}): ${message}`);
  }

  const { finalUrl, body } = mainResult;
  const rawHtml = body.toString('utf8');

  const $ = load(rawHtml);
  const pageTitle = $('title').first().text().trim() || undefined;

  const origin = new URL(finalUrl).origin;

  const [robotsTxt, llmsTxt, sitemapXml] = await Promise.all([
    probe(`${origin}/robots.txt`),
    probe(`${origin}/llms.txt`),
    probe(`${origin}/sitemap.xml`),
  ]);

  ctx.log.info({
    finalUrl,
    responseBytes: body.length,
    hasRobots: robotsTxt !== null,
    hasLlmsTxt: llmsTxt !== null,
    hasSitemap: sitemapXml !== null,
  }, 'fetch stage complete');

  return { ...ctx, rawHtml, finalUrl, pageTitle, robotsTxt, llmsTxt, sitemapXml };
};
