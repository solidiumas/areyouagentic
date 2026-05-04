// Vitest setup for the worker package. Runs before any test module is
// imported so env.ts can validate process.env. Mirrors apps/api/src/test/setup.ts
// — TEST_DATABASE_URL / TEST_REDIS_URL override the docker-compose defaults
// in CI.

const pick = (...candidates: Array<string | undefined>): string | undefined => {
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return undefined;
};

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = pick(process.env.LOG_LEVEL, 'silent')!;

process.env.DATABASE_URL = pick(
  process.env.TEST_DATABASE_URL,
  process.env.DATABASE_URL,
  'postgresql://areyouagentic:areyouagentic@localhost:5432/areyouagentic?schema=test',
)!;

process.env.REDIS_URL = pick(
  process.env.TEST_REDIS_URL,
  process.env.REDIS_URL,
  'redis://localhost:6379/15',
)!;

process.env.ANTHROPIC_API_KEY = pick(process.env.ANTHROPIC_API_KEY, 'sk-ant-test-placeholder')!;

// Tighter timeout in tests so a stuck pipeline fails fast rather than waiting
// the full 90s. Concurrency=1 keeps test ordering predictable.
process.env.JOB_TIMEOUT_MS = pick(process.env.JOB_TIMEOUT_MS, '15000')!;
process.env.WORKER_CONCURRENCY = pick(process.env.WORKER_CONCURRENCY, '1')!;
