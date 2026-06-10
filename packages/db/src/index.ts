export { prisma } from './client.js';
export { parseReport } from './parse.js';
export type { AnalysisJob, Report } from './types.js';

// Re-export Prisma's generated runtime helpers + types.
//
// At RUNTIME, @prisma/client ships as CommonJS, so Node's ESM loader can't
// pull named exports out of it via the bare `export { X } from 'cjs'` form.
// We import the package as a default and destructure to get the values.
//
// At COMPILE time, we ALSO need the Prisma namespace (Prisma.InputJsonValue
// etc.) — and TypeScript drops namespace types when you go through a
// destructure binding. So we re-export the types side separately with a
// type-only re-export, which is erased at runtime and is therefore safe under
// the same CJS-in-ESM constraint that breaks the value side.
import pkg from '@prisma/client';
const { JobStatus, Prisma } = pkg;
export { JobStatus, Prisma };
export type { PrismaClient, Prisma as PrismaTypes } from '@prisma/client';
