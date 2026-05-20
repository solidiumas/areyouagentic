import type { AnalyzerResult } from '@areyouagentic/analyzers';
import { GRADE_THRESHOLDS, SCORE_WEIGHTS, type Dimension, type Grade } from '@areyouagentic/shared';
import type { AnalysisContext, Stage } from '../context.js';

function gradeFor(score: number): Grade {
  if (score >= GRADE_THRESHOLDS.A) return 'A';
  if (score >= GRADE_THRESHOLDS.B) return 'B';
  if (score >= GRADE_THRESHOLDS.C) return 'C';
  if (score >= GRADE_THRESHOLDS.D) return 'D';
  return 'F';
}

export const scoreStage: Stage = async (ctx: AnalysisContext) => {
  const f = ctx.findings as Record<Dimension, AnalyzerResult>;
  if (!f.machineReadability) {
    throw new Error('score: findings missing — pipeline ordering bug');
  }

  const machineReadability = f.machineReadability.score;
  const structuredData = f.structuredData.score;
  const agentSignals = f.agentSignals.score;
  const actionability = f.actionability.score;
  const performance = f.performance.score;
  const contentClarity = f.contentClarity.score;

  const weighted =
    machineReadability * SCORE_WEIGHTS.machineReadability +
    structuredData * SCORE_WEIGHTS.structuredData +
    agentSignals * SCORE_WEIGHTS.agentSignals +
    actionability * SCORE_WEIGHTS.actionability +
    performance * SCORE_WEIGHTS.performance +
    contentClarity * SCORE_WEIGHTS.contentClarity;

  const overall = Math.round(weighted);
  const grade = gradeFor(overall);

  ctx.log.info({ overall, grade }, 'score stage complete');

  return {
    ...ctx,
    scores: {
      overall,
      grade,
      machineReadability,
      structuredData,
      agentSignals,
      actionability,
      performance,
      contentClarity,
    },
  };
};
