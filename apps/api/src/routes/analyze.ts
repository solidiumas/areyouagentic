import {
  analyzeRequestSchema,
  maskSensitiveUrl,
  validateAnalyzableUrl,
  type UrlValidationReason,
} from '@areyouagentic/shared';
import { JobStatus, Prisma, prisma } from '@areyouagentic/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createDeleteToken } from '../lib/deleteToken.js';
import { urlDedupKey } from '../lib/normalizeUrl.js';
import { enqueueAnalysis } from '../lib/queue.js';
import { ANALYZE_PER_DAY, ANALYZE_PER_MINUTE } from '../lib/rateLimiter.js';
import { turnstileEnabled, verifyTurnstileToken } from '../lib/turnstile.js';
import { HttpError } from '../plugins/errorHandler.js';

/**
 * Bot gate. No-op unless TURNSTILE_SECRET_KEY is configured; when it is, a
 * valid `cf-turnstile-response` token is required. Runs after the rate limiter
 * so a flood is rejected cheaply before we ever call Cloudflare.
 */
async function turnstileGuard(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!turnstileEnabled()) return;
  const header = req.headers['cf-turnstile-response'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token) {
    throw new HttpError(400, 'TURNSTILE_REQUIRED', 'Captcha verification is required');
  }
  if (!(await verifyTurnstileToken(token, req.ip))) {
    throw new HttpError(403, 'TURNSTILE_FAILED', 'Captcha verification failed');
  }
}

/**
 * How old a PENDING/RUNNING job may be and still dedupe a fresh request.
 * This must comfortably exceed the worst-case analysis lifetime — 3 BullMQ
 * attempts × 90s job timeout + exponential backoff — or slow analyses stop
 * deduping mid-run and spawn duplicate work. The cap exists only so an
 * orphaned row (process died between create and enqueue) can't block a URL
 * forever.
 */
const ACTIVE_JOB_MAX_AGE_MS = 15 * 60 * 1000;

/** Window during which a completed report's job id is returned as cached. */
const COMPLETED_CACHE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Retry a serializable transaction that lost a write-conflict race (Prisma
 * P2034). Two concurrent submits of the same URL both pass the dedupe reads;
 * serializable isolation aborts one instead of letting both insert — the
 * retry re-runs the dedupe and returns the winner's row.
 */
async function withSerializableRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const conflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
      if (!conflict || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}

/** Map url-validator reasons to client-facing messages. The reason code is
 * also returned in `details.reason` so the web app can localize. */
const REASON_MESSAGES: Record<UrlValidationReason, string> = {
  'invalid-url': 'URL could not be parsed',
  'unsupported-protocol': 'Only http and https URLs are allowed',
  'embedded-credentials': 'URLs with embedded credentials are not allowed',
  'blocked-hostname': 'This hostname is not allowed',
  'loopback-ip': 'Loopback addresses are not allowed',
  'private-ip': 'Private network addresses are not allowed',
  'link-local': 'Link-local addresses are not allowed',
  'reserved-ip': 'Reserved IP ranges are not allowed',
};

type AnalyzeResponseBody = {
  jobId: string;
  cached?: true;
  /** One-time delete token — only on a freshly created job, never on dedupe. */
  deleteToken?: string;
};

export async function analyzeRoutes(app: FastifyInstance): Promise<void> {
  // Per-day cap layered on top of the per-route per-minute cap. Hitting either
  // ceiling produces a 429 with the standard error envelope.
  const dailyLimiter = app.rateLimit({
    max: ANALYZE_PER_DAY.max,
    timeWindow: ANALYZE_PER_DAY.timeWindow,
    keyGenerator: (req) => `analyze-day:${req.ip}`,
  });

  app.post(
    '/api/analyze',
    {
      config: {
        rateLimit: {
          max: ANALYZE_PER_MINUTE.max,
          timeWindow: ANALYZE_PER_MINUTE.timeWindow,
          keyGenerator: (req) => `analyze-min:${req.ip}`,
        },
      },
      // Reaffirm the 10kb body cap; we only ever accept a JSON URL.
      bodyLimit: 10 * 1024,
      preHandler: [dailyLimiter, turnstileGuard],
    },
    async (req, reply) => {
      const parseResult = analyzeRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', {
          issues: parseResult.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
        });
      }

      const ssrf = validateAnalyzableUrl(parseResult.data.url);
      if (!ssrf.ok) {
        throw new HttpError(422, 'URL_NOT_ALLOWED', REASON_MESSAGES[ssrf.reason], {
          reason: ssrf.reason,
        });
      }

      const url = ssrf.url.toString();
      // SHA-256 of the normalized URL — the plaintext (which can carry
      // secret-bearing query params) is never persisted. See urlDedupKey.
      const normalizedUrl = urlDedupKey(ssrf.url);
      const now = Date.now();

      const { token: deleteToken, hash: deleteTokenHash } = createDeleteToken();

      // Dedupe + create runs as ONE serializable transaction: the naive
      // check-then-create is a TOCTOU race where two concurrent submits of
      // the same URL both pass the reads and both insert. Serializable
      // isolation makes the loser abort (P2034) and retry into the dedupe
      // branch instead.
      type DedupeOutcome =
        | { kind: 'in-flight' | 'cached'; jobId: string }
        | { kind: 'created'; jobId: string };

      const outcome = await withSerializableRetry<DedupeOutcome>(() =>
        prisma.$transaction(
          async (tx) => {
            // 1) In-flight dedupe — any active job for this URL young enough
            //    to plausibly still be worked on.
            const inFlight = await tx.analysisJob.findFirst({
              where: {
                normalizedUrl,
                status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
                createdAt: { gte: new Date(now - ACTIVE_JOB_MAX_AGE_MS) },
              },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            });
            if (inFlight) return { kind: 'in-flight', jobId: inFlight.id };

            // 2) Completed-cache dedupe — return the most recent COMPLETED
            //    job's id inside the 24h window with `cached: true`.
            const cached = await tx.analysisJob.findFirst({
              where: {
                normalizedUrl,
                status: JobStatus.COMPLETED,
                completedAt: { gte: new Date(now - COMPLETED_CACHE_WINDOW_MS) },
              },
              orderBy: { completedAt: 'desc' },
              select: { id: true },
            });
            if (cached) return { kind: 'cached', jobId: cached.id };

            // 3) Fresh job — insert the PENDING row. Persist a masked copy of
            //    the URL (secrets in query params redacted): the row is
            //    retained for 90 days and the report derived from it is
            //    public. The *real* URL goes only on the ephemeral queue
            //    payload, which is what the worker actually fetches.
            const job = await tx.analysisJob.create({
              data: {
                url: maskSensitiveUrl(url),
                normalizedUrl,
                status: JobStatus.PENDING,
                deleteTokenHash,
              },
              select: { id: true },
            });
            return { kind: 'created', jobId: job.id };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );

      if (outcome.kind === 'in-flight') {
        req.log.info(
          { jobId: outcome.jobId, normalizedUrl, dedupe: 'in-flight' },
          'Reusing in-flight analysis job',
        );
        return reply.code(202).send({ jobId: outcome.jobId } satisfies AnalyzeResponseBody);
      }
      if (outcome.kind === 'cached') {
        req.log.info(
          { jobId: outcome.jobId, normalizedUrl, dedupe: 'completed-cache' },
          'Returning cached analysis job',
        );
        return reply
          .code(200)
          .send({ jobId: outcome.jobId, cached: true } satisfies AnalyzeResponseBody);
      }

      const job = { id: outcome.jobId };

      try {
        await enqueueAnalysis({ jobId: job.id, url, normalizedUrl, requestId: req.id });
      } catch (enqueueErr) {
        // The row would otherwise dedupe future requests for the same URL —
        // mark it FAILED so the next caller can try again immediately.
        req.log.error({ err: enqueueErr, jobId: job.id }, 'Failed to enqueue analysis job');
        await prisma.analysisJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.FAILED,
            errorMessage: 'Failed to enqueue job',
            completedAt: new Date(),
          },
        });
        throw new HttpError(503, 'QUEUE_UNAVAILABLE', 'Analysis queue is unavailable');
      }

      req.log.info({ jobId: job.id, normalizedUrl }, 'Created analysis job');
      return reply.code(202).send({ jobId: job.id, deleteToken } satisfies AnalyzeResponseBody);
    },
  );
}
