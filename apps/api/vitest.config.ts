import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Load test DB credentials BEFORE any test file imports the db pool.
    // Without this, tests would accidentally hit wbs_builder (your real data).
    env: {
      NODE_ENV: 'test',
    },
    // Pull DB_HOST / DB_USER / DB_PASS / DB_NAME from .env.test at runtime.
    // This is the safety net: even if a developer forgets `--env-file`, vitest
    // loads it for them.
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    // Tests touch a shared MySQL database. Run them serially so concurrent
    // tests don't stomp on each other's data.
    fileParallelism: false,
    // Reasonable per-test timeout — most DB tests should finish in <1s.
    testTimeout: 10_000,
  },
});
