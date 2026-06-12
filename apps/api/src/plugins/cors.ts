import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { env, isProd } from '../lib/env.js';

/**
 * In production, only the configured APP_URL may call us. In dev/test we
 * allow any origin so curl, Postman, and the local web app on a different
 * port can hit the API without ceremony.
 *
 * `credentials: false` — the API is stateless and cookie-free (ownership is
 * proven with a bearer-style delete token, not a session cookie), so there's
 * no reason to let browsers send credentials cross-origin.
 */
export async function registerCors(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: isProd ? [env.APP_URL] : true,
    credentials: false,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Request-Id', 'x-delete-token', 'cf-turnstile-response'],
    maxAge: 600,
  });
}
