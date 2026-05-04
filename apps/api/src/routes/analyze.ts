import {
  analyzeRequestSchema,
  validateAnalyzableUrl,
  type UrlValidationReason,
} from '@areyouagentic/shared';
import { JobStatus, prisma } from '@areyouagentic/db';
import type { FastifyInstance } from 'fastify';
import { normalizeUrl } from '../lib/normalizeUrl.js';
import { enqueueAnalysis } from '../lib/queue.js';
import { ANALYZE_PER_DAY, ANALYZE_PER_MINUTE } from '../lib/rateLimiter.js';
import { HttpError } from '../plugins/errorHandler.js';

/** Window during which an in-flight job dedupes a fresh request. */
const IN_FLIGHT_WINDOW_MS = 60 * 1000;

/** Window during which a completed report's job id is returned as cached. */
const COMPLETED_CACHE_WINDOW_MS = 24 * 60 * 60 * 1000;

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
      preHandler: dailyLimiter,
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
      const normalizedUrl = normalizeUrl(ssrf.url);
      const now = Date.now();

      // 1) In-flight dedupe — return the existing job id within the 60s window.
      const inFlight = await prisma.analysisJob.findFirst({
        where: {
          normalizedUrl,
          status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
          createdAt: { gte: new Date(now - IN_FLIGHT_WINDOW_MS) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (inFlight) {
        req.log.info(
          { jobId: inFlight.id, normalizedUrl, dedupe: 'in-flight' },
          'Reusing in-flight analysis job',
        );
        return reply.code(202).send({ jobId: inFlight.id } satisfies AnalyzeResponseBody);
      }

      // 2) Completed-cache dedupe — return the most recent COMPLETED job's id
      //    inside the 24h window with `cached: true`.
      const cached = await prisma.analysisJob.findFirst({
        where: {
          normalizedUrl,
          status: JobStatus.COMPLETED,
          completedAt: { gte: new Date(now - COMPLETED_CACHE_WINDOW_MS) },
        },
        orderBy: { completedAt: 'desc' },
      });
      if (cached) {
        req.log.info(
          { jobId: cached.id, normalizedUrl, dedupe: 'completed-cache' },
          'Returning cached analysis job',
        );
        return reply
          .code(200)
          .send({ jobId: cached.id, cached: true } satisfies AnalyzeResponseBody);
      }

      // 3) Fresh job — insert PENDING row, enqueue, return jobId.
      const job = await prisma.analysisJob.create({
        data: { url, normalizedUrl, status: JobStatus.PENDING },
        select: { id: true },
      });

      try {
        await enqueueAnalysis({ jobId: job.id, url, normalizedUrl });
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
      return reply.code(202).send({ jobId: job.id } satisfies AnalyzeResponseBody);
    },
  );
}
