import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { verifyJWT } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { query, queryOne, execute } from '../db/index.js';
import { PROMPT_STAGE_VALUES, PROJECT_TYPE_VALUES } from '../constants/enums.js';
import type { PromptStage, ProjectType } from '../constants/enums.js';

export const promptsRouter = Router();

const VALID_STAGES = PROMPT_STAGE_VALUES as readonly string[];
const VALID_TYPES = PROJECT_TYPE_VALUES as readonly string[];

interface PromptConfigRow {
  id: string;
  org_id: string;
  project_type: ProjectType;
  stage: PromptStage;
  label: string;
  system_prompt: string;
  user_prompt_template: string;
  version: number;
  updated_at: string;
  updated_by: string;
}

interface HistoryRow {
  id: string;
  prompt_config_id: string;
  version: number;
  system_prompt: string;
  user_prompt_template: string;
  updated_by: string;
  created_at: string;
}

function toResponse(row: PromptConfigRow) {
  return {
    id: row.id,
    projectType: row.project_type,
    stage: row.stage,
    label: row.label,
    systemPrompt: row.system_prompt,
    userPromptTemplate: row.user_prompt_template,
    version: row.version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// GET /admin/prompts?projectType=general
// Returns all 4 stages for the given project type.
// If a stage has no type-specific row, falls back to the general row.
promptsRouter.get('/', verifyJWT, requireRole('admin'), async (req, res) => {
  const projectType = (req.query['projectType'] as string) ?? 'general';
  if (!VALID_TYPES.includes(projectType as ProjectType)) {
    res.status(400).json({ error: `Invalid projectType. Must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }

  const orgId = req.user!.orgId;

  // Fetch type-specific rows
  const typeRows = await query<PromptConfigRow>(
    'SELECT * FROM prompt_configs WHERE org_id = ? AND project_type = ? ORDER BY stage',
    [orgId, projectType],
  );

  // For non-general types, fill missing stages from the general fallback
  if (projectType !== 'general') {
    const generalRows = await query<PromptConfigRow>(
      'SELECT * FROM prompt_configs WHERE org_id = ? AND project_type = ? ORDER BY stage',
      [orgId, 'general'],
    );

    const result = VALID_STAGES.map((stage) => {
      const specific = typeRows.find((r) => r.stage === stage);
      if (specific) return { ...toResponse(specific), isInherited: false };
      const fallback = generalRows.find((r) => r.stage === stage);
      if (fallback) return { ...toResponse(fallback), isInherited: true, inheritedFrom: 'general' };
      return null;
    }).filter(Boolean);

    res.json(result);
    return;
  }

  res.json(typeRows.map((r) => ({ ...toResponse(r), isInherited: false })));
});

// PUT /admin/prompts/:stage?projectType=general
// Upserts a prompt config for the given stage + project type.
// Also appends a history row.
promptsRouter.put('/:stage', verifyJWT, requireRole('admin'), async (req, res) => {
  const { stage } = req.params as { stage: string };
  const projectType = ((req.query['projectType'] as string) ?? 'general') as ProjectType;

  if (!VALID_STAGES.includes(stage as PromptStage)) {
    res.status(400).json({ error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` });
    return;
  }
  if (!VALID_TYPES.includes(projectType)) {
    res.status(400).json({ error: `Invalid projectType. Must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }

  const { systemPrompt, userPromptTemplate, label } = req.body as {
    systemPrompt?: string;
    userPromptTemplate?: string;
    label?: string;
  };

  const orgId = req.user!.orgId;
  const updatedBy = req.user!.email;

  // Check if row exists
  const existing = await queryOne<PromptConfigRow>(
    'SELECT * FROM prompt_configs WHERE stage = ? AND project_type = ? AND org_id = ?',
    [stage, projectType, orgId],
  );

  if (existing) {
    // Update and bump version
    const fields: string[] = ['version = version + 1', 'updated_by = ?', 'updated_at = NOW()'];
    const values: (string | number | null)[] = [updatedBy];
    if (systemPrompt !== undefined) { fields.push('system_prompt = ?'); values.push(systemPrompt); }
    if (userPromptTemplate !== undefined) { fields.push('user_prompt_template = ?'); values.push(userPromptTemplate); }
    if (label !== undefined) { fields.push('label = ?'); values.push(label); }
    values.push(existing.id);
    await execute(`UPDATE prompt_configs SET ${fields.join(', ')} WHERE id = ?`, values);

    // Append history
    const updated = await queryOne<PromptConfigRow>('SELECT * FROM prompt_configs WHERE id = ?', [existing.id]);
    if (updated) {
      await execute(
        'INSERT INTO prompt_config_history (id, prompt_config_id, version, system_prompt, user_prompt_template, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
        [uuid(), updated.id, updated.version, updated.system_prompt, updated.user_prompt_template, updatedBy],
      );
    }
  } else {
    // Create new type-specific row — copy content from general as starting point if not provided
    const generalRow = await queryOne<PromptConfigRow>(
      'SELECT * FROM prompt_configs WHERE stage = ? AND project_type = ? AND org_id = ?',
      [stage, 'general', orgId],
    );
    const id = uuid();
    const stageLabels: Record<string, string> = {
      brief_extraction: 'Brief Extraction',
      epic_generation: 'Epic Generation',
      journey_generation: 'Journey Generation',
      task_decomposition: 'Task Decomposition',
    };
    await execute(
      'INSERT INTO prompt_configs (id, org_id, project_type, stage, label, system_prompt, user_prompt_template, version, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
      [
        id, orgId, projectType, stage,
        label ?? `${stageLabels[stage] ?? stage}`,
        systemPrompt ?? generalRow?.system_prompt ?? '',
        userPromptTemplate ?? generalRow?.user_prompt_template ?? '',
        updatedBy,
      ],
    );
    // First history entry
    await execute(
      'INSERT INTO prompt_config_history (id, prompt_config_id, version, system_prompt, user_prompt_template, updated_by) VALUES (?, ?, 1, ?, ?, ?)',
      [
        uuid(), id,
        systemPrompt ?? generalRow?.system_prompt ?? '',
        userPromptTemplate ?? generalRow?.user_prompt_template ?? '',
        updatedBy,
      ],
    );
  }

  const result = await queryOne<PromptConfigRow>(
    'SELECT * FROM prompt_configs WHERE stage = ? AND project_type = ? AND org_id = ?',
    [stage, projectType, orgId],
  );
  if (!result) { res.status(404).json({ error: 'Not found.' }); return; }
  res.json({ ...toResponse(result), isInherited: false });
});

// GET /admin/prompts/:stage/history?projectType=general
// Returns version history for a stage + project type combo.
promptsRouter.get('/:stage/history', verifyJWT, requireRole('admin'), async (req, res) => {
  const { stage } = req.params as { stage: string };
  const projectType = ((req.query['projectType'] as string) ?? 'general') as ProjectType;

  const config = await queryOne<PromptConfigRow>(
    'SELECT id FROM prompt_configs WHERE stage = ? AND project_type = ? AND org_id = ?',
    [stage, projectType, req.user!.orgId],
  );

  if (!config) {
    res.json([]);
    return;
  }

  const rows = await query<HistoryRow>(
    'SELECT * FROM prompt_config_history WHERE prompt_config_id = ? ORDER BY version DESC',
    [config.id],
  );

  res.json(rows.map((r) => ({
    version: r.version,
    systemPrompt: r.system_prompt,
    userPromptTemplate: r.user_prompt_template,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
  })));
});

// POST /admin/prompts/:stage/restore?projectType=general
// Restores a specific version as the new current (copies content, bumps version).
promptsRouter.post('/:stage/restore', verifyJWT, requireRole('admin'), async (req, res) => {
  const { stage } = req.params as { stage: string };
  const projectType = ((req.query['projectType'] as string) ?? 'general') as ProjectType;
  const { version } = req.body as { version?: number };

  if (!version) { res.status(400).json({ error: 'version is required.' }); return; }

  const config = await queryOne<PromptConfigRow>(
    'SELECT * FROM prompt_configs WHERE stage = ? AND project_type = ? AND org_id = ?',
    [stage, projectType, req.user!.orgId],
  );
  if (!config) { res.status(404).json({ error: 'Prompt config not found.' }); return; }

  const historyRow = await queryOne<HistoryRow>(
    'SELECT * FROM prompt_config_history WHERE prompt_config_id = ? AND version = ?',
    [config.id, version],
  );
  if (!historyRow) { res.status(404).json({ error: `Version ${version} not found.` }); return; }

  const updatedBy = req.user!.email;
  await execute(
    'UPDATE prompt_configs SET system_prompt = ?, user_prompt_template = ?, version = version + 1, updated_by = ?, updated_at = NOW() WHERE id = ?',
    [historyRow.system_prompt, historyRow.user_prompt_template, updatedBy, config.id],
  );

  const updated = await queryOne<PromptConfigRow>('SELECT * FROM prompt_configs WHERE id = ?', [config.id]);
  if (updated) {
    await execute(
      'INSERT INTO prompt_config_history (id, prompt_config_id, version, system_prompt, user_prompt_template, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), config.id, updated.version, updated.system_prompt, updated.user_prompt_template, updatedBy],
    );
  }

  res.json({ ...toResponse(updated!), isInherited: false });
});
