import { createServer, type Server } from 'node:http';
import { prisma } from '@areyouagentic/db';
import type { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Tiny in-process HTTP server so the orchestrator (Fly.io / Railway / k8s)
 * has something to point a liveness/readiness probe at. The worker has no
 * HTTP surface of its own — we deliberately don't pull in Fastify just for
 * this; `node:http` is enough.
 *
 * Endpoints:
 *   - GET /live   — always 200 once the process is up (liveness)
 *   - GET /ready  — 200 if DB + Redis are reachable, 503 otherwise (readiness)
 *   - GET /health — alias for /ready, kept for parity with the API
 */
export function createHealthServer(redis: Redis): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';

    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method-not-allowed' }));
      return;
    }

    if (url === '/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (url === '/health' || url === '/ready') {
      // Don't await inside the listener — node:http handlers can be sync. We
      // resolve the readiness check then write the response.
      void checkReadiness(redis).then((result) => {
        res.writeHead(result.healthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: result.healthy ? 'ok' : 'degraded', checks: result.checks }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not-found' }));
  });

  server.listen(env.HEALTH_PORT, '0.0.0.0', () => {
    logger.info({ port: env.HEALTH_PORT }, 'health server listening');
  });

  return server;
}

async function checkReadiness(redis: Redis): Promise<{
  healthy: boolean;
  checks: Record<string, 'ok' | 'fail'>;
}> {
  const checks: Record<string, 'ok' | 'fail'> = {};
  let healthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'fail';
    healthy = false;
  }

  try {
    const pong = await redis.ping();
    checks.redis = pong === 'PONG' ? 'ok' : 'fail';
    if (checks.redis === 'fail') healthy = false;
  } catch {
    checks.redis = 'fail';
    healthy = false;
  }

  return { healthy, checks };
}

export async function closeHealthServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
