import { JobStatus, prisma } from '@areyouagentic/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizeUrl } from '../lib/normalizeUrl.js';
import {
  buildTestServer,
  closeTestServer,
  resetDatabase,
  resetRedis,
  uniqueIpHeader,
} from '../test/helpers.js';

const SAMPLE_URL = 'https://example.com/jobs-test';

describe('GET /api/jobs/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await closeTestServer(app);
  });

  beforeEach(async () => {
    await resetRedis();
    await resetDatabase();
  });

  // ── Happy path ────────────────────────────────────────────────────

  it('returns a PENDING job', async () => {
    const job = await prisma.analysisJob.create({
      data: {
        url: SAMPLE_URL,
        normalizedUrl: normalizeUrl(SAMPLE_URL),
        status: JobStatus.PENDING,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/jobs/${job.id}`,
      headers: uniqueIpHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: job.id,
      status: 'PENDING',
    });
    expect(res.json().progress).toBeUndefined();
  });

  it('exposes reportId for COMPLETED jobs', async () => {
    const job = await prisma.analysisJob.create({
      data: {
        url: SAMPLE_URL,
        normalizedUrl: normalizeUrl(SAMPLE_URL),
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
    const report = await prisma.report.create({
      data: {
        jobId: job.id,
        overallScore: 85,
        grade: 'B',
        machineReadabilityScore: 80,
        structuredDataScore: 85,
        agentSignalsScore: 90,
        actionabilityScore: 80,
        performanceScore: 85,
        contentClarityScore: 90,
        findings: [],
        recommendations: [],
        evidence: [],
        finalUrl: SAMPLE_URL,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/jobs/${job.id}`,
      headers: uniqueIpHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: job.id,
      status: 'COMPLETED',
      reportId: report.id,
    });
  });

  // ── Failure cases ────────────────────────────────────────────────

  it('returns 404 when the job id does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs/does-not-exist-123',
      headers: uniqueIpHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });

  it('exposes errorMessage for FAILED jobs', async () => {
    const job = await prisma.analysisJob.create({
      data: {
        url: SAMPLE_URL,
        normalizedUrl: normalizeUrl(SAMPLE_URL),
        status: JobStatus.FAILED,
        errorMessage: 'fetch failed: ETIMEDOUT',
        completedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/jobs/${job.id}`,
      headers: uniqueIpHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: job.id,
      status: 'FAILED',
      errorMessage: 'fetch failed: ETIMEDOUT',
    });
  });
});
