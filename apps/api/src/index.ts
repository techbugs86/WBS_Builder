import 'dotenv/config';
import { app } from './app.js';
import { loadSettingsIntoEnv } from './bootstrap/loadSettings.js';
import { runMigrations } from './db/migrate.js';
import { logError } from './lib/errorLog.js';

const PORT = parseInt(process.env['PORT_API'] ?? '4000', 10);

// Apply pending DB migrations BEFORE we touch the schema — safe to re-run
// because migrate.sql uses IF NOT EXISTS / column-existence guards.
await runMigrations();

// Load API keys from DB → process.env BEFORE the server starts accepting requests,
// so the very first AI call doesn't hit an empty env var.
await loadSettingsIntoEnv();

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
  // Write a startup marker so the log file exists immediately — proves the
  // logger is wired correctly without waiting for the first real failure.
  void logError({
    level: 'info',
    source: 'backend',
    module: 'startup',
    message: `API server started on port ${PORT}`,
    context: { nodeEnv: process.env['NODE_ENV'] ?? 'development', pid: process.pid },
  });
});
