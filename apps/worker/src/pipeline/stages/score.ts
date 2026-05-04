import type { AnalysisContext, Stage } from '../context.js';

/**
 * STUB. Will eventually compute a weighted score per dimension from
 * ctx.findings and roll it up into an overall 0-100 + letter grade.
 */
export const scoreStage: Stage = async (ctx: AnalysisContext) => {
  ctx.log.debug('score stub: returning mock weighted scores');
  return {
    ...ctx,
    scores: {
      overall: 75,
      grade: 'B',
      machineReadability: 75,
      structuredData: 75,
      agentSignals: 75,
      actionability: 75,
      performance: 75,
      contentClarity: 75,
    },
  };
};
