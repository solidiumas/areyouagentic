/**
 * Browser-side Sentry init. `@sentry/nextjs` picks this file up at build time
 * via the auto-instrumentation it injects. Without NEXT_PUBLIC_SENTRY_DSN set
 * the SDK is a no-op.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    // Replays are off by default — they're the most likely vector for
    // accidentally capturing PII (input values, screenshots). Opt in
    // deliberately if needed.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeSendTransaction(event) {
      return scrubEvent(event);
    },
  });
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
  return event;
}
