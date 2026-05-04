import { z } from 'zod';

export const jobStatusSchema = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']);
export type JobStatus = z.infer<typeof jobStatusSchema>;
