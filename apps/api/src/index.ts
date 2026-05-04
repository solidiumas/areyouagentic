import { prisma } from '@areyouagentic/db';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { closeAnalysisQueue } from './lib/queue.js';
import { closeRateLimitRedis } from './lib/rateLimiter.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const app = await buildServer();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutdown initiated, draining connections');

    // Hard ceiling so a stuck connection can't block process exit forever.
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    try {
      // Stop accepting new connections, finish in-flight requests.
      await app.close();
      // Then close downstream resources owned by this process.
      await Promise.allSettled([
        closeAnalysisQueue(),
        closeRateLimitRedis(),
        prisma.$disconnect(),
      ]);
      logger.info('Shutdown complete');
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Shutdown error');
      clearTimeout(forceExit);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
