import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { query, execute } from '../db/index.js';

export const settingsRouter = Router();

const ALLOWED_KEYS = ['anthropic_api_key', 'openai_api_key', 'clickup_api_key', 'clickup_space_id'] as const;
type SettingKey = typeof ALLOWED_KEYS[number];

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string;
}

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return value.slice(0, 4) + '••••••••' + value.slice(-4);
}

// GET /admin/settings — returns masked values
settingsRouter.get('/', verifyJWT, requireRole('admin'), async (req, res) => {
  // Build placeholders dynamically — must match the count of ALLOWED_KEYS exactly,
  // otherwise mysql2 silently fails the query.
  const placeholders = ALLOWED_KEYS.map(() => '?').join(',');
  const rows = await query<SettingRow>(
    `SELECT * FROM settings WHERE \`key\` IN (${placeholders}) AND org_id = ?`,
    [...ALLOWED_KEYS, req.user!.orgId],
  );
  const result: Record<string, { masked: string; set: boolean; updatedAt: string; updatedBy: string }> = {};
  for (const key of ALLOWED_KEYS) {
    const row = rows.find((r) => r.key === key);
    result[key] = {
      masked: row ? maskValue(row.value) : '',
      set: Boolean(row?.value),
      updatedAt: row?.updated_at ?? '',
      updatedBy: row?.updated_by ?? '',
    };
  }
  res.json(result);
});

// PUT /admin/settings/:key — upsert a key
settingsRouter.put('/:key', verifyJWT, requireRole('admin'), async (req, res) => {
  const key = req.params['key'] as SettingKey;
  if (!ALLOWED_KEYS.includes(key)) {
    res.status(400).json({ error: `Invalid key. Allowed: ${ALLOWED_KEYS.join(', ')}` });
    return;
  }

  const { value } = req.body as { value?: string };
  if (typeof value !== 'string') {
    res.status(400).json({ error: 'value must be a string.' });
    return;
  }

  const updatedBy = req.user?.email ?? 'unknown';
  const orgId = req.user!.orgId;
  await execute(
    'INSERT INTO settings (`key`, org_id, `value`, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE `value` = ?, updated_by = ?, updated_at = NOW()',
    [key, orgId, value, updatedBy, value, updatedBy],
  );

  // Also update process.env so the AI module picks it up immediately (no restart needed)
  const envMap: Record<SettingKey, string> = {
    anthropic_api_key: 'ANTHROPIC_API_KEY',
    openai_api_key: 'OPENAI_API_KEY',
    clickup_api_key: 'CLICKUP_API_KEY',
    clickup_space_id: 'CLICKUP_SPACE_ID',
  };
  if (value) process.env[envMap[key]] = value;
  else delete process.env[envMap[key]];

  res.json({ key, set: Boolean(value), masked: maskValue(value) });
});

// DELETE /admin/settings/:key — clear a key
settingsRouter.delete('/:key', verifyJWT, requireRole('admin'), async (req, res) => {
  const key = req.params['key'] as SettingKey;
  if (!ALLOWED_KEYS.includes(key)) {
    res.status(400).json({ error: 'Invalid key.' });
    return;
  }
  await execute('UPDATE settings SET `value` = \'\', updated_by = ?, updated_at = NOW() WHERE `key` = ? AND org_id = ?', [req.user?.email ?? 'unknown', key, req.user!.orgId]);

  const envMap: Record<SettingKey, string> = {
    anthropic_api_key: 'ANTHROPIC_API_KEY',
    openai_api_key: 'OPENAI_API_KEY',
    clickup_api_key: 'CLICKUP_API_KEY',
    clickup_space_id: 'CLICKUP_SPACE_ID',
  };
  delete process.env[envMap[key]];

  res.json({ key, set: false, masked: '' });
});
