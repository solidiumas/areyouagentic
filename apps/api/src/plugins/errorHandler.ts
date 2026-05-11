import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { isProd } from '../lib/env.js';
import { captureException } from '../lib/sentry.js';

/**
 * Domain error with a stable machine-readable code and an HTTP status.
 * Routes throw these instead of building reply payloads inline so the error
 * handler can format every failure the same way.
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

type ErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

function buildPayload(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ErrorPayload {
  const payload: ErrorPayload = { error: { code, message } };
  if (details) payload.error.details = details;
  return payload;
}

/**
 * Translate any thrown value into the standard `{ error: { code, message } }`
 * envelope. Logs 5xx as `error`, 4xx as `warn`, never leaks stack traces in
 * production — clients see a generic message for unexpected errors.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    // Domain errors — trusted message, structured code.
    if (err instanceof HttpError) {
      const log = err.statusCode >= 500 ? req.log.error : req.log.warn;
      log.call(req.log, { err, statusCode: err.statusCode, code: err.code }, err.message);
      return reply
        .code(err.statusCode)
        .send(buildPayload(err.code, err.message, err.details));
    }

    // A ZodError reaching the handler means an internal `.parse()` blew up —
    // request-body validation goes through `HttpError` with safeParse, so this
    // path is reserved for invariant violations (e.g. drifted JSONB columns).
    if (err instanceof ZodError) {
      req.log.error({ err, issues: err.issues }, 'Internal data validation error');
      return reply
        .code(500)
        .send(
          buildPayload(
            'INTERNAL_ERROR',
            isProd ? 'An internal error occurred' : `Data validation failed: ${err.message}`,
          ),
        );
    }

    // Fastify-attached validation errors (schemas wired to a route).
    if (err.validation) {
      req.log.warn({ err, validation: err.validation }, 'Validation error');
      return reply.code(400).send(
        buildPayload('VALIDATION_ERROR', err.message || 'Request validation failed', {
          issues: err.validation,
        }),
      );
    }

    // Body-too-large is a Fastify built-in; surface it as 413 with our envelope.
    if (err.statusCode === 413) {
      req.log.warn({ err }, 'Payload too large');
      return reply
        .code(413)
        .send(buildPayload('PAYLOAD_TOO_LARGE', 'Request body is too large'));
    }

    // Trust a 4xx Fastify status code (e.g. 400, 401) — those messages are
    // authored, not caller-controlled. Treat anything else as an internal error.
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, 'Unhandled error');
      void captureException(err, { requestId: req.id, method: req.method, url: req.url });
      return reply
        .code(500)
        .send(
          buildPayload(
            'INTERNAL_ERROR',
            isProd ? 'An internal error occurred' : err.message || 'An internal error occurred',
          ),
        );
    }

    req.log.warn({ err, statusCode: status }, err.message);
    return reply
      .code(status)
      .send(buildPayload(err.code || 'BAD_REQUEST', err.message || 'Bad request'));
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    req.log.warn({ url: req.url, method: req.method }, 'Route not found');
    return reply
      .code(404)
      .send(buildPayload('NOT_FOUND', `Route ${req.method} ${req.url} not found`));
  });
}
