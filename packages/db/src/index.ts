export { prisma } from './client.js';
export { parseReport } from './parse.js';
export type { AnalysisJob, Report } from './types.js';

// Re-export Prisma's generated types and runtime helpers so consumers don't
// need a direct dependency on `@prisma/client`.
export { JobStatus, Prisma } from '@prisma/client';
export type { PrismaClient } from '@prisma/client';
