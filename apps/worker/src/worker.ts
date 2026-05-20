import { UnrecoverableError, Worker, type Job, type WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import {
  ANALYSIS_QUEUE_NAME,
  type AnalysisJobPayload,
  createRedisConnection,
} from './lib/queue.js';
import { captureException } from './lib/sentry.js';
import { runAnalysis } from './pipeline/runAnalysis.js';
import { PermanentJobError } from './pipeline/context.js';

export type AnalysisWorker = {
  worker: Worker<AnalysisJobPayload>;
  connection: Redis;
};

const DEFAULT_WORKER_OPTIONS: Pick<
  WorkerOptions,
  'concurrency' | 'lockDuration' | 'stalledInterval' | 'maxStalledCount'
> = {
  // Hard timeout in env.ts is 90s — give the lock 95s of breathing room so a
  // job that's about to be force-killed isn't also flagged stalled mid-flight.
  lockDuration: 95_000,
  // Re-check stalled jobs every 30s. BullMQ will resurface them up to
  // maxStalledCount times; after that they're moved to failed.
  stalledInterval: 30_000,
  maxStalledCount: 1,
};

/**
 * Build (but don't start) a BullMQ Worker for the analysis queue. Caller owns
 * the lifecycle — call `worker.close()` and `connection.disconnect()` on
 * shutdown. Returning the connection separately lets the host close it after
 * the worker has drained.
 */
export function createAnalysisWorker(): AnalysisWorker {
  const connection = createRedisConnection();

  const worker = new Worker<AnalysisJobPayload>(
    ANALYSIS_QUEUE_NAME,
    async (job: Job<AnalysisJobPayload>) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        // Hard timeout: race the pipeline against a deadline. BullMQ doesn't
        // enforce per-job wall-clock limits itself, so we do it here.
        await Promise.race([
          runAnalysis(job),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Job timed out after ${env.JOB_TIMEOUT_MS}ms`)),
              env.JOB_TIMEOUT_MS,
            );
          }),
        ]);
      } catch (err) {
        // Permanent failures bypass retries. The runAnalysis pipeline has
        // already updated the AnalysisJob row to FAILED at this point.
        if (err instanceof PermanentJobError) {
          throw new UnrecoverableError(err.message);
        }
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    {
      connection,
      concurrency: env.WORKER_CONCURRENCY,
      ...DEFAULT_WORKER_OPTIONS,
    },
  );

  worker.on('active', (job) => {
    logger.info({ jobId: job.id, attempt: job.attemptsMade + 1 }, 'job active');
  });
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'job completed');
  });
  worker.on('failed', (job, err) => {
    // Permanent errors → tell BullMQ not to retry. We do this by re-wrapping
    // through UnrecoverableError. BullMQ also recognises errors thrown as
    // UnrecoverableError directly; we throw PermanentJobError from stages so
    // the rest of the codebase doesn't need to import BullMQ's error types.
    logger.error({ jobId: job?.id, err, attemptsMade: job?.attemptsMade }, 'job failed');
    // Only report to Sentry once retries are exhausted — flapping jobs would
    // otherwise produce spam. `attemptsMade >= attempts` means BullMQ won't
    // try again.
    const exhausted =
      job && typeof job.attemptsMade === 'number' && job.attemptsMade >= (job.opts.attempts ?? 1);
    if (exhausted || err instanceof UnrecoverableError) {
      void captureException(err, { jobId: job?.id, attemptsMade: job?.attemptsMade });
    }
  });
  worker.on('error', (err) => {
    logger.error({ err }, 'worker error');
  });
  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'job stalled — will be retried');
  });

  return { worker, connection };
}
