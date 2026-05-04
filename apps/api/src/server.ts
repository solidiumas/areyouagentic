import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { loggerOptions } from './lib/logger.js';
import { registerGlobalRateLimit } from './lib/rateLimiter.js';
import { registerCors } from './plugins/cors.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerHelmet } from './plugins/helmet.js';
import { analyzeRoutes } from './routes/analyze.js';
import { healthRoutes } from './routes/health.js';
import { jobsRoutes } from './routes/jobs.js';
import { reportsRoutes } from './routes/reports.js';

/**
 * Build a fully-wired Fastify instance. Used both by the entry point and
 * the test harness — keeping the wiring in one place means tests exercise
 * the same plugin chain that runs in production.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    // 10kb default body limit (overridable per-route). We only ever take URLs.
    bodyLimit: 10 * 1024,
    trustProxy: true,
    disableRequestLogging: false,
    // Use the inbound x-request-id when present, otherwise mint a UUIDv4 so
    // every log line and response carries a correlation id.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128) {
        return incoming;
      }
      return randomUUID();
    },
  });

  // Echo the request id back so callers can quote it when reporting issues.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Plugins — order matters: helmet first (security headers on every reply,
  // including errors), then cors, then rate-limit, then app-level handlers.
  await registerHelmet(app);
  await registerCors(app);
  await registerGlobalRateLimit(app);

  registerErrorHandler(app);

  await app.register(healthRoutes);
  await app.register(analyzeRoutes);
  await app.register(jobsRoutes);
  await app.register(reportsRoutes);

  return app;
}
