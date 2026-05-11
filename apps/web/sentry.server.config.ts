/**
 * Server-side Sentry init for the Next.js Node runtime (Route Handlers,
 * Server Components, API routes). Picked up by `@sentry/nextjs` automatically.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeSendTransaction(event) {
      return scrubEvent(event);
    },
  });
}

const PII_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

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
    if (event.request.headers && typeof event.request.headers === 'object') {
      for (const key of Object.keys(event.request.headers)) {
        if (PII_HEADERS.has(key.toLowerCase())) {
          event.request.headers[key] = '[REDACTED]';
        }
      }
    }
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = '[REDACTED]';
    }
  }
  return event;
}
