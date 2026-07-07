import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './env.js';
import { withTimeout } from './withTimeout.js';

export const ANALYSIS_QUEUE_NAME = 'analysis';

export type AnalysisJobPayload = {
  jobId: string;
  url: string;
  normalizedUrl: string;
  // The originating HTTP request id, propagated through the queue so worker
  // logs can be joined to API logs for a single user-initiated flow.
  requestId?: string;
};

/**
 * Payload for a `cleanup-screenshots` job. The API holds no R2 credentials
 * (they're deliberately worker-only), so user-initiated report deletion hands
 * the orphaned object keys to the worker instead of deleting them itself.
 */
export type CleanupScreenshotsPayload = {
  screenshotKeys: string[];
  requestId?: string;
};

export type QueueJobPayload = AnalysisJobPayload | CleanupScreenshotsPayload;

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
};

/**
 * Creates an ioredis connection configured for BullMQ. BullMQ requires
 * `maxRetriesPerRequest: null` so blocking commands (BRPOPLPUSH) stay alive.
 * Each call returns a fresh connection — callers own its lifecycle.
 */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

let queueSingleton: Queue<QueueJobPayload> | null = null;
let queueConnection: Redis | null = null;

export function getAnalysisQueue(): Queue<QueueJobPayload> {
  if (!queueSingleton) {
    queueConnection = createRedisConnection();
    queueSingleton = new Queue<QueueJobPayload>(ANALYSIS_QUEUE_NAME, {
      connection: queueConnection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return queueSingleton;
}

export async function closeAnalysisQueue(): Promise<void> {
  if (queueSingleton) {
    await queueSingleton.close();
    queueSingleton = null;
  }
  if (queueConnection) {
    queueConnection.disconnect();
    queueConnection = null;
  }
}

/** Ceiling for a single enqueue round-trip. With `maxRetriesPerRequest:
 * null` a down Redis makes `queue.add` wait indefinitely; the route's
 * 503 QUEUE_UNAVAILABLE path only works if the call actually fails. */
const ENQUEUE_TIMEOUT_MS = 5_000;

export async function enqueueAnalysis(payload: AnalysisJobPayload): Promise<void> {
  const queue = getAnalysisQueue();
  // Use the DB job id as the BullMQ job id so the worker can correlate
  // back to the AnalysisJob row, and so duplicate enqueue attempts are no-ops
  // — which also makes a timed-out-but-eventually-successful add harmless.
  await withTimeout(
    queue.add('analyze', payload, { jobId: payload.jobId }),
    ENQUEUE_TIMEOUT_MS,
    'enqueueAnalysis',
  );
}

export async function enqueueScreenshotCleanup(payload: CleanupScreenshotsPayload): Promise<void> {
  const queue = getAnalysisQueue();
  await withTimeout(
    queue.add('cleanup-screenshots', payload),
    ENQUEUE_TIMEOUT_MS,
    'enqueueScreenshotCleanup',
  );
}
