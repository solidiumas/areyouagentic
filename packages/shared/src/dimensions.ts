import { z } from 'zod';

export const dimensionSchema = z.enum([
  'machineReadability',
  'structuredData',
  'agentSignals',
  'actionability',
  'performance',
  'contentClarity',
]);

export type Dimension = z.infer<typeof dimensionSchema>;

export const DIMENSIONS: readonly Dimension[] = dimensionSchema.options;

export const gradeSchema = z.enum(['A', 'B', 'C', 'D', 'F']);
export type Grade = z.infer<typeof gradeSchema>;

export const scoreSchema = z.number().int().min(0).max(100);
