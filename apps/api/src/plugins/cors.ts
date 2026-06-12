import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { env, isProd } from '../lib/env.js';

/**
 * In production, only the configured APP_URL may call us. In dev/test we
 * allow any origin so curl, Postman, and the local web app on a different
 * port can hit the API without ceremony.
 */
export async function registerCors(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: isProd ? [env.APP_URL] : true,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Request-Id', 'x-delete-token'],
    maxAge: 600,
  });
}
