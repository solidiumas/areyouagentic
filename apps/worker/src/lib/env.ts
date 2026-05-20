import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  ANTHROPIC_API_KEY: z.string().min(1),

  // R2 (Cloudflare) — optional. If all five are set, persist uploads screenshots.
  // If any is missing the worker still runs; persist just stores the report
  // without an R2 screenshot URL. Keeps local dev painless.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

  // How many jobs a single worker process handles in parallel. Tune against
  // the cost of a Playwright render — going too high will OOM the box.
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),

  // Hard ceiling on a single job's wall-clock time. Anything longer is killed
  // and surfaced as FAILED. Keep in sync with the API's polling expectations.
  JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

  // Optional log level — defaults differ per NODE_ENV (see logger.ts).
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional(),

  // HTTP port for the in-process health server. The worker isn't an HTTP
  // service but the orchestrator needs a probe target — we bind a tiny
  // node:http server on this port to answer /health.
  HEALTH_PORT: z.coerce.number().int().positive().default(4001),

  // Sentry is opt-in. Without a DSN the SDK never initializes.
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid worker environment configuration:\n${issues}`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

export const env: Env = loadEnv();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
