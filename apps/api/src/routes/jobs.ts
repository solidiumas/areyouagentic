import { JobStatus, prisma } from '@areyouagentic/db';
import type { JobStatusResponse } from '@areyouagentic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAnalysisQueue } from '../lib/queue.js';
import { HttpError } from '../plugins/errorHandler.js';

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
});

export async function jobsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/jobs/:id', async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid job id');
    }

    const job = await prisma.analysisJob.findUnique({
      where: { id: params.data.id },
      include: { report: { select: { id: true } } },
    });
    if (!job) {
      throw new HttpError(404, 'NOT_FOUND', 'Job not found');
    }

    const response: JobStatusResponse = {
      id: job.id,
      status: job.status,
    };

    if (job.report) response.reportId = job.report.id;
    if (job.errorMessage) response.errorMessage = job.errorMessage;

    // Pull progress from BullMQ for jobs the worker has picked up. Falls back
    // silently if the queue can't tell us — the DB status is the source of truth.
    if (job.status === JobStatus.RUNNING) {
      try {
        const queue = getAnalysisQueue();
        const queueJob = await queue.getJob(job.id);
        const progress = queueJob?.progress;
        if (typeof progress === 'number' && Number.isFinite(progress)) {
          response.progress = Math.max(0, Math.min(100, Math.round(progress)));
        }
      } catch (err) {
        req.log.warn({ err, jobId: job.id }, 'Failed to read BullMQ progress');
      }
    }

    return reply.send(response);
  });
}
