import type { FastifyInstance } from 'fastify';
import { prisma } from '@areyouagentic/db';
import { getRateLimitRedis } from '../lib/rateLimiter.js';
import { withTimeout } from '../lib/withTimeout.js';

/** A dependency that can't answer within this window is not ready — report
 * 503 instead of letting the probe itself hang past the orchestrator's own
 * timeout. */
const CHECK_TIMEOUT_MS = 2_000;

/**
 * Liveness + readiness probe used by the orchestrator. We deliberately fan
 * out to Postgres and Redis rather than returning 200 unconditionally — a
 * server that can answer HTTP but can't reach its dependencies is not ready.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      // Health checks must not be rate-limited; the orchestrator polls them.
      config: { rateLimit: false },
    },
    async (_req, reply) => {
      const checks: Record<string, 'ok' | 'fail'> = {};
      let healthy = true;

      try {
        await withTimeout(prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS, 'health:postgres');
        checks.database = 'ok';
      } catch {
        checks.database = 'fail';
        healthy = false;
      }

      try {
        const pong = await withTimeout(
          getRateLimitRedis().ping(),
          CHECK_TIMEOUT_MS,
          'health:redis',
        );
        checks.redis = pong === 'PONG' ? 'ok' : 'fail';
        if (checks.redis === 'fail') healthy = false;
      } catch {
        checks.redis = 'fail';
        healthy = false;
      }

      return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks });
    },
  );
}
