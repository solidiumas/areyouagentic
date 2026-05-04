import type { AnalysisContext, Stage } from '../context.js';

/**
 * STUB. Will eventually fan out to every analyzer in @areyouagentic/analyzers
 * (machineReadability, structuredData, agentSignals, ...) — each independent,
 * so they run as Promise.all and merge into ctx.findings keyed by dimension.
 */
export const analyzeStage: Stage = async (ctx: AnalysisContext) => {
  ctx.log.debug('analyze stub: returning mock findings per dimension');
  return {
    ...ctx,
    findings: {
      machineReadability: { items: [] },
      structuredData: { items: [] },
      agentSignals: { items: [] },
      actionability: { items: [] },
      performance: { items: [] },
      contentClarity: { items: [] },
    },
  };
};
