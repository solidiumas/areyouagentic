import { prisma } from '@areyouagentic/db';
import type { AnalysisContext, Stage } from '../context.js';

/**
 * STUB. Will eventually upload the screenshot + raw artifacts to R2, then
 * insert the Report row with findings/recommendations/evidence JSON. For now
 * we write the minimal Report needed to satisfy the FK constraint and let
 * the rest of the system see a COMPLETED job end-to-end.
 */
export const persistStage: Stage = async (ctx: AnalysisContext) => {
  ctx.log.debug('persist stub: writing minimal Report row');

  if (!ctx.scores) {
    throw new Error('persist: scores missing — pipeline ordering bug');
  }

  await prisma.report.create({
    data: {
      jobId: ctx.jobId,
      overallScore: ctx.scores.overall,
      grade: ctx.scores.grade,
      machineReadabilityScore: ctx.scores.machineReadability,
      structuredDataScore: ctx.scores.structuredData,
      agentSignalsScore: ctx.scores.agentSignals,
      actionabilityScore: ctx.scores.actionability,
      performanceScore: ctx.scores.performance,
      contentClarityScore: ctx.scores.contentClarity,
      findings: [],
      recommendations: [],
      evidence: [],
      finalUrl: ctx.url,
    },
  });

  return ctx;
};
