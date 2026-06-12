import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  APP_URL: z.string().url(),

  // Optional log level — defaults differ per NODE_ENV (see logger.ts).
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  // Sentry is opt-in. Without a DSN the SDK never initializes.
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),

  // /api/metrics is gated by basic auth. Disabled entirely if either is unset.
  METRICS_USERNAME: z.string().min(1).optional(),
  METRICS_PASSWORD: z.string().min(1).optional(),

  // Cloudflare Turnstile. When set, POST /api/analyze requires a valid
  // `cf-turnstile-response` token. Unset (the default) disables the check so
  // local dev, CI, and curl keep working without a captcha.
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and freezes the process environment. Crashes immediately with a
 * human-readable diff of missing/invalid vars — we never want to start the
 * server with a half-configured env.
 */
function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

export const env: Env = loadEnv();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
