import { pino, type LoggerOptions } from 'pino';
import { env, isProd, isTest } from './env.js';

const baseOptions: LoggerOptions = {
  level: env.LOG_LEVEL ?? (isProd ? 'info' : isTest ? 'warn' : 'debug'),
  // Redact common credential-bearing fields so a stray log call can't leak
  // secrets. Add to this list rather than relying on call-site discipline.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
};

// pino-pretty is for humans tailing logs locally — production ships JSON to
// the log pipeline, and tests don't need decoration either.
export const loggerOptions: LoggerOptions =
  isProd || isTest
    ? baseOptions
    : {
        ...baseOptions,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      };

/**
 * Module-level logger for code outside the request lifecycle (queue producers,
 * env loading, shutdown hooks). Inside a route handler, use `request.log`
 * instead so entries are tagged with the request id.
 */
export const logger = pino(loggerOptions);
