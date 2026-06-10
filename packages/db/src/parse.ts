import { evidenceSchema, findingsSchema, recommendationsSchema } from '@areyouagentic/shared';
import type { Report as PrismaReport } from '@prisma/client';
import type { Report } from './types.js';

/**
 * Parses a raw Prisma `Report` row, validating the JSON columns against the
 * shared Zod schemas. Throws `ZodError` if a column has drifted from the
 * expected shape — that's almost always the right behavior, since silently
 * returning malformed data hides bugs.
 */
export function parseReport(row: PrismaReport): Report {
  return {
    ...row,
    findings: findingsSchema.parse(row.findings),
    recommendations: recommendationsSchema.parse(row.recommendations),
    evidence: evidenceSchema.parse(row.evidence),
  };
}
