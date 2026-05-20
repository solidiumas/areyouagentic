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
import type { Dimension } from '@areyouagentic/shared';
import type { AnalysisContext, Stage } from '../context.js';

function requireField<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) {
    throw new Error(`analyze: ctx.${name} missing — pipeline ordering bug`);
  }
  return value;
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

  ctx.log.info(
    {
      machineReadability: findings.machineReadability.score,
      structuredData: findings.structuredData.score,
      agentSignals: findings.agentSignals.score,
      actionability: findings.actionability.score,
      performance: findings.performance.score,
      contentClarity: findings.contentClarity.score,
      totalFindings:
        findings.machineReadability.findings.length +
        findings.structuredData.findings.length +
        findings.agentSignals.findings.length +
        findings.actionability.findings.length +
        findings.performance.findings.length +
        findings.contentClarity.findings.length,
    },
    'analyze stage complete',
  );

  return { ...ctx, findings };
};
