import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 90_000,
    setupFiles: ['./src/test/setup.ts'],
  },
});
