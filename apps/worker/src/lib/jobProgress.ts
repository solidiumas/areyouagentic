import type { Job } from 'bullmq';

/**
 * Stage → progress percentage. Read by GET /api/jobs/:id, so the values are a
 * lightweight contract with the API surface — keep them monotonic and don't
 * skip backwards.
 */
export const STAGE_PROGRESS = {
  queued: 0,
  fetch: 10,
  render: 30,
  analyze: 50,
  score: 70,
  persist: 90,
  done: 100,
} as const;

export type Stage = keyof typeof STAGE_PROGRESS;

/**
 * Update BullMQ job progress. Swallows errors — progress is observability,
 * not correctness. A failed Redis write here must not crash the pipeline.
 */
export async function setProgress(job: Job, stage: Stage): Promise<void> {
  try {
    await job.updateProgress(STAGE_PROGRESS[stage]);
  } catch {
    // Best-effort. The DB row remains the source of truth for status.
  }
}
