import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Integration tests share a Postgres+Redis pair via TEST_DATABASE_URL /
    // TEST_REDIS_URL. Running files in parallel would race on those resources,
    // so serialize file execution but keep within-file describe blocks fast.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    setupFiles: ['./src/test/setup.ts'],
  },
});
