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

const SAMPLE_URL = 'https://example.com/reports-test';

async function seedReport() {
  const job = await prisma.analysisJob.create({
    data: {
      url: SAMPLE_URL,
      normalizedUrl: normalizeUrl(SAMPLE_URL),
      status: JobStatus.COMPLETED,
      completedAt: new Date(),
    },
  });
  return prisma.report.create({
    data: {
      jobId: job.id,
      overallScore: 78,
      grade: 'B',
      machineReadabilityScore: 80,
      structuredDataScore: 75,
      agentSignalsScore: 82,
      actionabilityScore: 70,
      performanceScore: 85,
      contentClarityScore: 78,
      findings: [],
      recommendations: [],
      evidence: [],
      pageTitle: 'Example',
      finalUrl: SAMPLE_URL,
    },
  });
}

describe('GET /api/reports/:id', () => {
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

  it('returns the report with public Cache-Control set', async () => {
    const report = await seedReport();

    const res = await app.inject({
      method: 'GET',
      url: `/api/reports/${report.id}`,
      headers: uniqueIpHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
    expect(res.headers['cache-control']).toContain('max-age=3600');

    const body = res.json();
    expect(body).toMatchObject({
      id: report.id,
      jobId: report.jobId,
      overallScore: 78,
      grade: 'B',
      finalUrl: SAMPLE_URL,
      pageTitle: 'Example',
    });
    expect(body.findings).toEqual([]);
    expect(body.recommendations).toEqual([]);
    expect(body.evidence).toEqual([]);
  });

  // ── Failure cases ────────────────────────────────────────────────

  it('returns 404 when no report exists for that id (well-formed cuid)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/cl1234567890abcdef12345',
      headers: uniqueIpHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });

  it('returns 400 for malformed ids', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/not-a-cuid',
      headers: uniqueIpHeader(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('returns 500 when stored JSON columns drift from the schema', async () => {
    const job = await prisma.analysisJob.create({
      data: {
        url: SAMPLE_URL,
        normalizedUrl: normalizeUrl(SAMPLE_URL),
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
    // Deliberately wrong shape — `findings` should be an array. parseReport
    // will throw ZodError, which the central error handler maps to 500.
    const report = await prisma.report.create({
      data: {
        jobId: job.id,
        overallScore: 50,
        grade: 'C',
        machineReadabilityScore: 50,
        structuredDataScore: 50,
        agentSignalsScore: 50,
        actionabilityScore: 50,
        performanceScore: 50,
        contentClarityScore: 50,
        findings: { not: 'an array' },
        recommendations: [],
        evidence: [],
        finalUrl: SAMPLE_URL,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/reports/${report.id}`,
      headers: uniqueIpHeader(),
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
  });
});
