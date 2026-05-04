import { JobStatus, prisma } from '@areyouagentic/db';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ANALYSIS_QUEUE_NAME,
  type AnalysisJobPayload,
  createRedisConnection,
} from '../lib/queue.js';
import { createAnalysisWorker } from '../worker.js';

const SAMPLE_URL = 'https://example.com/worker-e2e';

/**
 * End-to-end smoke test: enqueue a job, let the worker (with stub stages)
 * process it, assert the AnalysisJob row ends up COMPLETED with a Report.
 *
 * Requires Postgres + Redis on the URLs in src/test/setup.ts — same as the
 * API integration tests.
 */
describe('worker pipeline (stubs) — e2e', () => {
  let queue: Queue<AnalysisJobPayload>;
  let workerHandle: ReturnType<typeof createAnalysisWorker>;

  beforeAll(async () => {
    // Fresh queue + worker per file. Both use their own Redis connections
    // so closing one doesn't yank the rug from the other.
    queue = new Queue<AnalysisJobPayload>(ANALYSIS_QUEUE_NAME, {
      connection: createRedisConnection(),
    });
    workerHandle = createAnalysisWorker();
    // BullMQ's Worker starts processing as soon as it's constructed; wait for
    // the connection to be ready before enqueueing so the first job isn't
    // racing the worker's bootstrap.
    await workerHandle.worker.waitUntilReady();
  });

  afterAll(async () => {
    await workerHandle.worker.close();
    workerHandle.connection.disconnect();
    const queueConn = await queue.client;
    await queue.close();
    queueConn.disconnect();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Reset the BullMQ keyspace so a stuck job from the previous test can't
    // bleed into this one. Using flushdb against the test logical DB only.
    const conn = createRedisConnection();
    try {
      await conn.flushdb();
    } finally {
      conn.disconnect();
    }
    await prisma.report.deleteMany();
    await prisma.analysisJob.deleteMany();
  });

  it('runs the pipeline end-to-end and marks the job COMPLETED', async () => {
    const dbJob = await prisma.analysisJob.create({
      data: {
        url: SAMPLE_URL,
        normalizedUrl: SAMPLE_URL,
        status: JobStatus.PENDING,
      },
    });

    await queue.add(
      'analyze',
      { jobId: dbJob.id, url: SAMPLE_URL, normalizedUrl: SAMPLE_URL },
      { jobId: dbJob.id, attempts: 1 },
    );

    // Poll the DB until the worker reports a terminal state. Timeout matches
    // the test runner so a hang surfaces as a clean assertion failure.
    const terminalStatuses: JobStatus[] = [JobStatus.COMPLETED, JobStatus.FAILED];
    const deadline = Date.now() + 20_000;
    let final: { status: JobStatus; errorMessage: string | null } | null = null;
    while (Date.now() < deadline) {
      const row = await prisma.analysisJob.findUnique({
        where: { id: dbJob.id },
        select: { status: true, errorMessage: true },
      });
      if (row && terminalStatuses.includes(row.status)) {
        final = row;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(final, 'job did not reach a terminal state in time').not.toBeNull();
    expect(final?.errorMessage).toBeNull();
    expect(final?.status).toBe(JobStatus.COMPLETED);

    const report = await prisma.report.findUnique({ where: { jobId: dbJob.id } });
    expect(report).not.toBeNull();
    expect(report?.overallScore).toBeGreaterThanOrEqual(0);
    expect(report?.overallScore).toBeLessThanOrEqual(100);
    expect(report?.finalUrl).toBe(SAMPLE_URL);
  });
});
