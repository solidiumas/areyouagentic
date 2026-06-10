export { prisma } from './client.js';
export { parseReport } from './parse.js';
export type { AnalysisJob, Report } from './types.js';

// Re-export Prisma's generated runtime helpers + types.
//
// At RUNTIME, @prisma/client ships as CommonJS, so Node's ESM loader can't
// pull named exports out of it via the bare `export { X } from 'cjs'` form
// ("Named export 'JobStatus' not found"). Import the default export and
// destructure the runtime values, then re-export those bindings.
import pkg from '@prisma/client';
const { JobStatus, Prisma } = pkg;
export { JobStatus, Prisma };

// Types are erased before runtime, so the CJS/ESM constraint above doesn't
// apply to them — re-export directly.
//
// - PrismaTypes carries the Prisma.* namespace (e.g. PrismaTypes.InputJsonValue),
//   which the destructured `Prisma` value binding does NOT expose as types.
// - The `JobStatus` type alias merges with the `JobStatus` value export above,
//   so consumers can use the name in both value and type positions — exactly
//   like a TS enum.
import type { $Enums } from '@prisma/client';
export type { PrismaClient, Prisma as PrismaTypes } from '@prisma/client';
export type JobStatus = $Enums.JobStatus;
