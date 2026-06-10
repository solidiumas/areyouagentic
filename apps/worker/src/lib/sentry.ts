import { env, isProd } from './env.js';
import { logger } from './logger.js';

/**
 * Mirror of apps/api/src/lib/sentry.ts. Initialize Sentry if SENTRY_DSN is
 * configured. Dynamic import keeps Sentry off the hot path for envs that
 * don't use it (local dev, tests).
 */
export async function initSentry(): Promise<void> {
  if (!env.SENTRY_DSN) {
    logger.info('Sentry disabled (no SENTRY_DSN)');
    return;
  }

  try {
    const moduleName = '@sentry/node';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry: any = await import(/* @vite-ignore */ moduleName);
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      release: env.SENTRY_RELEASE,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE ?? (isProd ? 0.1 : 0),
      sendDefaultPii: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeSend(event: any) {
        return scrubEvent(event);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeSendTransaction(event: any) {
        return scrubEvent(event);
      },
      initialScope: { tags: { app: 'worker' } },
    });
    logger.info({ env: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV }, 'Sentry initialized');
  } catch (err) {
    logger.warn({ err }, 'Sentry init failed — continuing without it');
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scrubEvent(event: any): any {
  if (!event || typeof event !== 'object') return event;
  if (event.user) {
    delete event.user.ip_address;
    delete event.user.email;
    delete event.user.username;
  }
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
  }
  // The worker doesn't process URLs we control, so strip the analyzed
  // target URL out of extras — it can still be looked up by jobId server-side.
  if (event.extra && typeof event.extra === 'object') {
    if ('url' in event.extra) event.extra.url = '[REDACTED]';
  }
  return event;
}

export async function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  if (!env.SENTRY_DSN) return;
  try {
    const moduleName = '@sentry/node';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry: any = await import(/* @vite-ignore */ moduleName);
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // Reporting must never break the caller.
  }
}
