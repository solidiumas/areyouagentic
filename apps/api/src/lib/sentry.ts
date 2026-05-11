import { env, isProd } from './env.js';
import { logger } from './logger.js';

/**
 * Initialize Sentry if SENTRY_DSN is configured. We import dynamically so
 * the SDK only adds startup cost (and a dependency cost) when it's actually
 * enabled. The `beforeSend` hook strips obvious PII before events leave the
 * process — IPs, Authorization/Cookie headers, request bodies, the lot.
 */
export async function initSentry(): Promise<void> {
  if (!env.SENTRY_DSN) {
    logger.info('Sentry disabled (no SENTRY_DSN)');
    return;
  }

  try {
    // Resolve via a string so tsc doesn't try to type-check the module —
    // we ship without the dependency installed in some environments, and
    // the dynamic check at the top of this function gates execution.
    const moduleName = '@sentry/node';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry: any = await import(/* @vite-ignore */ moduleName);
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      release: env.SENTRY_RELEASE,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE ?? (isProd ? 0.1 : 0),
      // Belt-and-braces — we also redact via beforeSend, but turn off the
      // built-in PII collection so nothing slips through the integrations.
      sendDefaultPii: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeSend(event: any) {
        return scrubEvent(event);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeSendTransaction(event: any) {
        return scrubEvent(event);
      },
    });
    logger.info({ env: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV }, 'Sentry initialized');
  } catch (err) {
    logger.warn({ err }, 'Sentry init failed — continuing without it');
  }
}

const PII_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

/**
 * Remove anything that could be PII or a credential from an event. We err on
 * the side of dropping data — debugging from a redacted event is annoying,
 * leaking customer data is worse.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scrubEvent(event: any): any {
  if (!event || typeof event !== 'object') return event;

  // Strip user object — we don't intentionally set one, but a downstream
  // integration may try to attach the request IP.
  if (event.user) {
    delete event.user.ip_address;
    delete event.user.email;
    delete event.user.username;
  }

  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers && typeof event.request.headers === 'object') {
      for (const key of Object.keys(event.request.headers)) {
        if (PII_HEADERS.has(key.toLowerCase())) {
          event.request.headers[key] = '[REDACTED]';
        }
      }
    }
    // Query strings often contain ids — keep the path, drop the query.
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = '[REDACTED]';
    }
  }

  return event;
}

/**
 * Capture a thrown value with Sentry if it's initialized. No-op otherwise.
 * Safe to call from anywhere — we never want a Sentry call to throw.
 */
export async function captureException(err: unknown, context?: Record<string, unknown>): Promise<void> {
  if (!env.SENTRY_DSN) return;
  try {
    // Resolve via a string so tsc doesn't try to type-check the module —
    // we ship without the dependency installed in some environments, and
    // the dynamic check at the top of this function gates execution.
    const moduleName = '@sentry/node';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry: any = await import(/* @vite-ignore */ moduleName);
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // Swallow — error reporting must never break the caller.
  }
}
