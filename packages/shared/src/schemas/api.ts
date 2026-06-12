import { z } from 'zod';
import { jobStatusSchema } from '../job-status.js';
import { reportDataSchema } from './analysis.js';
import { urlSchema } from './url.js';

// ── POST /api/analyze ───────────────────────────────────────────────

export const analyzeRequestSchema = z.object({
  url: urlSchema,
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const analyzeResponseSchema = z.object({
  jobId: z.string().min(1),
  /** Present when an existing job/report was reused instead of creating one. */
  cached: z.literal(true).optional(),
  /** One-time delete token — present only on a freshly created job. */
  deleteToken: z.string().min(1).optional(),
});
export type AnalyzeResponse = z.infer<typeof analyzeResponseSchema>;

// ── GET /api/jobs/:id ───────────────────────────────────────────────

/** 0–100, monotonic. Workers report progress as they finish each analyzer. */
export const progressSchema = z.number().int().min(0).max(100);

export const jobStatusResponseSchema = z.object({
  id: z.string().min(1),
  status: jobStatusSchema,
  /** Present once the worker picks the job up. Absent for PENDING jobs. */
  progress: progressSchema.optional(),
  /** Set on COMPLETED jobs once a Report row exists. */
  reportId: z.string().min(1).optional(),
  /** Set on FAILED jobs. Safe-to-display message — no stack traces. */
  errorMessage: z.string().optional(),
});
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;

// ── GET /api/reports/:id ────────────────────────────────────────────

export const reportResponseSchema = reportDataSchema;
export type ReportResponse = z.infer<typeof reportResponseSchema>;

// ── Errors ──────────────────────────────────────────────────────────

/**
 * Common error envelope. Endpoints should return this on 4xx/5xx so clients
 * can render a single error component instead of branching on status codes.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
