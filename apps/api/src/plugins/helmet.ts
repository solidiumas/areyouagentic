import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

/**
 * Security headers. We don't serve HTML from this API, so the strict default
 * CSP that helmet ships with is fine — clients only ever consume JSON.
 */
export async function registerHelmet(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
}
