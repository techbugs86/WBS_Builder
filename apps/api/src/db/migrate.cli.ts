// CLI entrypoint for `npm run migrate` and `npm run migrate:test`.
// Kept as a small wrapper because `tsx -e "..."` one-liners are awkward in
// package.json (escaping quotes across shells is brittle). This file just
// runs the migration and exits with a clean status code.
import { runMigrations } from './migrate.js';

try {
  await runMigrations();
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
