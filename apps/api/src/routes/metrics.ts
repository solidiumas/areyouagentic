import { timingSafeEqual } from 'node:crypto';
import { JobStatus, Prisma, prisma } from '@areyouagentic/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../lib/env.js';

/**
 * Operational metrics, gated behind HTTP basic auth.
 *
 * Returns JSON (rather than Prometheus exposition format) — we don't yet run
 * a scraper, and JSON is easier to eyeball from `curl`. Swap to Prometheus
 * once a scraper is in place; the same numbers are easy to serialize either
 * way.
 *
 * Disabled entirely if METRICS_USERNAME or METRICS_PASSWORD is unset, so an
 * un-configured deploy never leaks anything.
 */

type StatusCounts = Record<JobStatus, number>;

type MetricsResponse = {
  generatedAt: string;
  jobs: {
    lastHour: {
      byStatus: StatusCounts;
      total: number;
      errorRate: number;
    };
    durationMs: {
      sampleSize: number;
      median: number | null;
      p95: number | null;
      p99: number | null;
    };
  };
  llmTokensLast24h: {
    input: number;
    output: number;
    note?: string;
  };
};

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  if (!env.METRICS_USERNAME || !env.METRICS_PASSWORD) {
    app.log.warn('METRICS_USERNAME / METRICS_PASSWORD not set — /api/metrics is disabled');
    return;
  }

  app.get(
    '/api/metrics',
    {
      // Metrics scrapers should never be rate-limited.
      config: { rateLimit: false },
      preHandler: async (req, reply) => {
        if (!verifyBasicAuth(req)) {
          return rejectUnauthorized(reply);
        }
      },
    },
    async (_req, reply) => {
      const payload = await collectMetrics();
      // Cache for 10s so we don't hammer Postgres if the scraper is chatty.
      reply.header('Cache-Control', 'private, max-age=10');
      return reply.send(payload);
    },
  );
}

function verifyBasicAuth(req: FastifyRequest): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice('Basic '.length).trim(), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  // timingSafeEqual to avoid leaking length/character mismatch timing.
  return safeEqual(user, env.METRICS_USERNAME ?? '') && safeEqual(pass, env.METRICS_PASSWORD ?? '');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual requires equal-length buffers — pad to the longer of the
  // two and still compare so the mismatch path doesn't short-circuit.
  const len = Math.max(ab.length, bb.length);
  const left = Buffer.alloc(len);
  const right = Buffer.alloc(len);
  ab.copy(left);
  bb.copy(right);
  return timingSafeEqual(left, right) && ab.length === bb.length;
}

function rejectUnauthorized(reply: FastifyReply): FastifyReply {
  reply.header('WWW-Authenticate', 'Basic realm="metrics"');
  return reply
    .code(401)
    .send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
}

async function collectMetrics(): Promise<MetricsResponse> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // ── Counts by status, last hour ─────────────────────────────────────
  const grouped = await prisma.analysisJob.groupBy({
    by: ['status'],
    where: { createdAt: { gte: hourAgo } },
    _count: { _all: true },
  });

  const byStatus: StatusCounts = {
    PENDING: 0,
    RUNNING: 0,
    COMPLETED: 0,
    FAILED: 0,
  };
  for (const row of grouped) byStatus[row.status] = row._count._all;
  const total = byStatus.COMPLETED + byStatus.FAILED + byStatus.PENDING + byStatus.RUNNING;
  const finished = byStatus.COMPLETED + byStatus.FAILED;
  const errorRate = finished === 0 ? 0 : byStatus.FAILED / finished;

  // ── Duration percentiles over completed jobs in the last hour ───────
  // We only consider COMPLETED jobs — FAILED durations skew the picture
  // because most failures abort fast. Computed in SQL via percentile_cont
  // (Postgres-only) to avoid pulling thousands of rows into the API.
  const durationRows = await prisma.$queryRaw<
    Array<{ p50: number | null; p95: number | null; p99: number | null; n: bigint }>
  >(Prisma.sql`
    SELECT
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000) AS p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000) AS p99,
      COUNT(*)::bigint AS n
    FROM "AnalysisJob"
    WHERE "status" = 'COMPLETED'
      AND "startedAt" IS NOT NULL
      AND "completedAt" IS NOT NULL
      AND "completedAt" >= ${hourAgo}
  `);
  const dur = durationRows[0] ?? { p50: null, p95: null, p99: null, n: 0n };

  // ── LLM tokens last 24h ─────────────────────────────────────────────
  // No usage table yet; the analyzer stages are stubs. Surface a placeholder
  // so the contract is stable for consumers, and a `note` so the operator
  // knows it's not real data. When the analyzer wires up real Anthropic
  // calls, write usage rows and sum them here.
  const llm = { input: 0, output: 0, note: 'not yet tracked — analyzer stubs in place' };

  return {
    generatedAt: now.toISOString(),
    jobs: {
      lastHour: { byStatus, total, errorRate: round(errorRate, 4) },
      durationMs: {
        sampleSize: Number(dur.n),
        median: dur.p50 != null ? Math.round(dur.p50) : null,
        p95: dur.p95 != null ? Math.round(dur.p95) : null,
        p99: dur.p99 != null ? Math.round(dur.p99) : null,
      },
    },
    llmTokensLast24h: llm,
  };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
