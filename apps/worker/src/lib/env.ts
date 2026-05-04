import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  ANTHROPIC_API_KEY: z.string().min(1),

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
