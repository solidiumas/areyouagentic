import {
  actionabilityAnalyzer,
  agentSignalsAnalyzer,
  contentClarityAnalyzer,
  machineReadabilityAnalyzer,
  performanceAnalyzer,
  structuredDataAnalyzer,
  type AnalysisInput,
  type AnalyzerResult,
} from '@areyouagentic/analyzers';
import { GRADE_THRESHOLDS, SCORE_WEIGHTS, type Dimension, type Grade } from '@areyouagentic/shared';
import { llmAnalyze, llmConfigured } from '../../lib/llm.js';
import type { AnalysisContext, Stage } from '../context.js';

function requireField<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) {
    throw new Error(`analyze: ctx.${name} missing — pipeline ordering bug`);
  }
  return value;
}

/**
 * Mirror of score-stage logic, but run here so the LLM gets the same grade the
 * user will see. score-stage will compute these again — they're idempotent and
 * the cost is microscopic next to the LLM call.
 */
function quickGrade(findings: Record<Dimension, AnalyzerResult>): {
  overall: number;
  grade: Grade;
} {
  const weighted =
    findings.machineReadability.score * SCORE_WEIGHTS.machineReadability +
    findings.structuredData.score * SCORE_WEIGHTS.structuredData +
    findings.agentSignals.score * SCORE_WEIGHTS.agentSignals +
    findings.actionability.score * SCORE_WEIGHTS.actionability +
    findings.performance.score * SCORE_WEIGHTS.performance +
    findings.contentClarity.score * SCORE_WEIGHTS.contentClarity;
  const overall = Math.round(weighted);
  let grade: Grade = 'F';
  if (overall >= GRADE_THRESHOLDS.A) grade = 'A';
  else if (overall >= GRADE_THRESHOLDS.B) grade = 'B';
  else if (overall >= GRADE_THRESHOLDS.C) grade = 'C';
  else if (overall >= GRADE_THRESHOLDS.D) grade = 'D';
  return { overall, grade };
}

export const analyzeStage: Stage = async (ctx: AnalysisContext) => {
  const input: AnalysisInput = {
    url: ctx.url,
    finalUrl: requireField(ctx.finalUrl, 'finalUrl'),
    rawHtml: requireField(ctx.rawHtml, 'rawHtml'),
    renderedHtml: requireField(ctx.renderedHtml, 'renderedHtml'),
    robotsTxt: ctx.robotsTxt ?? null,
    llmsTxt: ctx.llmsTxt ?? null,
    sitemapXml: ctx.sitemapXml ?? null,
    performanceMetrics: requireField(ctx.performanceMetrics, 'performanceMetrics'),
  };

  const findings: Record<Dimension, AnalyzerResult> = {
    machineReadability: machineReadabilityAnalyzer(input),
    structuredData: structuredDataAnalyzer(input),
    agentSignals: agentSignalsAnalyzer(input),
    actionability: actionabilityAnalyzer(input),
    performance: performanceAnalyzer(input),
    contentClarity: contentClarityAnalyzer(input),
  };

  const totalFindings =
    findings.machineReadability.findings.length +
    findings.structuredData.findings.length +
    findings.agentSignals.findings.length +
    findings.actionability.findings.length +
    findings.performance.findings.length +
    findings.contentClarity.findings.length;

  ctx.log.info(
    {
      machineReadability: findings.machineReadability.score,
      structuredData: findings.structuredData.score,
      agentSignals: findings.agentSignals.score,
      actionability: findings.actionability.score,
      performance: findings.performance.score,
      contentClarity: findings.contentClarity.score,
      totalFindings,
    },
    'deterministic analysis complete',
  );

  // LLM narrative on top — only if a key is configured. We compute a quick
  // overall grade so the prompt carries the same signal the user will see in
  // the report header.
  let llmInsight = null;
  if (llmConfigured()) {
    const { overall, grade } = quickGrade(findings);
    const topFindings = Object.values(findings)
      .flatMap((r) => r.findings)
      .filter((f) => f.severity === 'high' || f.severity === 'medium')
      .slice(0, 8)
      .map((f) => ({ id: f.id, severity: f.severity, title: f.title }));

    llmInsight = await llmAnalyze(
      {
        dimensionScores: {
          machineReadability: findings.machineReadability.score,
          structuredData: findings.structuredData.score,
          agentSignals: findings.agentSignals.score,
          actionability: findings.actionability.score,
          performance: findings.performance.score,
          contentClarity: findings.contentClarity.score,
        },
        overall,
        grade,
        pageTitle: ctx.pageTitle ?? null,
        finalUrl: ctx.finalUrl ?? ctx.url,
        topFindings,
        hasRobotsTxt: Boolean(ctx.robotsTxt),
        hasLlmsTxt: Boolean(ctx.llmsTxt),
        hasSitemap: Boolean(ctx.sitemapXml),
      },
      ctx.log,
    );
  } else {
    ctx.log.info('llm not configured — skipping narrative');
  }

  return { ...ctx, findings, llmInsight };
};
