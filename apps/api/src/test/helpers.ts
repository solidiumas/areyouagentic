import { prisma } from '@areyouagentic/db';
import type { FastifyInstance } from 'fastify';
import { closeAnalysisQueue, createRedisConnection } from '../lib/queue.js';
import { closeRateLimitRedis, getRateLimitRedis } from '../lib/rateLimiter.js';
import { buildServer } from '../server.js';

/**
 * Build a fresh server for a test file. Tests should call this once in
 * `beforeAll` and close it in `afterAll`. Sharing one app across cases inside
 * a file keeps things fast; truncating between cases keeps them isolated.
 */
export async function buildTestServer(): Promise<FastifyInstance> {
  return buildServer();
}

/** Wipe rows that tests touch. Run in `beforeEach` for clean slate semantics. */
export async function resetDatabase(): Promise<void> {
  // Report has FK ON DELETE CASCADE → deleting jobs nukes reports too, but
  // wipe explicitly so a partial test run can't leave orphans behind.
  await prisma.report.deleteMany();
  await prisma.analysisJob.deleteMany();
}

/**
 * Flush the test Redis logical DB so rate-limit counters and BullMQ keys from
 * the previous test don't bleed into this one. Uses a one-off connection so
 * we don't poke the singletons the app owns.
 */
export async function resetRedis(): Promise<void> {
  const conn = createRedisConnection();
  try {
    await conn.flushdb();
  } finally {
    conn.disconnect();
  }
}

export async function closeTestServer(app: FastifyInstance): Promise<void> {
  await app.close();
  await Promise.allSettled([
    closeAnalysisQueue(),
    closeRateLimitRedis(),
    prisma.$disconnect(),
  ]);
}

/**
 * Each test gets a unique simulated client IP so the global per-IP rate limit
 * doesn't intermittently 429 a parallel test. fastify-rate-limit reads from
 * `req.ip`, which `trustProxy` derives from `x-forwarded-for`.
 */
export function uniqueIpHeader(): { 'x-forwarded-for': string } {
  // Use a deterministic-but-test-scoped pattern in 203.0.113.0/24 (TEST-NET-3).
  const last = Math.floor(Math.random() * 250) + 1;
  return { 'x-forwarded-for': `203.0.113.${last}` };
}

/** Awaits a fact about the rate-limit Redis to confirm the test env is alive. */
export async function pingRedis(): Promise<boolean> {
  try {
    return (await getRateLimitRedis().ping()) === 'PONG';
  } catch {
    return false;
  }
}
