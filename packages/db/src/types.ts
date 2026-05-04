import type {
  AnalysisJob as PrismaAnalysisJob,
  Report as PrismaReport,
} from '@prisma/client';
import type { Evidence, Findings, Recommendations } from '@areyouagentic/shared';

export type AnalysisJob = PrismaAnalysisJob;

/**
 * Typed view of `Report` where the JSONB columns are narrowed to the Zod-
 * inferred shapes. Use the `parseReport` helper when reading from the DB to
 * validate rows against the current schema.
 */
export type Report = Omit<PrismaReport, 'findings' | 'recommendations' | 'evidence'> & {
  findings: Findings;
  recommendations: Recommendations;
  evidence: Evidence;
};
