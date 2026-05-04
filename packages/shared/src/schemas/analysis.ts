import { z } from 'zod';
import { gradeSchema, scoreSchema } from '../dimensions.js';
import { evidenceSchema } from '../evidence.js';
import { findingsSchema } from '../findings.js';
import { recommendationsSchema } from '../recommendations.js';

// Per-analyzer outputs. They share `findingsSchema` today, but each is named
// distinctly so analyzer signatures stay precise — we can branch their shapes
// later without breaking callers.
export const machineReadabilityFindingsSchema = findingsSchema;
export type MachineReadabilityFindings = z.infer<typeof machineReadabilityFindingsSchema>;

export const structuredDataFindingsSchema = findingsSchema;
export type StructuredDataFindings = z.infer<typeof structuredDataFindingsSchema>;

export const agentSignalsFindingsSchema = findingsSchema;
export type AgentSignalsFindings = z.infer<typeof agentSignalsFindingsSchema>;

export const actionabilityFindingsSchema = findingsSchema;
export type ActionabilityFindings = z.infer<typeof actionabilityFindingsSchema>;

export const performanceFindingsSchema = findingsSchema;
export type PerformanceFindings = z.infer<typeof performanceFindingsSchema>;

export const contentClarityFindingsSchema = findingsSchema;
export type ContentClarityFindings = z.infer<typeof contentClarityFindingsSchema>;

/**
 * Per-dimension scores that mirror the columns on the `Report` Prisma model.
 * Kept as its own schema because we re-use it both inside ReportData and on
 * the API summary endpoint.
 */
export const dimensionScoresSchema = z.object({
  machineReadabilityScore: scoreSchema,
  structuredDataScore: scoreSchema,
  agentSignalsScore: scoreSchema,
  actionabilityScore: scoreSchema,
  performanceScore: scoreSchema,
  contentClarityScore: scoreSchema,
});
export type DimensionScores = z.infer<typeof dimensionScoresSchema>;

/**
 * Full report payload — matches the row shape we persist in `Report`. The
 * three JSON columns (`findings`, `recommendations`, `evidence`) keep their
 * structured Zod-validated shapes.
 */
export const reportDataSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),

    overallScore: scoreSchema,
    grade: gradeSchema,
  })
  .merge(dimensionScoresSchema)
  .extend({
    findings: findingsSchema,
    recommendations: recommendationsSchema,
    evidence: evidenceSchema,

    pageTitle: z.string().nullable().optional(),
    finalUrl: z.string().url(),

    createdAt: z.coerce.date(),
  });
export type ReportData = z.infer<typeof reportDataSchema>;
