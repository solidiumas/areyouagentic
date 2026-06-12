import { prisma } from '@areyouagentic/db';
import { env } from './lib/env.js';
import { closeHealthServer, createHealthServer } from './lib/health.js';
import { logger } from './lib/logger.js';
import { initSentry } from './lib/sentry.js';
import { createAnalysisWorker } from './worker.js';

/**
 * Worker entry point. Boots a single Worker instance and waits for SIGTERM /
 * SIGINT. On signal, stops accepting new jobs but lets in-flight ones finish
 * up to SHUTDOWN_GRACE_MS, then forces close.
 */

const SHUTDOWN_GRACE_MS = env.JOB_TIMEOUT_MS + 5_000;

async function main(): Promise<void> {
  await initSentry();

  logger.info(
    { concurrency: env.WORKER_CONCURRENCY, jobTimeoutMs: env.JOB_TIMEOUT_MS },
    'starting worker',
  );

  const { worker, connection } = createAnalysisWorker();
  const healthServer = createHealthServer(connection);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown signal received — draining worker');

    // worker.close() stops new jobs being picked up. Passing `false` here
    // lets active jobs finish; we cap that with our own timer below.
    const drain = worker.close();

    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), SHUTDOWN_GRACE_MS),
    );
    const outcome = await Promise.race([drain.then(() => 'drained' as const), timeout]);

    if (outcome === 'timeout') {
      logger.warn({ graceMs: SHUTDOWN_GRACE_MS }, 'shutdown grace exceeded — forcing close');
      // Force close the worker — any in-flight jobs will be reaped as stalled
      // and (depending on retries) re-picked-up by another instance.
      await worker.close(true).catch((err) => logger.error({ err }, 'force close failed'));
    } else {
      logger.info('worker drained cleanly');
    }

    await closeHealthServer(healthServer).catch((err) =>
      logger.error({ err }, 'health server close failed'),
    );
    connection.disconnect();
    await prisma
      .$disconnect()
      .catch((err: unknown) => logger.error({ err }, 'prisma disconnect failed'));

    process.exit(outcome === 'timeout' ? 1 : 0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
