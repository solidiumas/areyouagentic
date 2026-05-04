import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { createRedisConnection } from './queue.js';

/**
 * Single Redis connection shared by every rate-limit instance the server
 * registers. Owned by this module — closed during graceful shutdown.
 */
let rateLimitRedis: Redis | null = null;

export function getRateLimitRedis(): Redis {
  if (!rateLimitRedis) rateLimitRedis = createRedisConnection();
  return rateLimitRedis;
}

export async function closeRateLimitRedis(): Promise<void> {
  if (rateLimitRedis) {
    rateLimitRedis.disconnect();
    rateLimitRedis = null;
  }
}

/**
 * Global default: 30 req/min per IP. Per-route overrides (POST /api/analyze)
 * are attached at the route level via `config.rateLimit`.
 */
export async function registerGlobalRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: 30,
    timeWindow: '1 minute',
    redis: getRateLimitRedis(),
    keyGenerator: (req: FastifyRequest) => req.ip,
    // Use the standard envelope so clients see the same shape on 429 as 4xx.
    errorResponseBuilder: (_req, context) => ({
      error: {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded, retry in ${context.after}`,
      },
    }),
  });
}

/**
 * Per-route configs for `@fastify/rate-limit`'s `config.rateLimit`. Defining
 * them here keeps the numbers in one place — easy to audit, easy to tune.
 */
export const ANALYZE_PER_MINUTE = {
  max: 5,
  timeWindow: '1 minute',
} as const;

export const ANALYZE_PER_DAY = {
  max: 20,
  timeWindow: '1 day',
} as const;
