import { randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@areyouagentic/db';
import type { AnalyzerResult } from '@areyouagentic/analyzers';
import type {
  Dimension,
  EvidenceItem,
  Finding,
  Recommendation,
} from '@areyouagentic/shared';
import { uploadScreenshot } from '../../lib/r2.js';
import type { AnalysisContext, Stage } from '../context.js';

const MAX_INLINE_BYTES = 64 * 1024;

function truncate(s: string): string {
  if (s.length <= MAX_INLINE_BYTES) return s;
  return s.slice(0, MAX_INLINE_BYTES) + '\n…[truncated]';
}

export const persistStage: Stage = async (ctx: AnalysisContext) => {
  if (!ctx.scores) {
    throw new Error('persist: scores missing — pipeline ordering bug');
  }

  const f = ctx.findings as Record<Dimension, AnalyzerResult>;

  const flatFindings: Finding[] = [
    ...f.machineReadability.findings,
    ...f.structuredData.findings,
    ...f.agentSignals.findings,
    ...f.actionability.findings,
    ...f.performance.findings,
    ...f.contentClarity.findings,
  ];

  const recommendations: Recommendation[] = flatFindings
    .map((finding) => finding.recommendation)
    .filter((r): r is Recommendation => r !== undefined);

  const capturedAt = new Date().toISOString();
  let screenshotUrl: string | undefined;

  if (ctx.screenshotBytes) {
    try {
      const key = `screenshots/${ctx.jobId}.png`;
      const result = await uploadScreenshot(key, ctx.screenshotBytes);
      if ('url' in result) screenshotUrl = result.url;
      else ctx.log.info('persist: R2 not configured — skipping screenshot upload');
    } catch (err) {
      ctx.log.warn({ err }, 'persist: screenshot upload failed — report saved without screenshot');
    }
  }

  const evidence: EvidenceItem[] = [];

  if (screenshotUrl) {
    evidence.push({
      id: randomUUID(),
      type: 'screenshot',
      url: screenshotUrl,
      contentType: 'image/png',
      capturedAt,
      description: 'Full-page screenshot captured during render stage',
    });
  }

  if (ctx.robotsTxt) {
    evidence.push({
      id: randomUUID(),
      type: 'robots-txt',
      inline: truncate(ctx.robotsTxt),
      contentType: 'text/plain',
      capturedAt,
    });
  }

  if (ctx.sitemapXml) {
    evidence.push({
      id: randomUUID(),
      type: 'sitemap',
      inline: truncate(ctx.sitemapXml),
      contentType: 'application/xml',
      capturedAt,
    });
  }

  if (ctx.llmsTxt) {
    evidence.push({
      id: randomUUID(),
      type: 'other',
      inline: truncate(ctx.llmsTxt),
      contentType: 'text/plain',
      capturedAt,
      description: 'llms.txt — agent-facing site guide',
    });
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
      findings: flatFindings as unknown as Prisma.InputJsonValue,
      recommendations: recommendations as unknown as Prisma.InputJsonValue,
      evidence: evidence as unknown as Prisma.InputJsonValue,
      pageTitle: ctx.pageTitle ?? null,
      finalUrl: ctx.finalUrl ?? ctx.url,
    },
  });

  ctx.log.info(
    { findings: flatFindings.length, recommendations: recommendations.length, evidence: evidence.length },
    'persist stage complete',
  );

  return { ...ctx, screenshot: screenshotUrl };
};
