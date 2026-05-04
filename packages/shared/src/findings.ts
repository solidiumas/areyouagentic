import { z } from 'zod';
import { recommendationSchema } from './recommendations.js';

export const findingSeveritySchema = z.enum(['info', 'low', 'medium', 'high']);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

/**
 * A single check produced by an analyzer. `evidence` is an inline snippet
 * (HTML excerpt, header value, etc.) — large blobs go in the report-level
 * evidence list and are referenced from there.
 */
export const findingSchema = z.object({
  id: z.string().min(1),
  severity: findingSeveritySchema,
  title: z.string().min(1),
  description: z.string(),
  evidence: z.string().optional(),
  recommendation: recommendationSchema.optional(),
});
export type Finding = z.infer<typeof findingSchema>;

export const findingsSchema = z.array(findingSchema);
export type Findings = z.infer<typeof findingsSchema>;
