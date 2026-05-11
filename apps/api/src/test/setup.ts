// Vitest setup file. Runs before any test module is imported, so this is the
// only safe place to populate process.env for env.ts to validate.
//
// The env vars TEST_DATABASE_URL / TEST_REDIS_URL are honored if present,
// letting CI point tests at an isolated Postgres schema and Redis logical DB.
// In dev, they default to local docker-compose values that match the project
// README — running `docker compose up` is enough to run these tests locally.

/** Treat empty strings as unset — `DATABASE_URL=` in a parent shell would
 * otherwise short-circuit a `??`-style default. */
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
  // logical DB 15 — a conventional "scratch" db, kept off the default 0.
  'redis://localhost:6379/15',
)!;

// Note: ANTHROPIC_API_KEY is intentionally NOT set here. The API service must
// never accept or rely on it — only the worker process talks to Anthropic.
process.env.APP_URL = pick(process.env.APP_URL, 'http://localhost:3000')!;
process.env.PORT = pick(process.env.PORT, '4000')!;
