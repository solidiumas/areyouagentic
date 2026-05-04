import { pino, type LoggerOptions } from 'pino';
import { env, isProd, isTest } from './env.js';

const baseOptions: LoggerOptions = {
  level: env.LOG_LEVEL ?? (isProd ? 'info' : isTest ? 'warn' : 'debug'),
  base: { app: 'worker' },
  redact: {
    paths: ['*.password', '*.token', '*.apiKey'],
    censor: '[REDACTED]',
  },
};

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

export const logger = pino(loggerOptions);
