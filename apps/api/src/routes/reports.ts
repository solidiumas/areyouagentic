import { parseReport, prisma } from '@areyouagentic/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../plugins/errorHandler.js';

// See routes/jobs.ts for the rationale on this regex.
const CUID_RE = /^c[a-z0-9]{20,32}$/;

const paramsSchema = z.object({
  id: z.string().regex(CUID_RE, 'Invalid id format'),
});

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reports/:id', async (req, reply) => {
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
  });
}
