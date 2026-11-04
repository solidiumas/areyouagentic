import { Redis } from 'ioredis';
import { env } from './env.js';

// Must match the producer in apps/api/src/lib/queue.ts. The two ends are
// intentionally not coupled at the type level — pulling a shared package in
// just for one constant would be overkill — so changes here need a matching
// edit on the producer side.
export const ANALYSIS_QUEUE_NAME = 'analysis';

// Every BullMQ key lives under one hash tag so a queue's keys land in the same
// cluster slot. Azure Managed Redis shards data behind a single endpoint, and
// BullMQ's multi-key Lua scripts fail with CROSSSLOT when keys span slots.
// Changing this orphans jobs already queued under the old prefix.
export const QUEUE_PREFIX = '{bull}';

export type AnalysisJobPayload = {
  jobId: string;
  url: string;
  normalizedUrl: string;
  // Origin HTTP request id from the API. Optional for backward compat with
  // jobs enqueued before the field was introduced.
  requestId?: string;
};

/**
 * Payload for a `cleanup-screenshots` job (job name distinguishes it from
 * `analyze` on the shared queue). Enqueued by the API when a user deletes a
 * report — the API holds no R2 credentials, so object deletion happens here.
 */
export type CleanupScreenshotsPayload = {
  screenshotKeys: string[];
  requestId?: string;
};

export type QueueJobPayload = AnalysisJobPayload | CleanupScreenshotsPayload;

/**
 * Creates an ioredis connection configured for BullMQ. BullMQ requires
 * `maxRetriesPerRequest: null` so blocking commands (BRPOPLPUSH) stay alive.
 */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
