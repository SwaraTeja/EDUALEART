import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/helpers/env.ts'],
    // Integration tests share one PostgreSQL database, so run files one at a time.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
