import { parseReport, prisma } from '@areyouagentic/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyDeleteToken } from '../lib/deleteToken.js';
import { HttpError } from '../plugins/errorHandler.js';

// Report ids are cuid2 (`@default(cuid(2))`) — lowercase alphanumeric, first
// char a letter. The bound also accepts legacy v1 cuids (`c…`) so reports
// created before the cuid2 switch still resolve. Validated before any DB query
// so a malformed id costs a regex match, not a round-trip.
const REPORT_ID_RE = /^[a-z][a-z0-9]{20,32}$/;

const paramsSchema = z.object({
  id: z.string().regex(REPORT_ID_RE, 'Invalid id format'),
});

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  // Explicit per-route rate limits (via config.rateLimit) on top of the global
  // 30/min/IP cap: reads are generous, the destructive delete stricter. Keeping
  // the limit on the route config co-locates it with the DB-touching handler.
  app.get(
    '/api/reports/:id',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (req) => `report-read:${req.ip}`,
        },
      },
    },
    async (req, reply) => {
      const params = paramsSchema.safeParse(req.params);
      if (!params.success) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid report id');
      }

      const row = await prisma.report.findUnique({ where: { id: params.data.id } });
      if (!row) {
        throw new HttpError(404, 'NOT_FOUND', 'Report not found');
      }

      // Reports are immutable once written — they're safe to cache for an hour
      // at any shared cache (CDN, browser).
      reply.header('Cache-Control', 'public, max-age=3600');

      return reply.send(parseReport(row));
    },
  );

  // Self-service deletion. No account: the caller proves ownership by
  // presenting the one-time delete token issued when the analysis was
  // submitted (we stored only its hash). Possession of the public report link
  // is NOT sufficient.
  app.delete(
    '/api/reports/:id',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (req) => `report-del:${req.ip}`,
        },
      },
    },
    async (req, reply) => {
      const params = paramsSchema.safeParse(req.params);
      if (!params.success) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid report id');
      }

      const header = req.headers['x-delete-token'];
      const token = Array.isArray(header) ? header[0] : header;
      if (!token) {
        throw new HttpError(401, 'DELETE_TOKEN_REQUIRED', 'A delete token is required');
      }

      const row = await prisma.report.findUnique({
        where: { id: params.data.id },
        select: { jobId: true, job: { select: { deleteTokenHash: true } } },
      });
      if (!row) {
        throw new HttpError(404, 'NOT_FOUND', 'Report not found');
      }

      if (!verifyDeleteToken(token, row.job.deleteTokenHash)) {
        // Same 403 whether the token is wrong or the report predates delete
        // tokens — don't reveal which.
        throw new HttpError(403, 'DELETE_FORBIDDEN', 'Invalid delete token');
      }

      // Deleting the job cascades to the report (FK onDelete: Cascade).
      await prisma.analysisJob.delete({ where: { id: row.jobId } });
      req.log.info({ reportId: params.data.id, jobId: row.jobId }, 'Report deleted by token');

      return reply.code(204).send();
    },
  );
}
