import type { AnalysisContext, Stage } from '../context.js';

/**
 * STUB. Will eventually launch a Playwright browser, navigate to ctx.url,
 * wait for network idle / a sensible quiescent signal, and capture both the
 * post-JS DOM (`renderedHtml`) and a screenshot.
 */
export const renderStage: Stage = async (ctx: AnalysisContext) => {
  ctx.log.debug('render stub: returning mock rendered html + screenshot');
  return {
    ...ctx,
    renderedHtml: ctx.rawHtml ?? '<!doctype html><html><body>stub</body></html>',
    screenshot: 'stub://screenshot.png',
  };
};
