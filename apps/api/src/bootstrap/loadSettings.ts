// Loads all per-org API key settings from the DB into process.env at API startup.
//
// The PUT /admin/settings/:key route mirrors the value into process.env so
// running code picks it up without restart. But process.env is reset on every
// server restart (including tsx watch reloads) — so without a startup loader,
// keys saved before the restart are invisible to the AI module until someone
// re-saves them via the UI.
//
// This loader runs once at boot and re-populates process.env from the DB.

import { query } from '../db/index.js';

interface SettingRow {
  key: string;
  value: string;
}

const ENV_MAP: Record<string, string> = {
  anthropic_api_key: 'ANTHROPIC_API_KEY',
  openai_api_key: 'OPENAI_API_KEY',
  clickup_api_key: 'CLICKUP_API_KEY',
  clickup_space_id: 'CLICKUP_SPACE_ID',
};

export async function loadSettingsIntoEnv(): Promise<void> {
  try {
    // Load any non-empty value across any org. If multiple orgs have a key,
    // the LAST one wins — fine for single-org deployments. Multi-org production
    // should look up keys per-request via the org_id rather than relying on env.
    const rows = await query<SettingRow>(
      "SELECT `key`, `value` FROM settings WHERE `value` <> ''",
    );
    let loaded = 0;
    for (const row of rows) {
      const envKey = ENV_MAP[row.key];
      if (envKey && row.value && !process.env[envKey]) {
        process.env[envKey] = row.value;
        loaded++;
      }
    }
    if (loaded > 0) {
      console.log(`[bootstrap] Loaded ${loaded} setting(s) from DB into process.env`);
    }
  } catch (err) {
    // Don't crash the server if the settings table doesn't exist yet (fresh
    // install before migrations) — just log and continue.
    console.warn('[bootstrap] Could not load settings from DB:', err instanceof Error ? err.message : err);
  }
}
