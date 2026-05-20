import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestServer, closeTestServer, resetDatabase, resetRedis } from '../test/helpers.js';

describe('GET /health', () => {
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

  it('returns 200 with checks when DB and Redis are reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.checks).toMatchObject({ database: 'ok', redis: 'ok' });
  });

  it('echoes the inbound x-request-id', async () => {
    const requestId = 'test-rid-abc-123';
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': requestId },
    });

    expect(res.headers['x-request-id']).toBe(requestId);
  });

  it('is exempt from the global rate limit', async () => {
    // Global default is 30/min/IP. Hammer the endpoint past that — none should 429.
    const responses = await Promise.all(
      Array.from({ length: 35 }, () =>
        app.inject({
          method: 'GET',
          url: '/health',
          headers: { 'x-forwarded-for': '203.0.113.99' },
        }),
      ),
    );

    const statuses = responses.map((r) => r.statusCode);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('returns 404 for unknown routes via the standard error envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/no-such-route' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });
});
