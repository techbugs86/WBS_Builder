import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../db/index.js';
import { verifyJWT } from '../middleware/auth.js';
import { requireOrgProject } from '../middleware/requireOrgProject.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { generateBrief, generateEpics, generateJourneys, generateTasks, rewriteItem, type Brief, type Epic, type Journey } from '../ai/index.js';
import { syncProjectToClickUp } from '../clickup/sync.js';
import { SELECTABLE_PROJECT_TYPES } from '../constants/enums.js';

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return (raw as T) ?? fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function llmErrorToHttp(err: unknown): HttpError {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  // Zod validation failures bubble up as ZodError — handled by global middleware.
  // Network / SDK errors come back here as plain Errors.
  if (/api key/i.test(msg) || /unauthorized/i.test(msg)) {
    return new HttpError(401, 'AI provider rejected the request — check API key.', 'AI_AUTH_FAILED');
  }
  if (/rate limit/i.test(msg) || /429/.test(msg)) {
    return new HttpError(429, 'AI provider rate limit hit — try again in a moment.', 'AI_RATE_LIMIT');
  }
  if (/JSON/i.test(msg)) {
    return new HttpError(502, 'AI returned an invalid response — please retry.', 'AI_BAD_OUTPUT');
  }
  return new HttpError(502, `AI generation failed: ${msg}`, 'AI_FAILED');
}

export const projectsRouter = Router();

// All project routes require auth
projectsRouter.use(verifyJWT);

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  client: string;
  project_type: string;
  estimated_budget: string;
  start_date: string;
  communication_channel: string;
  channel_link: string;
  contact_person: string;
  raw_input: string;
  provider: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface BriefRow {
  id: string;
  project_id: string;
  version: number;
  is_current: number;
  data: string;
  label: string;
  challenge_text: string;
  created_at: string;
}

interface EpicRow {
  id: string;
  project_id: string;
  epic_key: string;
  version: number;
  is_current: number;
  data: string;
  label: string;
  challenge_text: string;
  created_at: string;
}

interface JourneyRow {
  id: string;
  project_id: string;
  journey_key: string;
  version: number;
  is_current: number;
  data: string;
  label: string;
  challenge_text: string;
  created_at: string;
}

interface TaskRow {
  id: string;
  project_id: string;
  task_key: string;
  version: number;
  is_current: number;
  data: string;
  label: string;
  challenge_text: string;
  created_at: string;
}

interface PromptConfigRow {
  id: string;
  stage: string;
  system_prompt: string;
  user_prompt_template: string;
}

function parseRows<T>(rows: Array<{ data: string }>): T[] {
  return rows.map((r) => typeof r.data === 'string' ? JSON.parse(r.data) as T : r.data as T);
}

function toVersionHistory<T>(rows: Array<{ version: number; label: string; challenge_text: string; created_at: string; data: string }>): Array<{
  version: number; label: string; challengeText: string; createdAt: string; data: T;
}> {
  return rows.map((r) => ({
    version: r.version,
    label: r.label,
    challengeText: r.challenge_text ?? '',
    createdAt: r.created_at,
    data: typeof r.data === 'string' ? JSON.parse(r.data) as T : r.data as T,
  }));
}

// Map project.project_type → prompt project_type; unknown types fall back to general
function promptType(pt: string): string {
  return (SELECTABLE_PROJECT_TYPES as readonly string[]).includes(pt) ? pt : 'general';
}

async function getPromptConfig(stage: string, orgId: string, projectType = 'general'): Promise<{ systemPrompt: string; userTemplate: string }> {
  // Try type-specific first, fall back to general
  const row = await queryOne<PromptConfigRow>(
    'SELECT system_prompt, user_prompt_template FROM prompt_configs WHERE stage = ? AND org_id = ? AND project_type = ?',
    [stage, orgId, projectType],
  ) ?? await queryOne<PromptConfigRow>(
    'SELECT system_prompt, user_prompt_template FROM prompt_configs WHERE stage = ? AND org_id = ? AND project_type = ?',
    [stage, orgId, 'general'],
  );
  return {
    systemPrompt: row?.system_prompt ?? '',
    userTemplate: row?.user_prompt_template ?? '',
  };
}

async function getProjectCounts(projectId: string) {
  const epicCount = await queryOne<{ cnt: number }>(
    'SELECT COUNT(DISTINCT epic_key) as cnt FROM epics WHERE project_id = ? AND is_current = 1',
    [projectId],
  );
  const taskCount = await queryOne<{ cnt: number }>(
    'SELECT COUNT(DISTINCT task_key) as cnt FROM tasks WHERE project_id = ? AND is_current = 1',
    [projectId],
  );
  // syncedCount = tasks that have actually been pushed to ClickUp (i.e. have
  // a row in clickup_mappings). Previously this was counting approved tasks,
  // which made the project card show "N synced" the moment tasks were
  // approved — even before clicking Sync. Join against the mappings table
  // and only count current tasks so deleted/regenerated tasks don't inflate.
  const syncedCount = await queryOne<{ cnt: number }>(
    `SELECT COUNT(DISTINCT cm.entity_key) as cnt
     FROM clickup_mappings cm
     INNER JOIN tasks t
       ON t.task_key = cm.entity_key
       AND t.project_id = cm.project_id
       AND t.is_current = 1
     WHERE cm.project_id = ? AND cm.entity_type = 'task'`,
    [projectId],
  );
  return {
    epicCount: epicCount?.cnt ?? 0,
    taskCount: taskCount?.cnt ?? 0,
    syncedCount: syncedCount?.cnt ?? 0,
  };
}

// ─── Projects ─────────────────────────────────────────────────────────────────

// GET /projects
projectsRouter.get('/', async (req, res) => {
  const rows = await query<ProjectRow>(
    'SELECT * FROM projects WHERE org_id = ? ORDER BY updated_at DESC',
    [req.user!.orgId],
  );

  const projects = await Promise.all(
    rows.map(async (p) => {
      const counts = await getProjectCounts(p.id);
      // Reconcile the stored `status` column against actual sync coverage.
      // The column gets set to 'synced' on first successful sync but never
      // unsets — so after the user regenerates tasks (creating new IDs without
      // ClickUp mappings) the badge keeps lying. Truth is in clickup_mappings:
      //   - 0 synced tasks → can't be 'synced'; fall back to 'draft'
      //   - syncedCount < taskCount → only 'synced' if the unsynced ones are
      //     pending/flagged (which the count check already filters at sync time);
      //     to keep this simple we treat any unsynced as "drift" and mark draft.
      // Also lazily heal the DB so the next read is correct without a write.
      let status = p.status;
      if (status === 'synced' && counts.syncedCount < counts.taskCount) {
        status = 'draft';
        await execute("UPDATE projects SET status = 'draft' WHERE id = ?", [p.id]);
      }
      return {
        id: p.id,
        name: p.name,
        client: p.client,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        status,
        provider: p.provider,
        ...counts,
      };
    }),
  );

  res.json(projects);
});

// POST /projects
projectsRouter.post('/', async (req, res) => {
  const body = req.body as {
    name: string;
    client: string;
    projectType?: string;
    estimatedBudget?: string;
    startDate?: string;
    communicationChannels?: string[];
    channelLinks?: Record<string, string>;
    contactPerson?: string;
    rawInput?: string;
    provider?: string;
  };

  if (!body.name?.trim()) {
    res.status(400).json({ error: 'name is required.' });
    return;
  }

  const id = uuid();
  await execute(
    `INSERT INTO projects
     (id, org_id, name, client, project_type, estimated_budget, start_date, communication_channel,
      channel_link, contact_person, raw_input, provider, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [
      id,
      req.user!.orgId,
      body.name.trim(),
      body.client?.trim() ?? '',
      body.projectType ?? 'web_app',
      body.estimatedBudget ?? '',
      body.startDate ?? '',
      JSON.stringify(body.communicationChannels ?? ['upwork']),
      JSON.stringify(body.channelLinks ?? {}),
      body.contactPerson ?? '',
      body.rawInput ?? '',
      body.provider ?? 'anthropic',
      req.user!.userId,
    ],
  );

  const project = await queryOne<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id]);
  res.status(201).json({ ...project, epicCount: 0, taskCount: 0, syncedCount: 0 });
});

// All /:id routes require org ownership
projectsRouter.use('/:id', requireOrgProject);

// GET /projects/:id
projectsRouter.get('/:id', async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const counts = await getProjectCounts(project.id);
  // Same reconciliation as the list endpoint — keep the single-project badge
  // honest when the user re-syncs after regenerating tasks.
  let status = project.status;
  if (status === 'synced' && counts.syncedCount < counts.taskCount) {
    status = 'draft';
    await execute("UPDATE projects SET status = 'draft' WHERE id = ?", [project.id]);
  }
  res.json({ ...project, status, ...counts });
});

// PATCH /projects/:id
projectsRouter.patch('/:id', async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const allowed = ['name','client','project_type','estimated_budget','start_date','communication_channel','channel_link','contact_person','raw_input','provider','status'] as const;
  const fields: string[] = [];
  const values: (string | number | boolean | null)[] = [];

  for (const key of allowed) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (req.body[camel] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(req.body[camel]);
    } else if (req.body[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(req.body[key]);
    }
  }

  if (fields.length === 0) { res.json(project); return; }
  values.push(req.params['id']!);
  await execute(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, values);
  const updated = await queryOne<ProjectRow>('SELECT * FROM projects WHERE id = ?', [req.params['id']]);
  res.json(updated);
});

// DELETE /projects/:id — admin/owner only.
// Cascades through every owned table (briefs, epics, journeys, tasks,
// clickup_mappings, sync_log) before removing the project row itself.
projectsRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const projectId = req.params['id']!;

  // Order matters: child rows first to avoid orphaned references in any future FK setup.
  await execute('DELETE FROM briefs           WHERE project_id = ?', [projectId]);
  await execute('DELETE FROM epics            WHERE project_id = ?', [projectId]);
  await execute('DELETE FROM journeys         WHERE project_id = ?', [projectId]);
  await execute('DELETE FROM tasks            WHERE project_id = ?', [projectId]);
  await execute('DELETE FROM clickup_mappings WHERE project_id = ?', [projectId]);
  await execute('DELETE FROM sync_log         WHERE project_id = ?', [projectId]);

  const result = await execute('DELETE FROM projects WHERE id = ? AND org_id = ?', [projectId, req.user!.orgId]);
  if (result.affectedRows === 0) {
    throw new HttpError(404, 'Project not found.', 'NOT_FOUND');
  }

  res.json({ deleted: true, id: projectId });
}));

// ─── Brief ────────────────────────────────────────────────────────────────────

// GET /projects/:id/brief
projectsRouter.get('/:id/brief', async (req, res) => {
  const current = await queryOne<BriefRow>(
    'SELECT * FROM briefs WHERE project_id = ? AND is_current = 1 LIMIT 1',
    [req.params['id']],
  );
  if (!current) { res.json(null); return; }

  const versions = await query<BriefRow>(
    'SELECT * FROM briefs WHERE project_id = ? ORDER BY version ASC',
    [req.params['id']],
  );

  res.json({
    current: typeof current.data === 'string' ? JSON.parse(current.data) : current.data,
    versions: toVersionHistory(versions),
  });
});

// POST /projects/:id/brief/generate
projectsRouter.post('/:id/brief/generate', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const { systemPrompt, userTemplate } = await getPromptConfig('brief_extraction', req.user!.orgId, promptType(project.project_type));
  const challengeText = (req.body as { challengeText?: string }).challengeText ?? '';

  let brief;
  try {
    brief = await generateBrief(
      project.raw_input ?? '',
      project.name,
      project.client,
      project.provider as 'anthropic' | 'openai',
      systemPrompt,
      userTemplate,
      challengeText,
    );
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  // Deactivate existing brief versions
  await execute('UPDATE briefs SET is_current = 0 WHERE project_id = ?', [req.params['id']]);

  const existingCount = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM briefs WHERE project_id = ?',
    [req.params['id']],
  );
  const version = (existingCount?.cnt ?? 0) + 1;

  const id = uuid();
  await execute(
    'INSERT INTO briefs (id, project_id, version, is_current, data, label, challenge_text) VALUES (?, ?, ?, 1, ?, ?, ?)',
    [id, req.params['id'], version, JSON.stringify(brief), `AI Generated v${version}`, challengeText],
  );

  // Update project updated_at
  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  const versions = await query<BriefRow>(
    'SELECT * FROM briefs WHERE project_id = ? ORDER BY version ASC',
    [req.params['id']],
  );

  res.json({ current: brief, versions: toVersionHistory(versions) });
}));

// PATCH /projects/:id/brief
projectsRouter.patch('/:id/brief', async (req, res) => {
  const current = await queryOne<BriefRow>(
    'SELECT * FROM briefs WHERE project_id = ? AND is_current = 1 LIMIT 1',
    [req.params['id']],
  );
  if (!current) { res.status(404).json({ error: 'No brief found.' }); return; }

  const currentData = typeof current.data === 'string' ? JSON.parse(current.data) as Brief : current.data as Brief;
  const updated = { ...currentData, ...req.body };

  await execute('UPDATE briefs SET is_current = 0 WHERE project_id = ?', [req.params['id']]);
  const id = uuid();
  await execute(
    'INSERT INTO briefs (id, project_id, version, is_current, data, label) VALUES (?, ?, ?, 1, ?, ?)',
    [id, req.params['id'], current.version + 1, JSON.stringify(updated), 'Manually edited'],
  );
  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  const versions = await query<BriefRow>('SELECT * FROM briefs WHERE project_id = ? ORDER BY version ASC', [req.params['id']]);
  res.json({ current: updated, versions: toVersionHistory(versions) });
});

// POST /projects/:id/brief/questions/:questionId/answer
projectsRouter.post('/:id/brief/questions/:questionId/answer', asyncHandler(async (req, res) => {
  const { answer, status } = req.body as { answer?: string; status?: 'open' | 'answered' | 'dismissed' };

  const current = await queryOne<BriefRow>(
    'SELECT * FROM briefs WHERE project_id = ? AND is_current = 1 LIMIT 1',
    [req.params['id']],
  );
  if (!current) { res.status(404).json({ error: 'No brief found.' }); return; }

  const currentData = safeJsonParse<Brief>(current.data, {} as Brief);
  const questions = currentData.openQuestions ?? [];
  const idx = questions.findIndex((q) => q.id === req.params['questionId']);
  if (idx === -1) { res.status(404).json({ error: 'Question not found.' }); return; }

  const nextStatus = status ?? (answer && answer.trim() ? 'answered' : 'open');
  questions[idx] = {
    ...questions[idx]!,
    answer: answer ?? questions[idx]!.answer ?? '',
    status: nextStatus,
  };
  const updated = { ...currentData, openQuestions: questions };

  await execute('UPDATE briefs SET is_current = 0 WHERE project_id = ?', [req.params['id']]);
  const id = uuid();
  const shortQ = (questions[idx]!.text ?? '').slice(0, 40);
  const label = nextStatus === 'answered' ? `Answered: ${shortQ}` : nextStatus === 'dismissed' ? `Dismissed: ${shortQ}` : `Reopened: ${shortQ}`;
  await execute(
    'INSERT INTO briefs (id, project_id, version, is_current, data, label) VALUES (?, ?, ?, 1, ?, ?)',
    [id, req.params['id'], current.version + 1, JSON.stringify(updated), label],
  );
  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  const versions = await query<BriefRow>('SELECT * FROM briefs WHERE project_id = ? ORDER BY version ASC', [req.params['id']]);
  res.json({ current: updated, versions: toVersionHistory(versions) });
}));

// POST /projects/:id/brief/restore/:version
projectsRouter.post('/:id/brief/restore/:version', async (req, res) => {
  const target = await queryOne<BriefRow>(
    'SELECT * FROM briefs WHERE project_id = ? AND version = ?',
    [req.params['id'], req.params['version']],
  );
  if (!target) { res.status(404).json({ error: 'Version not found.' }); return; }

  await execute('UPDATE briefs SET is_current = 0 WHERE project_id = ?', [req.params['id']]);
  const count = await queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM briefs WHERE project_id = ?', [req.params['id']]);
  const id = uuid();
  const targetData = typeof target.data === 'string' ? JSON.parse(target.data) : target.data;
  await execute(
    'INSERT INTO briefs (id, project_id, version, is_current, data, label) VALUES (?, ?, ?, 1, ?, ?)',
    [id, req.params['id'], (count?.cnt ?? 0) + 1, JSON.stringify(targetData), `Restored from v${req.params['version']}`],
  );

  const versions = await query<BriefRow>('SELECT * FROM briefs WHERE project_id = ? ORDER BY version ASC', [req.params['id']]);
  res.json({ current: targetData, versions: toVersionHistory(versions) });
});

// ─── Bulk delete (admin only) ─────────────────────────────────────────────────
// Each endpoint cascades downstream because lower stages reference upper ones
// by id and would be orphaned otherwise.

// DELETE /projects/:id/epics — wipes all epics + downstream journeys + tasks + clickup mappings.
// Resets project.status to 'draft' so the sidebar's "Sync complete" green check disappears.
projectsRouter.delete('/:id/epics', requireRole('admin'), asyncHandler(async (req, res) => {
  const projectId = req.params['id']!;
  await execute('DELETE FROM clickup_mappings WHERE project_id = ? AND entity_type IN (\'list\', \'task\')', [projectId]);
  await execute('DELETE FROM tasks    WHERE project_id = ?', [projectId]);
  await execute('DELETE FROM journeys WHERE project_id = ?', [projectId]);
  const result = await execute('DELETE FROM epics WHERE project_id = ?', [projectId]);
  await execute("UPDATE projects SET status = 'draft', updated_at = NOW() WHERE id = ?", [projectId]);
  res.json({ deleted: true, type: 'epics', affectedRows: result.affectedRows });
}));

// DELETE /projects/:id/journeys — wipes journeys + downstream tasks + task clickup mappings.
projectsRouter.delete('/:id/journeys', requireRole('admin'), asyncHandler(async (req, res) => {
  const projectId = req.params['id']!;
  await execute('DELETE FROM clickup_mappings WHERE project_id = ? AND entity_type = \'task\'', [projectId]);
  await execute('DELETE FROM tasks WHERE project_id = ?', [projectId]);
  const result = await execute('DELETE FROM journeys WHERE project_id = ?', [projectId]);
  await execute("UPDATE projects SET status = 'draft', updated_at = NOW() WHERE id = ?", [projectId]);
  res.json({ deleted: true, type: 'journeys', affectedRows: result.affectedRows });
}));

// DELETE /projects/:id/tasks — wipes tasks + their clickup mappings only.
projectsRouter.delete('/:id/tasks', requireRole('admin'), asyncHandler(async (req, res) => {
  const projectId = req.params['id']!;
  await execute('DELETE FROM clickup_mappings WHERE project_id = ? AND entity_type = \'task\'', [projectId]);
  const result = await execute('DELETE FROM tasks WHERE project_id = ?', [projectId]);
  await execute("UPDATE projects SET status = 'draft', updated_at = NOW() WHERE id = ?", [projectId]);
  res.json({ deleted: true, type: 'tasks', affectedRows: result.affectedRows });
}));

// ─── Singular delete endpoints ────────────────────────────────────────────────
// Delete one epic / journey / task by its key. Cascades downstream:
//   - Epic delete → journeys with that epicId → tasks under those journeys
//   - Journey delete → tasks with that journeyId
//   - Task delete → just the task row
// Each also wipes any matching clickup_mappings so future syncs don't try to
// update ghost ClickUp items.

// DELETE /projects/:id/epics/:epicKey
projectsRouter.delete('/:id/epics/:epicKey', requireRole('admin'), asyncHandler(async (req, res) => {
  const projectId = req.params['id']!;
  const epicKey   = req.params['epicKey']!;

  // Look up the epic.id (UUID inside JSON data) so we can find its children.
  const epicRow = await queryOne<{ data: string }>(
    'SELECT data FROM epics WHERE project_id = ? AND epic_key = ? AND is_current = 1',
    [projectId, epicKey],
  );
  if (!epicRow) { res.status(404).json({ error: 'Epic not found.' }); return; }
  const epicData = safeJsonParse<{ id?: string }>(epicRow.data, {});
  const epicId = epicData.id;

  if (epicId) {
    // Find all journey_keys whose data.epicId === this epic
    const journeyRows = await query<{ journey_key: string; data: string }>(
      'SELECT journey_key, data FROM journeys WHERE project_id = ? AND is_current = 1',
      [projectId],
    );
    const journeyKeys: string[] = [];
    const journeyIds: string[] = [];
    for (const r of journeyRows) {
      const d = safeJsonParse<{ id?: string; epicId?: string }>(r.data, {});
      if (d.epicId === epicId) {
        journeyKeys.push(r.journey_key);
        if (d.id) journeyIds.push(d.id);
      }
    }

    // Find all task_keys whose data.epicId === this epic OR data.journeyId is in journeyIds
    const taskRows = await query<{ task_key: string; data: string }>(
      'SELECT task_key, data FROM tasks WHERE project_id = ? AND is_current = 1',
      [projectId],
    );
    const taskKeys: string[] = [];
    for (const r of taskRows) {
      const d = safeJsonParse<{ epicId?: string; journeyId?: string }>(r.data, {});
      if (d.epicId === epicId || (d.journeyId && journeyIds.includes(d.journeyId))) {
        taskKeys.push(r.task_key);
      }
    }

    if (taskKeys.length > 0) {
      const placeholders = taskKeys.map(() => '?').join(',');
      await execute(
        `DELETE FROM clickup_mappings WHERE project_id = ? AND entity_type = 'task' AND entity_key IN (${placeholders})`,
        [projectId, ...taskKeys],
      );
      await execute(
        `DELETE FROM tasks WHERE project_id = ? AND task_key IN (${placeholders})`,
        [projectId, ...taskKeys],
      );
    }
    if (journeyKeys.length > 0) {
      const placeholders = journeyKeys.map(() => '?').join(',');
      await execute(
        `DELETE FROM journeys WHERE project_id = ? AND journey_key IN (${placeholders})`,
        [projectId, ...journeyKeys],
      );
    }
  }

  // Delete the epic itself + its list mapping
  await execute(
    'DELETE FROM clickup_mappings WHERE project_id = ? AND entity_type = \'list\' AND entity_key = ?',
    [projectId, epicKey],
  );
  const result = await execute('DELETE FROM epics WHERE project_id = ? AND epic_key = ?', [projectId, epicKey]);
  await execute("UPDATE projects SET updated_at = NOW() WHERE id = ?", [projectId]);
  res.json({ deleted: true, type: 'epic', epicKey, affectedRows: result.affectedRows });
}));

// DELETE /projects/:id/journeys/:journeyKey
projectsRouter.delete('/:id/journeys/:journeyKey', requireRole('admin'), asyncHandler(async (req, res) => {
  const projectId   = req.params['id']!;
  const journeyKey  = req.params['journeyKey']!;

  // Find the journey.id so we can locate its tasks
  const journeyRow = await queryOne<{ data: string }>(
    'SELECT data FROM journeys WHERE project_id = ? AND journey_key = ? AND is_current = 1',
    [projectId, journeyKey],
  );
  if (!journeyRow) { res.status(404).json({ error: 'Journey not found.' }); return; }
  const journeyData = safeJsonParse<{ id?: string }>(journeyRow.data, {});
  const journeyId = journeyData.id;

  if (journeyId) {
    // Tasks under this journey
    const taskRows = await query<{ task_key: string; data: string }>(
      'SELECT task_key, data FROM tasks WHERE project_id = ? AND is_current = 1',
      [projectId],
    );
    const taskKeys: string[] = [];
    for (const r of taskRows) {
      const d = safeJsonParse<{ journeyId?: string }>(r.data, {});
      if (d.journeyId === journeyId) taskKeys.push(r.task_key);
    }
    if (taskKeys.length > 0) {
      const placeholders = taskKeys.map(() => '?').join(',');
      await execute(
        `DELETE FROM clickup_mappings WHERE project_id = ? AND entity_type = 'task' AND entity_key IN (${placeholders})`,
        [projectId, ...taskKeys],
      );
      await execute(
        `DELETE FROM tasks WHERE project_id = ? AND task_key IN (${placeholders})`,
        [projectId, ...taskKeys],
      );
    }
  }

  const result = await execute('DELETE FROM journeys WHERE project_id = ? AND journey_key = ?', [projectId, journeyKey]);
  await execute("UPDATE projects SET updated_at = NOW() WHERE id = ?", [projectId]);
  res.json({ deleted: true, type: 'journey', journeyKey, affectedRows: result.affectedRows });
}));

// DELETE /projects/:id/tasks/:taskKey
projectsRouter.delete('/:id/tasks/:taskKey', requireRole('admin'), asyncHandler(async (req, res) => {
  const projectId = req.params['id']!;
  const taskKey   = req.params['taskKey']!;

  await execute(
    'DELETE FROM clickup_mappings WHERE project_id = ? AND entity_type = \'task\' AND entity_key = ?',
    [projectId, taskKey],
  );
  const result = await execute('DELETE FROM tasks WHERE project_id = ? AND task_key = ?', [projectId, taskKey]);
  if (result.affectedRows === 0) { res.status(404).json({ error: 'Task not found.' }); return; }
  await execute("UPDATE projects SET updated_at = NOW() WHERE id = ?", [projectId]);
  res.json({ deleted: true, type: 'task', taskKey, affectedRows: result.affectedRows });
}));

// ─── Epics ────────────────────────────────────────────────────────────────────

// GET /projects/:id/epics
projectsRouter.get('/:id/epics', async (req, res) => {
  const currentRows = await query<EpicRow>(
    'SELECT * FROM epics WHERE project_id = ? AND is_current = 1',
    [req.params['id']],
  );
  if (currentRows.length === 0) { res.json([]); return; }

  const result = await Promise.all(
    currentRows.map(async (row) => {
      const versions = await query<EpicRow>(
        'SELECT * FROM epics WHERE epic_key = ? ORDER BY version ASC',
        [row.epic_key],
      );
      return {
        current: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
        versions: toVersionHistory(versions),
      };
    }),
  );

  res.json(result);
});

// POST /projects/:id/epics/generate
projectsRouter.post('/:id/epics/generate', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (!briefRow) { res.status(400).json({ error: 'Generate a brief first.' }); return; }

  const brief = safeJsonParse<Brief>(briefRow.data, {} as Brief);
  const { systemPrompt, userTemplate } = await getPromptConfig('epic_generation', req.user!.orgId, promptType(project.project_type));
  const challengeText = (req.body as { challengeText?: string }).challengeText ?? '';

  let epics;
  try {
    epics = await generateEpics(brief, project.provider as 'anthropic' | 'openai', systemPrompt, userTemplate, challengeText);
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  // Deactivate all existing epics
  await execute('UPDATE epics SET is_current = 0 WHERE project_id = ?', [req.params['id']]);

  // Insert new epics
  for (const epic of epics) {
    const epicKey = epic.id;
    await execute(
      'INSERT INTO epics (id, project_id, epic_key, version, is_current, data, label) VALUES (?, ?, ?, 1, 1, ?, ?)',
      [uuid(), req.params['id'], epicKey, JSON.stringify(epic), 'AI Generated v1'],
    );
  }

  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  const saved = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  res.json(saved.map((r) => ({
    current: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
    versions: [{ version: 1, label: 'AI Generated v1', challengeText: '', createdAt: r.created_at, data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data }],
  })));
}));

// PATCH /projects/:id/epics/:epicKey
projectsRouter.patch('/:id/epics/:epicKey', async (req, res) => {
  const current = await queryOne<EpicRow>(
    'SELECT * FROM epics WHERE project_id = ? AND epic_key = ? AND is_current = 1',
    [req.params['id'], req.params['epicKey']],
  );
  if (!current) { res.status(404).json({ error: 'Epic not found.' }); return; }

  const currentData = typeof current.data === 'string' ? JSON.parse(current.data) : current.data;
  const updated = { ...currentData, ...req.body };

  await execute('UPDATE epics SET is_current = 0 WHERE epic_key = ?', [req.params['epicKey']]);
  await execute(
    'INSERT INTO epics (id, project_id, epic_key, version, is_current, data, label) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [uuid(), req.params['id'], req.params['epicKey'], current.version + 1, JSON.stringify(updated), 'Updated'],
  );
  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  const versions = await query<EpicRow>('SELECT * FROM epics WHERE epic_key = ? ORDER BY version ASC', [req.params['epicKey']]);
  res.json({ current: updated, versions: toVersionHistory(versions) });
});

// POST /projects/:id/epics/:epicKey/rewrite
projectsRouter.post('/:id/epics/:epicKey/rewrite', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const current = await queryOne<EpicRow>(
    'SELECT * FROM epics WHERE project_id = ? AND epic_key = ? AND is_current = 1',
    [req.params['id'], req.params['epicKey']],
  );
  if (!current) { res.status(404).json({ error: 'Epic not found.' }); return; }

  const currentData = safeJsonParse<Record<string, unknown>>(current.data, {});
  const instruction = (req.body as { instruction?: string }).instruction ?? '';
  const { systemPrompt } = await getPromptConfig('epic_generation', req.user!.orgId, promptType(project.project_type));

  let rewritten;
  try {
    rewritten = await rewriteItem('epic', currentData, instruction, project.provider as 'anthropic' | 'openai', systemPrompt);
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  await execute('UPDATE epics SET is_current = 0 WHERE epic_key = ?', [req.params['epicKey']]);
  const short = instruction.length > 50 ? instruction.slice(0, 50) + '…' : instruction;
  await execute(
    'INSERT INTO epics (id, project_id, epic_key, version, is_current, data, label) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [uuid(), req.params['id'], req.params['epicKey'], current.version + 1, JSON.stringify(rewritten), `Rewritten: ${short}`],
  );

  const versions = await query<EpicRow>('SELECT * FROM epics WHERE epic_key = ? ORDER BY version ASC', [req.params['epicKey']]);
  res.json({ current: rewritten, versions: toVersionHistory(versions) });
}));

// POST /projects/:id/epics/:epicKey/restore/:version
projectsRouter.post('/:id/epics/:epicKey/restore/:version', async (req, res) => {
  const target = await queryOne<EpicRow>(
    'SELECT * FROM epics WHERE epic_key = ? AND version = ?',
    [req.params['epicKey'], req.params['version']],
  );
  if (!target) { res.status(404).json({ error: 'Version not found.' }); return; }

  await execute('UPDATE epics SET is_current = 0 WHERE epic_key = ?', [req.params['epicKey']]);
  const count = await queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM epics WHERE epic_key = ?', [req.params['epicKey']]);
  const targetData = typeof target.data === 'string' ? JSON.parse(target.data) : target.data;
  await execute(
    'INSERT INTO epics (id, project_id, epic_key, version, is_current, data, label) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [uuid(), req.params['id'], req.params['epicKey'], (count?.cnt ?? 0) + 1, JSON.stringify(targetData), `Restored from v${req.params['version']}`],
  );

  const versions = await query<EpicRow>('SELECT * FROM epics WHERE epic_key = ? ORDER BY version ASC', [req.params['epicKey']]);
  res.json({ current: targetData, versions: toVersionHistory(versions) });
});

// ─── Journeys ─────────────────────────────────────────────────────────────────

// GET /projects/:id/journeys
projectsRouter.get('/:id/journeys', async (req, res) => {
  const rows = await query<JourneyRow>(
    'SELECT * FROM journeys WHERE project_id = ? AND is_current = 1',
    [req.params['id']],
  );
  if (rows.length === 0) { res.json([]); return; }

  const result = await Promise.all(
    rows.map(async (row) => {
      const versions = await query<JourneyRow>('SELECT * FROM journeys WHERE journey_key = ? ORDER BY version ASC', [row.journey_key]);
      return {
        current: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
        versions: toVersionHistory(versions),
      };
    }),
  );
  res.json(result);
});

// POST /projects/:id/journeys/generate
projectsRouter.post('/:id/journeys/generate', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (!briefRow) { res.status(400).json({ error: 'Generate a brief first.' }); return; }

  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (epicRows.length === 0) { res.status(400).json({ error: 'Generate epics first.' }); return; }

  const brief = safeJsonParse<Brief>(briefRow.data, {} as Brief);
  const epics = epicRows.map((r) => safeJsonParse<Epic>(r.data, {} as Epic));
  const { systemPrompt, userTemplate } = await getPromptConfig('journey_generation', req.user!.orgId, promptType(project.project_type));
  const challengeText = (req.body as { challengeText?: string }).challengeText ?? '';

  let journeys;
  try {
    journeys = await generateJourneys(epics, brief, project.provider as 'anthropic' | 'openai', systemPrompt, userTemplate, challengeText);
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  await execute('UPDATE journeys SET is_current = 0 WHERE project_id = ?', [req.params['id']]);

  for (const journey of journeys) {
    const journeyKey = journey.id;
    await execute(
      'INSERT INTO journeys (id, project_id, journey_key, version, is_current, data, label) VALUES (?, ?, ?, 1, 1, ?, ?)',
      [uuid(), req.params['id'], journeyKey, JSON.stringify(journey), 'AI Generated v1'],
    );
  }

  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  const saved = await query<JourneyRow>('SELECT * FROM journeys WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  res.json(saved.map((r) => ({
    current: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
    versions: [{ version: 1, label: 'AI Generated v1', challengeText: '', createdAt: r.created_at, data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data }],
  })));
}));

// PATCH /projects/:id/journeys/:journeyKey
projectsRouter.patch('/:id/journeys/:journeyKey', async (req, res) => {
  const current = await queryOne<JourneyRow>(
    'SELECT * FROM journeys WHERE project_id = ? AND journey_key = ? AND is_current = 1',
    [req.params['id'], req.params['journeyKey']],
  );
  if (!current) { res.status(404).json({ error: 'Journey not found.' }); return; }

  const currentData = typeof current.data === 'string' ? JSON.parse(current.data) : current.data;
  const updated = { ...currentData, ...req.body };

  await execute('UPDATE journeys SET is_current = 0 WHERE journey_key = ?', [req.params['journeyKey']]);
  await execute(
    'INSERT INTO journeys (id, project_id, journey_key, version, is_current, data, label) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [uuid(), req.params['id'], req.params['journeyKey'], current.version + 1, JSON.stringify(updated), 'Updated'],
  );

  const versions = await query<JourneyRow>('SELECT * FROM journeys WHERE journey_key = ? ORDER BY version ASC', [req.params['journeyKey']]);
  res.json({ current: updated, versions: toVersionHistory(versions) });
});

// POST /projects/:id/journeys/:journeyKey/rewrite
projectsRouter.post('/:id/journeys/:journeyKey/rewrite', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const current = await queryOne<JourneyRow>(
    'SELECT * FROM journeys WHERE project_id = ? AND journey_key = ? AND is_current = 1',
    [req.params['id'], req.params['journeyKey']],
  );
  if (!current) { res.status(404).json({ error: 'Journey not found.' }); return; }

  const currentData = safeJsonParse<Record<string, unknown>>(current.data, {});
  const instruction = (req.body as { instruction?: string }).instruction ?? '';
  const { systemPrompt } = await getPromptConfig('journey_generation', req.user!.orgId, promptType(project.project_type));

  let rewritten;
  try {
    rewritten = await rewriteItem('journey', currentData, instruction, project.provider as 'anthropic' | 'openai', systemPrompt);
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  await execute('UPDATE journeys SET is_current = 0 WHERE journey_key = ?', [req.params['journeyKey']]);
  const short = instruction.length > 50 ? instruction.slice(0, 50) + '…' : instruction;
  await execute(
    'INSERT INTO journeys (id, project_id, journey_key, version, is_current, data, label) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [uuid(), req.params['id'], req.params['journeyKey'], current.version + 1, JSON.stringify(rewritten), `Rewritten: ${short}`],
  );

  const versions = await query<JourneyRow>('SELECT * FROM journeys WHERE journey_key = ? ORDER BY version ASC', [req.params['journeyKey']]);
  res.json({ current: rewritten, versions: toVersionHistory(versions) });
}));

// POST /projects/:id/journeys/:journeyKey/restore/:version
projectsRouter.post('/:id/journeys/:journeyKey/restore/:version', async (req, res) => {
  const target = await queryOne<JourneyRow>(
    'SELECT * FROM journeys WHERE journey_key = ? AND version = ?',
    [req.params['journeyKey'], req.params['version']],
  );
  if (!target) { res.status(404).json({ error: 'Version not found.' }); return; }

  await execute('UPDATE journeys SET is_current = 0 WHERE journey_key = ?', [req.params['journeyKey']]);
  const count = await queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM journeys WHERE journey_key = ?', [req.params['journeyKey']]);
  const targetData = typeof target.data === 'string' ? JSON.parse(target.data) : target.data;
  await execute(
    'INSERT INTO journeys (id, project_id, journey_key, version, is_current, data, label) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [uuid(), req.params['id'], req.params['journeyKey'], (count?.cnt ?? 0) + 1, JSON.stringify(targetData), `Restored from v${req.params['version']}`],
  );

  const versions = await query<JourneyRow>('SELECT * FROM journeys WHERE journey_key = ? ORDER BY version ASC', [req.params['journeyKey']]);
  res.json({ current: targetData, versions: toVersionHistory(versions) });
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

// GET /projects/:id/tasks
projectsRouter.get('/:id/tasks', async (req, res) => {
  const rows = await query<TaskRow>(
    'SELECT * FROM tasks WHERE project_id = ? AND is_current = 1',
    [req.params['id']],
  );
  if (rows.length === 0) { res.json([]); return; }

  const result = await Promise.all(
    rows.map(async (row) => {
      const versions = await query<TaskRow>('SELECT * FROM tasks WHERE task_key = ? ORDER BY version ASC', [row.task_key]);
      return {
        current: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
        versions: toVersionHistory(versions),
      };
    }),
  );
  res.json(result);
});

// POST /projects/:id/tasks/generate
projectsRouter.post('/:id/tasks/generate', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const journeyRows = await query<JourneyRow>('SELECT * FROM journeys WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (journeyRows.length === 0) { res.status(400).json({ error: 'Generate journeys first.' }); return; }

  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const epicMap = new Map<string, Epic>(
    epicRows.map((r) => {
      const d = safeJsonParse<Epic>(r.data, {} as Epic);
      return [d.id, d];
    }),
  );

  const { systemPrompt, userTemplate } = await getPromptConfig('task_decomposition', req.user!.orgId, promptType(project.project_type));
  const challengeText = (req.body as { challengeText?: string }).challengeText ?? '';

  await execute('UPDATE tasks SET is_current = 0 WHERE project_id = ?', [req.params['id']]);

  // Generate tasks per-journey with bounded concurrency. Sequential generation
  // for 15+ journeys takes 75-150s and was silently dropping failures. We run
  // 2 in parallel — high enough to keep wall time reasonable, low enough that
  // OpenAI's lower tier (T1) doesn't 429 mid-batch. Retry/backoff for transient
  // 429s/5xx is handled inside callLLM. Hard quota errors bubble up as
  // "quota exceeded" so the user can switch provider.
  const provider = project.provider as 'anthropic' | 'openai';
  const CONCURRENCY = provider === 'openai' ? 2 : 3;

  type JourneyOutcome = { journey: Journey; tasks: import('../ai/index.js').Task[] | null; error: string | null };

  async function generateForJourney(journey: Journey): Promise<JourneyOutcome> {
    const epic = epicMap.get(journey.epicId);
    if (!epic) {
      return { journey, tasks: null, error: `parent epic missing for journey ${journey.id ?? journey.title}` };
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // startIndex=0 here; we re-number wbsIds globally after all results come back
        const tasks = await generateTasks(journey, epic, provider, systemPrompt, userTemplate, 0, challengeText);
        return { journey, tasks, error: null };
      } catch (err) {
        lastErr = err;
        // Don't retry on JSON-parse / validation errors — they're deterministic
        // (the model gave bad output, retrying gets the same bad output) and
        // double the wall-clock time. Only retry on network/timeout errors.
        const msg = err instanceof Error ? err.message : String(err);
        if (/JSON|parse|invalid|schema|too small/i.test(msg)) break;
      }
    }
    return { journey, tasks: null, error: lastErr instanceof Error ? lastErr.message : String(lastErr) };
  }

  const journeys = journeyRows.map((row) => safeJsonParse<Journey>(row.data, {} as Journey));
  const outcomes: JourneyOutcome[] = [];

  for (let i = 0; i < journeys.length; i += CONCURRENCY) {
    const batch = journeys.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((j) => generateForJourney(j)));

    // Insert this batch's tasks into the DB BEFORE starting the next batch so
    // the frontend polling sees tasks streaming in instead of one big drop at
    // the end. WBS numbering is finalized after all batches complete.
    for (const outcome of batchResults) {
      if (outcome.tasks) {
        for (const task of outcome.tasks) {
          await execute(
            'INSERT INTO tasks (id, project_id, task_key, version, is_current, data, label) VALUES (?, ?, ?, 1, 1, ?, ?)',
            [uuid(), req.params['id'], task.id, JSON.stringify(task), 'AI Generated v1'],
          );
        }
      }
    }
    outcomes.push(...batchResults);
  }

  // Finalize WBS numbering across all generated tasks (deterministic order =
  // journey order, then task order within journey).
  const allResults: Array<{ current: unknown; versions: unknown[] }> = [];
  const failures: string[] = [];
  let wbsCounter = 1;

  for (const outcome of outcomes) {
    if (!outcome.tasks) {
      failures.push(`"${outcome.journey.title ?? outcome.journey.id}": ${outcome.error}`);
      continue;
    }
    for (const task of outcome.tasks) {
      const wbsId = `WBS-${String(wbsCounter++).padStart(3, '0')}`;
      const finalTask = { ...task, wbsId };
      await execute(
        'UPDATE tasks SET data = ? WHERE project_id = ? AND task_key = ? AND is_current = 1',
        [JSON.stringify(finalTask), req.params['id'], task.id],
      );
      allResults.push({
        current: finalTask,
        versions: [{ version: 1, label: 'AI Generated v1', challengeText: '', createdAt: new Date().toISOString(), data: finalTask }],
      });
    }
  }

  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  if (failures.length > 0) {
    console.warn('[tasks/generate] partial failures:', failures);
  }
  res.json({ tasks: allResults, failures });
}));

// PATCH /projects/:id/tasks/:taskKey
projectsRouter.patch('/:id/tasks/:taskKey', async (req, res) => {
  const current = await queryOne<TaskRow>(
    'SELECT * FROM tasks WHERE project_id = ? AND task_key = ? AND is_current = 1',
    [req.params['id'], req.params['taskKey']],
  );
  if (!current) { res.status(404).json({ error: 'Task not found.' }); return; }

  const currentData = typeof current.data === 'string' ? JSON.parse(current.data) : current.data;
  const updated = { ...currentData, ...req.body };

  await execute('UPDATE tasks SET is_current = 0 WHERE task_key = ?', [req.params['taskKey']]);
  await execute(
    'INSERT INTO tasks (id, project_id, task_key, version, is_current, data, label) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [uuid(), req.params['id'], req.params['taskKey'], current.version + 1, JSON.stringify(updated), 'Updated'],
  );
  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  const versions = await query<TaskRow>('SELECT * FROM tasks WHERE task_key = ? ORDER BY version ASC', [req.params['taskKey']]);
  res.json({ current: updated, versions: toVersionHistory(versions) });
});

// POST /projects/:id/tasks/:taskKey/rewrite
projectsRouter.post('/:id/tasks/:taskKey/rewrite', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const current = await queryOne<TaskRow>(
    'SELECT * FROM tasks WHERE project_id = ? AND task_key = ? AND is_current = 1',
    [req.params['id'], req.params['taskKey']],
  );
  if (!current) { res.status(404).json({ error: 'Task not found.' }); return; }

  const currentData = safeJsonParse<Record<string, unknown>>(current.data, {});
  const instruction = (req.body as { instruction?: string }).instruction ?? '';
  const { systemPrompt } = await getPromptConfig('task_decomposition', req.user!.orgId, promptType(project.project_type));

  let rewritten;
  try {
    rewritten = await rewriteItem('task', currentData, instruction, project.provider as 'anthropic' | 'openai', systemPrompt);
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  await execute('UPDATE tasks SET is_current = 0 WHERE task_key = ?', [req.params['taskKey']]);
  const short = instruction.length > 50 ? instruction.slice(0, 50) + '…' : instruction;
  await execute(
    'INSERT INTO tasks (id, project_id, task_key, version, is_current, data, label) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [uuid(), req.params['id'], req.params['taskKey'], current.version + 1, JSON.stringify(rewritten), `Rewritten: ${short}`],
  );

  const versions = await query<TaskRow>('SELECT * FROM tasks WHERE task_key = ? ORDER BY version ASC', [req.params['taskKey']]);
  res.json({ current: rewritten, versions: toVersionHistory(versions) });
}));

// POST /projects/:id/tasks/:taskKey/restore/:version
projectsRouter.post('/:id/tasks/:taskKey/restore/:version', async (req, res) => {
  const target = await queryOne<TaskRow>(
    'SELECT * FROM tasks WHERE task_key = ? AND version = ?',
    [req.params['taskKey'], req.params['version']],
  );
  if (!target) { res.status(404).json({ error: 'Version not found.' }); return; }

  await execute('UPDATE tasks SET is_current = 0 WHERE task_key = ?', [req.params['taskKey']]);
  const count = await queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM tasks WHERE task_key = ?', [req.params['taskKey']]);
  const targetData = typeof target.data === 'string' ? JSON.parse(target.data) : target.data;
  await execute(
    'INSERT INTO tasks (id, project_id, task_key, version, is_current, data, label) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [uuid(), req.params['id'], req.params['taskKey'], (count?.cnt ?? 0) + 1, JSON.stringify(targetData), `Restored from v${req.params['version']}`],
  );

  const versions = await query<TaskRow>('SELECT * FROM tasks WHERE task_key = ? ORDER BY version ASC', [req.params['taskKey']]);
  res.json({ current: targetData, versions: toVersionHistory(versions) });
});

// ─── Sync ─────────────────────────────────────────────────────────────────────

// POST /projects/:id/sync
projectsRouter.post('/:id/sync', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const orgId = req.user!.orgId;

  // Look up ClickUp credentials from settings (per-org)
  interface SettingRow { value: string }
  const apiKeyRow = await queryOne<SettingRow>(
    'SELECT value FROM settings WHERE `key` = ? AND org_id = ?',
    ['clickup_api_key', orgId],
  );
  const spaceIdRow = await queryOne<SettingRow>(
    'SELECT value FROM settings WHERE `key` = ? AND org_id = ?',
    ['clickup_space_id', orgId],
  );

  const apiKey = apiKeyRow?.value?.trim();
  const spaceId = spaceIdRow?.value?.trim();

  const ts = () => new Date().toISOString();

  if (!apiKey) {
    res.json({
      log: [{ timestamp: ts(), message: 'ClickUp API key not configured. Add it in Admin → Integrations.', type: 'error' }],
      syncedCount: 0,
    });
    return;
  }
  if (!spaceId) {
    res.json({
      log: [{ timestamp: ts(), message: 'ClickUp Space ID not configured. Add it in Admin → Integrations.', type: 'error' }],
      syncedCount: 0,
    });
    return;
  }

  try {
    const result = await syncProjectToClickUp(
      { id: project.id, name: project.name, client: project.client },
      apiKey,
      spaceId,
    );
    if (result.syncedCount > 0 && result.errorCount === 0) {
      await execute("UPDATE projects SET status = 'synced', updated_at = NOW() WHERE id = ?", [project.id]);
    }
    res.json({ log: result.log, syncedCount: result.syncedCount, errorCount: result.errorCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown sync error';
    console.error('[sync]', err);
    res.json({
      log: [{ timestamp: ts(), message: `Sync failed: ${msg}`, type: 'error' }],
      syncedCount: 0,
    });
  }
}));

// GET /projects/:id/sync/status
// Returns which tasks have been synced to ClickUp + last sync log lines.
// Used by the Sync page to restore state after a refresh.
projectsRouter.get('/:id/sync/status', asyncHandler(async (req, res) => {
  const projectId = req.params['id']!;

  interface MappingRow { entity_key: string; clickup_id: string; updated_at: string }
  const taskMappings = await query<MappingRow>(
    "SELECT entity_key, clickup_id, updated_at FROM clickup_mappings WHERE project_id = ? AND entity_type = 'task'",
    [projectId],
  );

  // Build a map: { task_key: 'synced' } for the frontend to use
  const syncedTaskKeys: Record<string, { clickupId: string; syncedAt: string }> = {};
  for (const row of taskMappings) {
    syncedTaskKeys[row.entity_key] = { clickupId: row.clickup_id, syncedAt: row.updated_at };
  }

  // Last 50 sync log entries — used to populate the log panel after a refresh
  interface SyncLogRow {
    method: string; url: string; status_code: number; ok: number; error: string | null;
    wbs_id: string; created_at: string; duration_ms: number;
  }
  const recentLogs = await query<SyncLogRow>(
    `SELECT method, url, status_code, ok, error, wbs_id, created_at, duration_ms
     FROM sync_log WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`,
    [projectId],
  );

  // Latest sync timestamp
  const lastSync = recentLogs[0]?.created_at ?? null;

  // Format log rows into the same shape the frontend already renders
  // (timestamp, message, type). Reverse so oldest-first like a streamed log.
  const log = recentLogs.reverse().map((row) => {
    const ok = Boolean(row.ok);
    let message: string;
    if (row.error) {
      message = `${row.method} ${shortenUrl(row.url)} → ${row.status_code} (${row.error})`;
    } else if (row.wbs_id) {
      message = `✓ Synced ${row.wbs_id} (${row.method} → ${row.status_code}, ${row.duration_ms}ms)`;
    } else {
      message = `${row.method} ${shortenUrl(row.url)} → ${row.status_code} (${row.duration_ms}ms)`;
    }
    return {
      timestamp: row.created_at,
      message,
      type: ok ? 'success' as const : 'error' as const,
    };
  });

  res.json({
    syncedTaskKeys,
    syncedTaskCount: Object.keys(syncedTaskKeys).length,
    lastSyncedAt: lastSync,
    log,
  });
}));

function shortenUrl(url: string): string {
  return url.replace('https://api.clickup.com/api/v2', '');
}
