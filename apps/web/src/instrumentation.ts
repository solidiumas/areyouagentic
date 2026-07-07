/**
 * Next.js instrumentation hook. With @sentry/nextjs v8 on Next 15 the
 * sentry.server/edge config files are NOT picked up automatically — they must
 * be imported from register(), or server-component and route-handler errors
 * never reach Sentry.
 */
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

// Captures errors from nested React Server Components, which don't hit the
// client-side error boundaries.
export const onRequestError = Sentry.captureRequestError;
