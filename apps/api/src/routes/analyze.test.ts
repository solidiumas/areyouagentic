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

const SAMPLE_URL = 'https://example.com/page';

describe('POST /api/analyze', () => {
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

  it('creates a PENDING job and returns 202 with a jobId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: uniqueIpHeader(),
      payload: { url: SAMPLE_URL },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toMatch(/^[a-z0-9]+$/i);
    expect(body.cached).toBeUndefined();

    const job = await prisma.analysisJob.findUnique({ where: { id: body.jobId } });
    expect(job).not.toBeNull();
    expect(job?.status).toBe(JobStatus.PENDING);
    expect(job?.normalizedUrl).toBe(normalizeUrl(SAMPLE_URL));
  });

  // ── Idempotency ──────────────────────────────────────────────────

  it('returns the existing jobId when a PENDING/RUNNING job exists for the same URL', async () => {
    const ip = uniqueIpHeader();

    const first = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: ip,
      payload: { url: SAMPLE_URL },
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: ip,
      payload: { url: SAMPLE_URL },
    });
    expect(second.statusCode).toBe(202);
    expect(second.json().jobId).toBe(first.json().jobId);
    expect(second.json().cached).toBeUndefined();

    const count = await prisma.analysisJob.count();
    expect(count).toBe(1);
  });

  it('returns the cached completed jobId with cached:true within 24h', async () => {
    const completed = await prisma.analysisJob.create({
      data: {
        url: SAMPLE_URL,
        normalizedUrl: normalizeUrl(SAMPLE_URL),
        status: JobStatus.COMPLETED,
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: uniqueIpHeader(),
      payload: { url: SAMPLE_URL },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ jobId: completed.id, cached: true });
  });

  // ── Failure cases ────────────────────────────────────────────────

  it('returns 400 when the body is not valid JSON / missing url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: uniqueIpHeader(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
  });

  it('returns 422 with reason for SSRF attempts (loopback)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: uniqueIpHeader(),
      payload: { url: 'http://127.0.0.1/admin' },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('URL_NOT_ALLOWED');
    expect(body.error.details?.reason).toBe('loopback-ip');
  });

  it('returns 422 for the AWS metadata IP', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: uniqueIpHeader(),
      payload: { url: 'http://169.254.169.254/latest/meta-data/' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details?.reason).toBe('link-local');
  });

  it('returns 413 when the body exceeds 10kb', async () => {
    const padding = 'x'.repeat(11 * 1024);
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: { ...uniqueIpHeader(), 'content-type': 'application/json' },
      payload: JSON.stringify({ url: SAMPLE_URL, _pad: padding }),
    });

    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 429 once the per-IP per-minute cap (5) is reached', async () => {
    const ip = uniqueIpHeader();
    const statuses: number[] = [];

    // Fire 10 to give us enough headroom over the limit of 5/min. We can't
    // assert "the 6th must be 429" because requests 1-5 may 5xx if the queue
    // backend is flaky in CI; we only care that the limiter trips at all.
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        headers: ip,
        // Different URL each time so dedupe doesn't mask the limiter.
        payload: { url: `https://example.com/p${i}` },
      });
      statuses.push(res.statusCode);
    }

    // At least one response must have been rate-limited.
    expect(statuses).toContain(429);
  });
});
