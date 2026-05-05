import 'dotenv/config';
import { app } from './app.js';
import { loadSettingsIntoEnv } from './bootstrap/loadSettings.js';

const PORT = parseInt(process.env['PORT_API'] ?? '4000', 10);

// Load API keys from DB → process.env BEFORE the server starts accepting requests,
// so the very first AI call doesn't hit an empty env var.
await loadSettingsIntoEnv();

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
