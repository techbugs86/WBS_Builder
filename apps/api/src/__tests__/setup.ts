import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Test setup — runs ONCE before any test file is imported.
 *
 * Loads .env.test so the DB pool (in src/db/index.ts) connects to the
 * wbs_builder_test database, NOT your real wbs_builder. Without this, tests
 * would happily wipe your FreshFork / MediTrack / LawnLink projects.
 *
 * The path is resolved from this file's location so it works regardless of
 * where vitest is invoked from.
 */
loadDotenv({ path: resolve(__dirname, '..', '..', '.env.test') });

// Hard safety check: if for any reason the test runner is pointed at the
// production-shaped database name, abort immediately. This prevents the
// catastrophic "tests just dropped my real data" scenario.
const dbName = process.env['DB_NAME'];
if (!dbName || !dbName.endsWith('_test')) {
  // eslint-disable-next-line no-console
  console.error(
    `[test-setup] Refusing to run tests: DB_NAME="${dbName}" does not end with "_test".\n` +
    `             Tests should ONLY run against a database named *_test (e.g. wbs_builder_test).\n` +
    `             Check apps/api/.env.test.`,
  );
  process.exit(1);
}
