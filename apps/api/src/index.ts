import 'dotenv/config';
import { app } from './app.js';
import { loadSettingsIntoEnv } from './bootstrap/loadSettings.js';
import { runMigrations } from './db/migrate.js';

const PORT = parseInt(process.env['PORT_API'] ?? '4000', 10);

// Apply pending DB migrations BEFORE we touch the schema — safe to re-run
// because migrate.sql uses IF NOT EXISTS / column-existence guards.
await runMigrations();

// Load API keys from DB → process.env BEFORE the server starts accepting requests,
// so the very first AI call doesn't hit an empty env var.
await loadSettingsIntoEnv();

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
