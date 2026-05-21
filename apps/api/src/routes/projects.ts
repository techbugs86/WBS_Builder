import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../db/index.js';
import { verifyJWT } from '../middleware/auth.js';
import { requireOrgProject } from '../middleware/requireOrgProject.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { generateBrief, generateEpics, generateEpicsForTier, generateJourneys, generateJourneysForEpic, generateTasks, rewriteItem, chatAboutEpics, chatAboutJourneys, chatAboutTasks, chatAboutBrief, chatAboutDefinition, chatAboutSync, generateOneEpic, generateOneJourney, generateOneTask, previewProject, previewStage, type Brief, type Epic, type Journey, type RewriteContext } from '../ai/index.js';
import { syncProjectToClickUp } from '../clickup/sync.js';
import { SELECTABLE_PROJECT_TYPES } from '../constants/enums.js';
import { sortEpicsByPriority } from '../lib/sortEpics.js';
import { extractAttachmentText } from '../lib/attachmentExtractor.js';
import { recordRegenEvent, getMostRecentRegenEvent, formatRegenContextForChat, recordBriefRegenEvent, getMostRecentBriefRegenEvent, formatBriefRegenContextForChat, diffBriefSnapshots } from '../lib/regenEvents.js';
import multer from 'multer';

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
  attachments_text: string | null;
  provider: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ProjectAttachmentRow {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: 'pending' | 'ok' | 'failed';
  extracted_chars: number;
  error_message: string | null;
  created_at: string;
}

// In-memory multer — files are extracted then dropped (we only persist the
// extracted text). 10 MB per file, max 5 files per request.
const ATTACHMENT_UPLOAD_LIMITS = { fileSize: 10 * 1024 * 1024, files: 5 };
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: ATTACHMENT_UPLOAD_LIMITS,
});

/**
 * Combines raw_input + attachments_text into one source string for the brief
 * extractor. Attachment text is fenced with a header so the LLM can tell the
 * two apart (and won't hallucinate that "the attached PRD says X" when the
 * user only pasted notes).
 */
export function combinedSourceText(rawInput: string, attachmentsText: string | null): string {
  const raw = (rawInput ?? '').trim();
  const att = (attachmentsText ?? '').trim();
  if (!att) return raw;
  if (!raw) return `--- ATTACHED DOCUMENTS ---\n${att}`;
  return `${raw}\n\n--- ATTACHED DOCUMENTS ---\n${att}`;
}

/**
 * Rebuilds projects.attachments_text by concatenating the extracted text of
 * every `ok` attachment in created_at order. Called after each successful
 * upload and after every delete so the brief generator always sees the
 * current set.
 */
async function rebuildAttachmentsText(projectId: string): Promise<void> {
  // We store extracted text per attachment in the project_attachments table?
  // No — only on the project row. To rebuild we keep a parallel column.
  // Simpler: track extracted text on the attachment row too, then concat.
  const rows = await query<ProjectAttachmentRow & { extracted_text: string | null }>(
    "SELECT id, filename, extracted_text FROM project_attachments WHERE project_id = ? AND status = 'ok' ORDER BY created_at ASC",
    [projectId],
  );
  const combined = rows
    .map((r) => `--- FILE: ${r.filename} ---\n${(r.extracted_text ?? '').trim()}`)
    .filter((b) => b.trim().length > 0)
    .join('\n\n');
  await execute('UPDATE projects SET attachments_text = ? WHERE id = ?', [combined || null, projectId]);
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

// ─── Attachments (project intake docs) ──────────────────────────────────────
// Uploaded files (PDF / DOCX / TXT / MD / image) are extracted to text and
// concatenated alongside raw_input when the brief is generated. We only
// persist the extracted text, never the original binary.

// GET /projects/:id/attachments — list metadata so the UI can show current files.
projectsRouter.get('/:id/attachments', asyncHandler(async (req, res) => {
  const rows = await query<ProjectAttachmentRow>(
    'SELECT id, project_id, filename, mime_type, size_bytes, status, extracted_chars, error_message, created_at FROM project_attachments WHERE project_id = ? ORDER BY created_at ASC',
    [req.params['id']],
  );
  res.json({ attachments: rows });
}));

// POST /projects/:id/attachments — multipart upload, runs extraction inline.
// Field name: "files" (one or more). Returns the inserted attachment rows
// with extraction status so the UI can show ok/failed per file.
projectsRouter.post(
  '/:id/attachments',
  attachmentUpload.array('files', ATTACHMENT_UPLOAD_LIMITS.files),
  asyncHandler(async (req, res) => {
    const project = req.project as unknown as ProjectRow;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No files received. Use multipart field "files".' });
      return;
    }

    const provider = (project.provider === 'openai' ? 'openai' : 'anthropic') as 'anthropic' | 'openai';
    const inserted: ProjectAttachmentRow[] = [];

    for (const file of files) {
      const id = uuid();
      let status: 'ok' | 'failed' = 'ok';
      let extractedText = '';
      let errorMessage: string | null = null;

      try {
        extractedText = await extractAttachmentText(file.buffer, file.originalname, file.mimetype, provider);
      } catch (err) {
        status = 'failed';
        errorMessage = err instanceof Error ? err.message.slice(0, 480) : 'Unknown extraction error.';
        console.warn(`[attachments] extraction failed for "${file.originalname}":`, errorMessage);
      }

      await execute(
        'INSERT INTO project_attachments (id, project_id, filename, mime_type, size_bytes, status, extracted_chars, extracted_text, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          req.params['id'],
          file.originalname.slice(0, 250),
          file.mimetype.slice(0, 120),
          file.size,
          status,
          extractedText.length,
          status === 'ok' ? extractedText : null,
          errorMessage,
        ],
      );

      inserted.push({
        id,
        project_id: req.params['id'] as string,
        filename: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        status,
        extracted_chars: extractedText.length,
        error_message: errorMessage,
        created_at: new Date().toISOString(),
      });
    }

    await rebuildAttachmentsText(req.params['id'] as string);
    res.json({ attachments: inserted });
  }),
);

// DELETE /projects/:id/attachments/:attachmentId — drop one file, rebuild
// the project's attachments_text so the brief generator stops seeing it.
projectsRouter.delete('/:id/attachments/:attachmentId', asyncHandler(async (req, res) => {
  const result = await execute(
    'DELETE FROM project_attachments WHERE id = ? AND project_id = ?',
    [req.params['attachmentId'], req.params['id']],
  );
  // mysql2 result.affectedRows tells us whether the file existed
  const affected = (result as unknown as { affectedRows: number }).affectedRows ?? 0;
  if (affected === 0) { res.status(404).json({ error: 'Attachment not found.' }); return; }
  await rebuildAttachmentsText(req.params['id'] as string);
  res.json({ deleted: true });
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

// GET /projects/:id/brief/preview — short AI-generated project description
// shown on the empty Brief page. Does NOT write to the DB. Cheap LLM call.
projectsRouter.get('/:id/brief/preview', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const source = combinedSourceText(project.raw_input ?? '', project.attachments_text);
  const summary = await previewProject(
    project.provider as 'anthropic' | 'openai',
    project.name ?? '',
    project.client ?? '',
    source,
  );
  res.json({ summary });
}));

// GET /projects/:id/:stage/preview — short AI preview for any pipeline stage.
// stage ∈ epics | journeys | tasks | sync. Reads brief for context.
projectsRouter.get('/:id/:stage(epics|journeys|tasks|sync)/preview', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const stage = req.params['stage'] as 'epics' | 'journeys' | 'tasks' | 'sync';

  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const brief = briefRow ? safeJsonParse<Brief>(briefRow.data, {} as Brief) : null;

  const summary = await previewStage(project.provider as 'anthropic' | 'openai', stage, {
    projectName: project.name ?? '',
    client: project.client ?? '',
    brief,
  });
  res.json({ summary });
}));

// POST /projects/:id/brief/generate
projectsRouter.post('/:id/brief/generate', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const { systemPrompt, userTemplate } = await getPromptConfig('brief_extraction', req.user!.orgId, promptType(project.project_type));
  const challengeText = (req.body as { challengeText?: string }).challengeText ?? '';

  // Snapshot the previous brief (if any) so we can record a regen diff
  // for the chat module to answer "what changed?".
  const previousBriefRow = await queryOne<BriefRow>(
    'SELECT * FROM briefs WHERE project_id = ? AND is_current = 1',
    [req.params['id']],
  );
  const previousBrief = previousBriefRow ? safeJsonParse<Brief>(previousBriefRow.data, {} as Brief) : null;

  // Source text = raw_input + extracted attachments (concatenated). The
  // brief extractor reads them as one document — same code path for typed
  // notes and uploaded scope docs.
  const source = combinedSourceText(project.raw_input ?? '', project.attachments_text);

  let brief;
  try {
    brief = await generateBrief(
      source,
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

  // Log this regen so the chat module can answer "what changed?".
  await recordBriefRegenEvent(
    req.params['id'] as string,
    previousBrief,
    brief as unknown as { summary?: string; inScope?: string[]; outOfScope?: string[]; assumptions?: Array<{ text?: string }>; openQuestions?: Array<{ text?: string }> },
    challengeText,
  );

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
    'SELECT * FROM epics WHERE project_id = ? AND is_current = 1 ORDER BY created_at ASC',
    [req.params['id']],
  );
  if (currentRows.length === 0) { res.json([]); return; }

  // Deterministic priority sort (Auth → other foundations → core value →
  // supporting → growth). The DB-level created_at rewrite from generate is
  // unreliable because `created_at` is DATETIME (whole-second precision),
  // so multiple inserts within the same second collapse to identical
  // timestamps and MySQL no longer guarantees deterministic order. Sorting
  // here means generate / regenerate / addOne via chat / restore / page
  // revisit all return the same canonical top-to-bottom order.
  const parsed = currentRows.map((row) => ({
    row,
    epic: (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Epic,
  }));
  const sortedEpics = sortEpicsByPriority(parsed.map((p) => p.epic));
  const rowByEpicId = new Map(parsed.map((p) => [p.epic.id, p.row]));

  const result = await Promise.all(
    sortedEpics.map(async (epic) => {
      const row = rowByEpicId.get(epic.id)!;
      const versions = await query<EpicRow>(
        'SELECT * FROM epics WHERE epic_key = ? ORDER BY version ASC',
        [row.epic_key],
      );
      return {
        current: epic,
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

  // Snapshot the BEFORE state so we can record a regen diff once the new
  // epics are in place. The chat module reads this to answer "what changed?".
  const beforeEpicsRows = await query<EpicRow>(
    'SELECT data FROM epics WHERE project_id = ? AND is_current = 1',
    [req.params['id']],
  );
  const beforeEpics = beforeEpicsRows
    .map((r) => safeJsonParse<Epic>(r.data, {} as Epic))
    .filter((e) => e && e.title);

  // Deactivate existing epics upfront so polling returns an empty list while
  // we're streaming in the new ones.
  await execute('UPDATE epics SET is_current = 0 WHERE project_id = ?', [req.params['id']]);

  // Parallelize the 3 tier LLM calls (foundation || core || supporting/growth).
  // Sequential generation was ~90s wall-clock (3 × ~30s per tier); running
  // them concurrently brings that down to roughly the slowest single tier
  // (~30s). The trade-off: each tier no longer sees the other tiers' output
  // for the "don't duplicate" guard. The per-tier system prompt already
  // pins each one to a specific scope (foundation / core / supporting+growth)
  // so cross-tier duplication is rare in practice, and the final priority
  // sort + add/remove chat actions let the PM clean up if it happens.
  //
  // Each tier still INSERTS its epics as soon as it resolves, so the
  // frontend's polling continues to see epics streaming in as tiers
  // complete (in whatever order they finish — usually all within a
  // few seconds of each other).
  const provider = project.provider as 'anthropic' | 'openai';
  const projectId = req.params['id'] as string;

  async function runTier(tier: 'foundation' | 'core_value' | 'supporting_growth'): Promise<Epic[]> {
    console.log(`[epics/generate] starting tier=${tier} (parallel)`);
    try {
      const batch = await generateEpicsForTier(brief, provider, systemPrompt, challengeText, tier, []);
      // Insert this tier's epics immediately so the frontend poll sees them
      // — no waiting for the slowest tier.
      for (const epic of batch) {
        await execute(
          'INSERT INTO epics (id, project_id, epic_key, version, is_current, data, label) VALUES (?, ?, ?, 1, 1, ?, ?)',
          [uuid(), projectId, epic.id, JSON.stringify(epic), 'AI Generated v1'],
        );
      }
      console.log(`[epics/generate] tier=${tier} produced ${batch.length} epics`);
      return batch;
    } catch (err) {
      // One tier failing no longer blocks the others — they already ran in parallel.
      console.warn(`[epics/generate] tier=${tier} failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  const [foundationBatch, coreBatch, supportingBatch] = await Promise.all([
    runTier('foundation'),
    runTier('core_value'),
    runTier('supporting_growth'),
  ]);
  const all: Epic[] = [...foundationBatch, ...coreBatch, ...supportingBatch];

  // If every tier failed and we have zero epics, treat as a hard error.
  if (all.length === 0) {
    throw llmErrorToHttp(new Error('All epic tier generations failed. Check the AI provider key and try again.'));
  }

  // Re-sort the final list by priority. Inserts kept their original
  // creation order so the SELECT ORDER BY created_at ASC respects tier
  // order naturally — but if the LLM mis-tiered any epic, the deterministic
  // sort catches it.
  const sorted = sortEpicsByPriority(all);

  // If sort changed the order, rewrite created_at so the SELECT order matches.
  // Cheap — at most a few UPDATEs.
  for (let i = 0; i < sorted.length; i++) {
    const epicKey = sorted[i]!.id;
    await execute(
      `UPDATE epics SET created_at = DATE_ADD(NOW(), INTERVAL ? MICROSECOND) WHERE project_id = ? AND epic_key = ? AND is_current = 1`,
      [i, req.params['id'], epicKey],
    );
  }

  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  // Log this regen so the chat module can answer "what changed?" with a
  // concrete add/remove list. Best-effort — failures don't affect the
  // user-visible result.
  await recordRegenEvent(
    req.params['id'] as string,
    'epics',
    beforeEpics.map((e) => ({ title: e.title })),
    sorted.map((e) => ({ title: e.title })),
    challengeText,
  );

  const saved = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1 ORDER BY created_at ASC', [req.params['id']]);
  // Same deterministic sort as GET /:id/epics — guarantees the response is
  // top-to-bottom prioritized regardless of insertion-order timing.
  const savedParsed = saved.map((r) => ({
    r,
    epic: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as Epic,
  }));
  const savedSorted = sortEpicsByPriority(savedParsed.map((p) => p.epic));
  const rByEpic = new Map(savedParsed.map((p) => [p.epic.id, p.r]));
  res.json(savedSorted.map((epic) => {
    const r = rByEpic.get(epic.id)!;
    return {
      current: epic,
      versions: [{ version: 1, label: 'AI Generated v1', challengeText: '', createdAt: r.created_at, data: epic }],
    };
  }));
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

  // Page context — brief + sibling epics so the rewrite stays consistent with
  // the rest of the Epics page and doesn't drift into journey/task territory.
  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const briefData = briefRow ? safeJsonParse<Brief>(briefRow.data, {} as Brief) : null;
  const siblingRows = await query<EpicRow>(
    'SELECT * FROM epics WHERE project_id = ? AND is_current = 1 AND epic_key <> ?',
    [req.params['id'], req.params['epicKey']],
  );
  const siblings = siblingRows.map((r) => {
    const d = safeJsonParse<Record<string, unknown>>(r.data, {});
    return {
      title: typeof d['title'] === 'string' ? d['title'] : undefined,
      summary: typeof d['description'] === 'string' ? d['description'].slice(0, 140) : undefined,
    };
  });
  const context: RewriteContext = {
    brief: briefData ? { summary: briefData.summary, scope: briefData.inScope, outOfScope: briefData.outOfScope } : null,
    siblings,
  };

  let rewritten;
  try {
    rewritten = await rewriteItem('epic', currentData, instruction, project.provider as 'anthropic' | 'openai', systemPrompt, context);
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

// POST /projects/:id/brief/chat — conversational reply about the brief.
// For mutating actions (add/remove/rewrite assumption, open question, scope
// item, summary) the route executes the mutation server-side, writes a new
// brief version, and returns the fresh brief so the frontend can refresh
// its state in one round-trip.
// For `regenerateAll` the route returns the instruction string and the
// frontend dispatches its existing generateBrief() flow.
projectsRouter.post('/:id/brief/chat', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (!briefRow) { res.status(400).json({ error: 'Generate a brief first.' }); return; }
  const body = req.body as { message?: string; history?: { role: 'user' | 'agent'; text: string }[] };
  const message = (body.message ?? '').trim();
  if (!message) { res.status(400).json({ error: 'message is required.' }); return; }
  const brief = safeJsonParse<Brief>(briefRow.data, {} as Brief);
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  // For "what changed?" questions, diff the current brief against the most
  // recently deactivated version straight from the briefs table. This works
  // for ALL existing projects (no dependency on regen_events being populated
  // from this session forward) — version history was always being kept
  // append-only, we just weren't reading from it.
  //
  // We also check the regen_events table as a secondary source so the
  // assistant can quote the user's last regeneration instruction when one
  // was recorded (useful context, but not essential).
  const previousBriefRow = await queryOne<BriefRow>(
    'SELECT * FROM briefs WHERE project_id = ? AND is_current = 0 ORDER BY version DESC LIMIT 1',
    [req.params['id']],
  );
  let regenContext = '';
  if (previousBriefRow) {
    const previousBrief = safeJsonParse<Brief>(previousBriefRow.data, {} as Brief);
    const recentBriefRegen = await getMostRecentBriefRegenEvent(req.params['id'] as string);
    regenContext = formatBriefRegenContextForChat({
      summary: diffBriefSnapshots(
        previousBrief as unknown as { summary?: string; inScope?: string[]; outOfScope?: string[]; assumptions?: Array<{ text?: string }>; openQuestions?: Array<{ text?: string }> },
        brief as unknown as { summary?: string; inScope?: string[]; outOfScope?: string[]; assumptions?: Array<{ text?: string }>; openQuestions?: Array<{ text?: string }> },
      ),
      instruction: recentBriefRegen?.instruction ?? null,
      createdAt: previousBriefRow.created_at,
    });
  }

  let chatResult;
  try { chatResult = await chatAboutBrief(project.provider as 'anthropic' | 'openai', brief, message, history, regenContext); }
  catch (err) { throw llmErrorToHttp(err); }

  const { reply, action } = chatResult;

  // `regenerateAll` is dispatched by the frontend — return the legacy shape
  // (`regenerate` string) so the existing client code path still works.
  if (action.type === 'regenerateAll') {
    res.json({ reply, action, regenerate: action.instruction });
    return;
  }

  // No mutation — pure chat. Return reply + action='none' + the current brief.
  if (action.type === 'none') {
    res.json({
      reply,
      action,
      brief: { current: brief, versions: toVersionHistory(await query<BriefRow>('SELECT * FROM briefs WHERE project_id = ? ORDER BY version ASC', [req.params['id']])) },
    });
    return;
  }

  // Apply the mutation to a working copy of the brief, then save as a new
  // version. We keep the brief data structure stable (id-bearing assumptions
  // and open questions) so the frontend never has to reconcile shape diffs.
  const next: Brief = JSON.parse(JSON.stringify(brief));

  switch (action.type) {
    case 'rewriteSummary':
      next.summary = action.text;
      break;
    case 'addAssumption':
      next.assumptions = [...(next.assumptions ?? []), { id: uuid(), text: action.text }];
      break;
    case 'removeAssumption': {
      const list = next.assumptions ?? [];
      if (action.index >= 1 && action.index <= list.length) {
        next.assumptions = list.filter((_, i) => i !== action.index - 1);
      }
      break;
    }
    case 'rewriteAssumption': {
      const list = next.assumptions ?? [];
      if (action.index >= 1 && action.index <= list.length) {
        next.assumptions = list.map((a, i) => (i === action.index - 1 ? { ...a, text: action.text } : a));
      }
      break;
    }
    case 'addOpenQuestion':
      next.openQuestions = [
        ...(next.openQuestions ?? []),
        { id: uuid(), text: action.text, status: 'open', answer: '' },
      ];
      break;
    case 'removeOpenQuestion': {
      // The index from the LLM points into the OPEN-only list (that's what we
      // showed it). Map back to the absolute index in openQuestions.
      const openIdx = openIndexAt(next.openQuestions ?? [], action.index);
      if (openIdx >= 0) {
        next.openQuestions = (next.openQuestions ?? []).filter((_, i) => i !== openIdx);
      }
      break;
    }
    case 'answerOpenQuestion': {
      const openIdx = openIndexAt(next.openQuestions ?? [], action.index);
      if (openIdx >= 0) {
        next.openQuestions = (next.openQuestions ?? []).map((q, i) =>
          i === openIdx ? { ...q, status: 'answered' as const, answer: action.answer } : q,
        );
      }
      break;
    }
    case 'addScopeItem':
      if (action.kind === 'in') next.inScope = [...(next.inScope ?? []), action.text];
      else next.outOfScope = [...(next.outOfScope ?? []), action.text];
      break;
    case 'removeScopeItem': {
      const list = action.kind === 'in' ? (next.inScope ?? []) : (next.outOfScope ?? []);
      if (action.index >= 1 && action.index <= list.length) {
        const filtered = list.filter((_, i) => i !== action.index - 1);
        if (action.kind === 'in') next.inScope = filtered;
        else next.outOfScope = filtered;
      }
      break;
    }
  }

  // Persist as new brief version — append-only, never destructive.
  await execute('UPDATE briefs SET is_current = 0 WHERE project_id = ?', [req.params['id']]);
  const existingCount = await queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM briefs WHERE project_id = ?', [req.params['id']]);
  const version = (existingCount?.cnt ?? 0) + 1;
  const shortLabel = `Chat: ${action.type}`;
  await execute(
    'INSERT INTO briefs (id, project_id, version, is_current, data, label, challenge_text) VALUES (?, ?, ?, 1, ?, ?, ?)',
    [uuid(), req.params['id'], version, JSON.stringify(next), shortLabel, ''],
  );

  const versions = await query<BriefRow>('SELECT * FROM briefs WHERE project_id = ? ORDER BY version ASC', [req.params['id']]);
  res.json({ reply, action, brief: { current: next, versions: toVersionHistory(versions) } });
}));

/** Maps a 1-based index into the OPEN-only subset of openQuestions back to
 *  the absolute index in the original array. Returns -1 when out of range.
 *  Status is widened to string since the project's question status enum
 *  has more values than we care about here (open | answered | dismissed). */
function openIndexAt(questions: Array<{ status: string }>, oneBasedOpenIndex: number): number {
  let seen = 0;
  for (let i = 0; i < questions.length; i++) {
    if (questions[i]?.status !== 'open') continue;
    seen++;
    if (seen === oneBasedOpenIndex) return i;
  }
  return -1;
}

// POST /projects/:id/definition/chat — answers questions about the project
// setup form OR updates a single allowed field on the project row.
// Field-to-column mapping below; anything else is blocked at the validator
// level inside chatAboutDefinition.
const DEFINITION_FIELD_TO_COLUMN: Record<string, string> = {
  name: 'name',
  client: 'client',
  projectType: 'project_type',
  estimatedBudget: 'estimated_budget',
  startDate: 'start_date',
  contactPerson: 'contact_person',
  rawInput: 'raw_input',
};

projectsRouter.post('/:id/definition/chat', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const body = req.body as { message?: string; history?: { role: 'user' | 'agent'; text: string }[] };
  const message = (body.message ?? '').trim();
  if (!message) { res.status(400).json({ error: 'message is required.' }); return; }
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  let chatResult;
  try {
    chatResult = await chatAboutDefinition(
      project.provider as 'anthropic' | 'openai',
      {
        name: project.name ?? '',
        client: project.client ?? '',
        project_type: project.project_type ?? '',
        estimated_budget: project.estimated_budget ?? '',
        start_date: project.start_date ?? '',
        raw_input: project.raw_input ?? '',
        contact_person: project.contact_person ?? '',
      },
      message,
      history,
    );
  } catch (err) { throw llmErrorToHttp(err); }

  const { reply, action } = chatResult;

  if (action.type === 'updateField') {
    const column = DEFINITION_FIELD_TO_COLUMN[action.field];
    if (column) {
      // Direct, narrow UPDATE — the column name is allowlisted above so we
      // cannot inject anything via the LLM-supplied field name.
      await execute(`UPDATE projects SET ${column} = ?, updated_at = NOW() WHERE id = ?`, [action.value, req.params['id']]);
    }
    const updated = await queryOne<ProjectRow>('SELECT * FROM projects WHERE id = ?', [req.params['id']]);
    res.json({ reply, action, project: updated });
    return;
  }

  res.json({ reply, action });
}));

// POST /projects/:id/sync/chat — answers questions about sync state OR
// returns an action ('triggerSync' | 'resetSync') for the frontend to
// execute against its existing sync store actions. The chat endpoint
// never actually pushes to ClickUp itself — that's still owned by the
// dedicated /sync route + the client-side startSync flow.
projectsRouter.post('/:id/sync/chat', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const body = req.body as { message?: string; history?: { role: 'user' | 'agent'; text: string }[] };
  const message = (body.message ?? '').trim();
  if (!message) { res.status(400).json({ error: 'message is required.' }); return; }
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  const taskRows = await query<TaskRow>('SELECT * FROM tasks WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const mappingRows = await query<{ entity_key: string; clickup_id: string }>(
    "SELECT entity_key, clickup_id FROM clickup_mappings WHERE project_id = ? AND entity_type = 'task'",
    [req.params['id']],
  );
  const syncedKeys = new Set(mappingRows.map((m) => m.entity_key));
  const syncedCount = taskRows.filter((t) => syncedKeys.has(t.task_key)).length;

  let chatResult;
  try {
    chatResult = await chatAboutSync(
      project.provider as 'anthropic' | 'openai',
      {
        projectName: project.name ?? '(untitled)',
        taskCount: taskRows.length,
        syncedCount,
        lastSyncedAt: null,
        recentErrors: [],
      },
      message,
      history,
    );
  } catch (err) { throw llmErrorToHttp(err); }

  res.json({ reply: chatResult.reply, action: chatResult.action });
}));

// POST /projects/:id/epics/chat — conversational reply about epics, no DB writes
projectsRouter.post('/:id/epics/chat', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (!briefRow) { res.status(400).json({ error: 'Generate a brief first.' }); return; }

  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1 ORDER BY created_at ASC', [req.params['id']]);

  const body = req.body as { message?: string; history?: { role: 'user' | 'agent'; text: string }[] };
  const message = (body.message ?? '').trim();
  if (!message) { res.status(400).json({ error: 'message is required.' }); return; }

  const brief = safeJsonParse<Brief>(briefRow.data, {} as Brief);
  const epics = epicRows.map((r) => safeJsonParse<Epic>(r.data, {} as Epic));
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  // Pull the most recent regen event so the chat can answer "what changed?"
  // questions referencing the previous list. Null when no recent regen exists.
  const recentRegen = await getMostRecentRegenEvent(req.params['id'] as string, 'epics');
  const regenContext = formatRegenContextForChat(recentRegen, 'epic');

  let result;
  try {
    result = await chatAboutEpics(project.provider as 'anthropic' | 'openai', brief, epics, message, history, regenContext);
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  // Translate the model's 1-based epicIndex into an actual epic id for
  // rewriteOne and removeOne. The model only sees a numbered list — it never
  // sees real UUIDs.
  if (result.rewriteOne) {
    const targetEpic = epics[result.rewriteOne.epicIndex - 1];
    if (targetEpic && typeof targetEpic.id === 'string') {
      res.json({
        reply: result.reply,
        rewriteOne: {
          epicId: targetEpic.id,
          epicTitle: targetEpic.title,
          instruction: result.rewriteOne.instruction,
        },
      });
      return;
    }
    res.json({ reply: `${result.reply}\n\n(I couldn't pinpoint which epic to change — could you name it?)` });
    return;
  }

  if (result.removeOne) {
    const targetEpic = epics[result.removeOne.epicIndex - 1];
    if (targetEpic && typeof targetEpic.id === 'string') {
      res.json({
        reply: result.reply,
        removeOne: { epicId: targetEpic.id, epicTitle: targetEpic.title },
      });
      return;
    }
    res.json({ reply: `${result.reply}\n\n(I couldn't pinpoint which epic to remove — could you name it?)` });
    return;
  }

  res.json(result);
}));

// POST /projects/:id/epics/add — append a single new epic without touching others
projectsRouter.post('/:id/epics/add', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (!briefRow) { res.status(400).json({ error: 'Generate a brief first.' }); return; }

  const { instruction } = req.body as { instruction?: string };
  if (typeof instruction !== 'string' || !instruction.trim()) {
    res.status(400).json({ error: 'instruction is required.' });
    return;
  }

  const brief = safeJsonParse<Brief>(briefRow.data, {} as Brief);
  const existingRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1 ORDER BY created_at ASC', [req.params['id']]);
  const existing = existingRows.map((r) => safeJsonParse<Epic>(r.data, {} as Epic));

  let epic: Epic;
  try {
    epic = await generateOneEpic(brief, existing, project.provider as 'anthropic' | 'openai', instruction.trim());
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  await execute(
    'INSERT INTO epics (id, project_id, epic_key, version, is_current, data, label) VALUES (?, ?, ?, 1, 1, ?, ?)',
    [uuid(), req.params['id'], epic.id, JSON.stringify(epic), 'AI Generated (added via chat)'],
  );
  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  res.json({
    current: epic,
    versions: [{ version: 1, label: 'AI Generated (added via chat)', challengeText: '', createdAt: new Date().toISOString(), data: epic }],
  });
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

// POST /projects/:id/journeys/chat — conversational reply about journeys
projectsRouter.post('/:id/journeys/chat', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (!briefRow) { res.status(400).json({ error: 'Generate a brief first.' }); return; }
  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1 ORDER BY created_at ASC', [req.params['id']]);
  const journeyRows = await query<JourneyRow>('SELECT * FROM journeys WHERE project_id = ? AND is_current = 1', [req.params['id']]);

  const body = req.body as { message?: string; history?: { role: 'user' | 'agent'; text: string }[] };
  const message = (body.message ?? '').trim();
  if (!message) { res.status(400).json({ error: 'message is required.' }); return; }

  const brief = safeJsonParse<Brief>(briefRow.data, {} as Brief);
  const epics = epicRows.map((r) => safeJsonParse<Epic>(r.data, {} as Epic));
  const journeys = journeyRows.map((r) => safeJsonParse<Journey>(r.data, {} as Journey));
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  const recentRegen = await getMostRecentRegenEvent(req.params['id'] as string, 'journeys');
  const regenContext = formatRegenContextForChat(recentRegen, 'journey');

  let result;
  try {
    result = await chatAboutJourneys(project.provider as 'anthropic' | 'openai', brief, epics, journeys, message, history, regenContext);
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  if (result.rewriteOne) {
    const target = journeys[result.rewriteOne.itemIndex - 1];
    if (target?.id) {
      res.json({ reply: result.reply, rewriteOne: { itemId: target.id, itemTitle: target.title, instruction: result.rewriteOne.instruction } });
      return;
    }
    res.json({ reply: `${result.reply}\n\n(I couldn't pinpoint which journey to change — could you name it?)` });
    return;
  }
  if (result.removeOne) {
    const target = journeys[result.removeOne.itemIndex - 1];
    if (target?.id) {
      res.json({ reply: result.reply, removeOne: { itemId: target.id, itemTitle: target.title } });
      return;
    }
    res.json({ reply: `${result.reply}\n\n(I couldn't pinpoint which journey to remove — could you name it?)` });
    return;
  }
  res.json(result);
}));

// POST /projects/:id/journeys/add — append one new journey without disturbing others
projectsRouter.post('/:id/journeys/add', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (!briefRow) { res.status(400).json({ error: 'Generate a brief first.' }); return; }
  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1 ORDER BY created_at ASC', [req.params['id']]);
  const existingRows = await query<JourneyRow>('SELECT * FROM journeys WHERE project_id = ? AND is_current = 1', [req.params['id']]);

  const { instruction } = req.body as { instruction?: string };
  if (typeof instruction !== 'string' || !instruction.trim()) {
    res.status(400).json({ error: 'instruction is required.' });
    return;
  }

  const brief = safeJsonParse<Brief>(briefRow.data, {} as Brief);
  const epics = epicRows.map((r) => safeJsonParse<Epic>(r.data, {} as Epic));
  const existing = existingRows.map((r) => safeJsonParse<Journey>(r.data, {} as Journey));

  let journey: Journey;
  try {
    journey = await generateOneJourney(brief, epics, existing, project.provider as 'anthropic' | 'openai', instruction.trim());
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  await execute(
    'INSERT INTO journeys (id, project_id, journey_key, version, is_current, data, label) VALUES (?, ?, ?, 1, 1, ?, ?)',
    [uuid(), req.params['id'], journey.id, JSON.stringify(journey), 'AI Generated (added via chat)'],
  );
  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  res.json({
    current: journey,
    versions: [{ version: 1, label: 'AI Generated (added via chat)', challengeText: '', createdAt: new Date().toISOString(), data: journey }],
  });
}));

// POST /projects/:id/journeys/generate
projectsRouter.post('/:id/journeys/generate', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (!briefRow) { res.status(400).json({ error: 'Generate a brief first.' }); return; }

  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1 ORDER BY created_at ASC', [req.params['id']]);
  if (epicRows.length === 0) { res.status(400).json({ error: 'Generate epics first.' }); return; }

  const brief = safeJsonParse<Brief>(briefRow.data, {} as Brief);
  const epics = epicRows.map((r) => safeJsonParse<Epic>(r.data, {} as Epic));
  const { systemPrompt, userTemplate } = await getPromptConfig('journey_generation', req.user!.orgId, promptType(project.project_type));
  const challengeText = (req.body as { challengeText?: string }).challengeText ?? '';
  const provider = project.provider as 'anthropic' | 'openai';

  // Snapshot the BEFORE state so we can record a regen diff for chat context.
  const beforeJourneyRows = await query<JourneyRow>(
    'SELECT data FROM journeys WHERE project_id = ? AND is_current = 1',
    [req.params['id']],
  );
  const beforeJourneys = beforeJourneyRows
    .map((r) => safeJsonParse<Journey>(r.data, {} as Journey))
    .filter((j) => j && j.title);

  // Deactivate the existing journeys UPFRONT so the polling endpoint returns
  // an empty list during the LLM call — the user sees journeys appear from a
  // clean slate rather than seeing old data swap with new data at the end.
  await execute('UPDATE journeys SET is_current = 0 WHERE project_id = ?', [req.params['id']]);

  // Stream journeys epic-by-epic. Generate in batches of CONCURRENCY epics in
  // parallel, then INSERT each batch's journeys into the DB before moving on.
  // The frontend polls GET /journeys every 3s, so journey cards appear in the
  // sidebar as each batch lands.
  const CONCURRENCY = 3;
  const failures: string[] = [];

  for (let i = 0; i < epics.length; i += CONCURRENCY) {
    const batch = epics.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((epic) => generateJourneysForEpic(epic, brief, provider, systemPrompt, userTemplate, challengeText)),
    );

    // Insert this batch's journeys immediately — that's what makes them
    // visible to the next poll. Without this, all inserts happen at the end.
    for (let j = 0; j < results.length; j++) {
      const r = results[j]!;
      if (r.status === 'fulfilled') {
        for (const journey of r.value) {
          await execute(
            'INSERT INTO journeys (id, project_id, journey_key, version, is_current, data, label) VALUES (?, ?, ?, 1, 1, ?, ?)',
            [uuid(), req.params['id'], journey.id, JSON.stringify(journey), 'AI Generated v1'],
          );
        }
      } else {
        const epicTitle = batch[j]!.title;
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.warn(`[journeys/generate] epic "${epicTitle}" failed:`, reason);
        failures.push(`${epicTitle}: ${reason}`);
      }
    }
  }

  // If every batch failed, surface that as an HTTP error instead of silently
  // returning an empty list.
  const savedRows = await query<JourneyRow>('SELECT * FROM journeys WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (savedRows.length === 0 && failures.length > 0) {
    throw llmErrorToHttp(new Error(`Journey generation failed for every epic: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`));
  }

  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  // Log this regen so the chat module can answer "what changed?".
  const afterJourneys = savedRows
    .map((r) => safeJsonParse<Journey>(r.data, {} as Journey))
    .filter((j) => j && j.title);
  await recordRegenEvent(
    req.params['id'] as string,
    'journeys',
    beforeJourneys.map((j) => ({ title: j.title })),
    afterJourneys.map((j) => ({ title: j.title })),
    challengeText,
  );

  res.json(savedRows.map((r) => ({
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

  // Page context — parent epic (to pin scope) + sibling journeys for that epic.
  // The brief is also included so the rewrite can't contradict project scope.
  const parentEpicId = typeof currentData['epicId'] === 'string' ? currentData['epicId'] as string : null;
  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const briefData = briefRow ? safeJsonParse<Brief>(briefRow.data, {} as Brief) : null;
  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const parentEpicData = parentEpicId
    ? epicRows.map((r) => safeJsonParse<Record<string, unknown>>(r.data, {})).find((d) => d['id'] === parentEpicId)
    : null;
  const siblingRows = await query<JourneyRow>(
    'SELECT * FROM journeys WHERE project_id = ? AND is_current = 1 AND journey_key <> ?',
    [req.params['id'], req.params['journeyKey']],
  );
  const siblings = siblingRows
    .map((r) => safeJsonParse<Record<string, unknown>>(r.data, {}))
    .filter((d) => !parentEpicId || d['epicId'] === parentEpicId)
    .map((d) => ({
      title: typeof d['title'] === 'string' ? d['title'] : undefined,
      summary: typeof d['happyPath'] === 'string' ? d['happyPath'].slice(0, 140) : undefined,
    }));
  const context: RewriteContext = {
    brief: briefData ? { summary: briefData.summary, scope: briefData.inScope, outOfScope: briefData.outOfScope } : null,
    parent: parentEpicData
      ? {
          title: typeof parentEpicData['title'] === 'string' ? parentEpicData['title'] : undefined,
          description: typeof parentEpicData['description'] === 'string' ? parentEpicData['description'] : undefined,
        }
      : null,
    siblings,
  };

  let rewritten;
  try {
    rewritten = await rewriteItem('journey', currentData, instruction, project.provider as 'anthropic' | 'openai', systemPrompt, context);
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

// POST /projects/:id/tasks/chat — conversational reply about tasks
projectsRouter.post('/:id/tasks/chat', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (!briefRow) { res.status(400).json({ error: 'Generate a brief first.' }); return; }
  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1 ORDER BY created_at ASC', [req.params['id']]);
  const journeyRows = await query<JourneyRow>('SELECT * FROM journeys WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const taskRows = await query<TaskRow>('SELECT * FROM tasks WHERE project_id = ? AND is_current = 1', [req.params['id']]);

  const body = req.body as { message?: string; history?: { role: 'user' | 'agent'; text: string }[] };
  const message = (body.message ?? '').trim();
  if (!message) { res.status(400).json({ error: 'message is required.' }); return; }

  const brief = safeJsonParse<Brief>(briefRow.data, {} as Brief);
  const epics = epicRows.map((r) => safeJsonParse<Epic>(r.data, {} as Epic));
  const journeys = journeyRows.map((r) => safeJsonParse<Journey>(r.data, {} as Journey));
  const tasks = taskRows.map((r) => safeJsonParse<Record<string, unknown>>(r.data, {} as Record<string, unknown>));
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  const recentRegen = await getMostRecentRegenEvent(req.params['id'] as string, 'tasks');
  const regenContext = formatRegenContextForChat(recentRegen, 'task');

  let result;
  try {
    result = await chatAboutTasks(project.provider as 'anthropic' | 'openai', brief, epics, journeys, tasks, message, history, regenContext);
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  if (result.rewriteOne) {
    const target = tasks[result.rewriteOne.itemIndex - 1];
    if (target && typeof target['id'] === 'string') {
      res.json({ reply: result.reply, rewriteOne: { itemId: target['id'], itemTitle: target['title'] ?? '', instruction: result.rewriteOne.instruction } });
      return;
    }
    res.json({ reply: `${result.reply}\n\n(I couldn't pinpoint which task to change — could you name it?)` });
    return;
  }
  if (result.removeOne) {
    const target = tasks[result.removeOne.itemIndex - 1];
    if (target && typeof target['id'] === 'string') {
      res.json({ reply: result.reply, removeOne: { itemId: target['id'], itemTitle: target['title'] ?? '' } });
      return;
    }
    res.json({ reply: `${result.reply}\n\n(I couldn't pinpoint which task to remove — could you name it?)` });
    return;
  }
  res.json(result);
}));

// POST /projects/:id/tasks/add — append one new task without disturbing others
projectsRouter.post('/:id/tasks/add', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;
  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (!briefRow) { res.status(400).json({ error: 'Generate a brief first.' }); return; }
  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1 ORDER BY created_at ASC', [req.params['id']]);
  const journeyRows = await query<JourneyRow>('SELECT * FROM journeys WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const existingRows = await query<TaskRow>('SELECT * FROM tasks WHERE project_id = ? AND is_current = 1', [req.params['id']]);

  const { instruction } = req.body as { instruction?: string };
  if (typeof instruction !== 'string' || !instruction.trim()) {
    res.status(400).json({ error: 'instruction is required.' });
    return;
  }

  const brief = safeJsonParse<Brief>(briefRow.data, {} as Brief);
  const epics = epicRows.map((r) => safeJsonParse<Epic>(r.data, {} as Epic));
  const journeys = journeyRows.map((r) => safeJsonParse<Journey>(r.data, {} as Journey));
  const existing = existingRows.map((r) => safeJsonParse<Record<string, unknown>>(r.data, {} as Record<string, unknown>));

  let task: Record<string, unknown>;
  try {
    task = await generateOneTask(brief, epics, journeys, existing, project.provider as 'anthropic' | 'openai', instruction.trim());
  } catch (err) {
    throw llmErrorToHttp(err);
  }

  const taskKey = String(task['id'] ?? uuid());
  await execute(
    'INSERT INTO tasks (id, project_id, task_key, version, is_current, data, label) VALUES (?, ?, ?, 1, 1, ?, ?)',
    [uuid(), req.params['id'], taskKey, JSON.stringify(task), 'AI Generated (added via chat)'],
  );
  await execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [req.params['id']]);

  res.json({
    current: task,
    versions: [{ version: 1, label: 'AI Generated (added via chat)', challengeText: '', createdAt: new Date().toISOString(), data: task }],
  });
}));

// POST /projects/:id/tasks/generate
projectsRouter.post('/:id/tasks/generate', asyncHandler(async (req, res) => {
  const project = req.project as unknown as ProjectRow;

  const journeyRows = await query<JourneyRow>('SELECT * FROM journeys WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  if (journeyRows.length === 0) { res.status(400).json({ error: 'Generate journeys first.' }); return; }

  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1 ORDER BY created_at ASC', [req.params['id']]);
  const epicMap = new Map<string, Epic>(
    epicRows.map((r) => {
      const d = safeJsonParse<Epic>(r.data, {} as Epic);
      return [d.id, d];
    }),
  );

  const { systemPrompt, userTemplate } = await getPromptConfig('task_decomposition', req.user!.orgId, promptType(project.project_type));
  const challengeText = (req.body as { challengeText?: string }).challengeText ?? '';

  // Snapshot the BEFORE state so we can record a regen diff for chat context.
  const beforeTaskRows = await query<TaskRow>(
    'SELECT data FROM tasks WHERE project_id = ? AND is_current = 1',
    [req.params['id']],
  );
  const beforeTasks = beforeTaskRows
    .map((r) => safeJsonParse<Record<string, unknown>>(r.data, {}))
    .filter((t) => typeof t['title'] === 'string');

  await execute('UPDATE tasks SET is_current = 0 WHERE project_id = ?', [req.params['id']]);

  // Generate tasks per-journey with bounded concurrency. For 15+ journeys
  // serial generation was 75–150s; at the default concurrency below it's
  // ~3–4x faster. Defaults assume a standard API tier (OpenAI T2+, Anthropic
  // normal) — both handle this load without rate-limit issues, and callLLM
  // already retries any transient 429/5xx with exponential backoff.
  //
  // If you're on OpenAI T1 (very low TPM cap) and seeing rate-limit errors,
  // lower these via env: TASK_GEN_CONCURRENCY_OPENAI=2 or
  // TASK_GEN_CONCURRENCY_ANTHROPIC=3.
  const provider = project.provider as 'anthropic' | 'openai';
  const defaultConcurrency = provider === 'openai' ? 5 : 8;
  const envKey = provider === 'openai' ? 'TASK_GEN_CONCURRENCY_OPENAI' : 'TASK_GEN_CONCURRENCY_ANTHROPIC';
  const envOverride = parseInt(process.env[envKey] ?? '', 10);
  const CONCURRENCY = Number.isFinite(envOverride) && envOverride > 0 ? envOverride : defaultConcurrency;
  console.log(`[tasks/generate] starting — ${journeyRows.length} journeys, concurrency=${CONCURRENCY}, provider=${provider}`);

  type JourneyOutcome = { journey: Journey; tasks: import('../ai/index.js').Task[] | null; error: string | null };

  async function generateForJourney(journey: Journey): Promise<JourneyOutcome> {
    const epic = epicMap.get(journey.epicId);
    if (!epic) {
      return { journey, tasks: null, error: `parent epic missing for journey ${journey.id ?? journey.title}` };
    }
    // No outer retry — callLLM already does exponential-backoff retry (1.5s +
    // 4s + 9s) for transient 429/5xx errors. The previous outer 2-attempt
    // loop was double-retrying, doubling worst-case latency for no quality
    // win (deterministic errors like bad JSON repeat anyway).
    const startMs = Date.now();
    try {
      const tasks = await generateTasks(journey, epic, provider, systemPrompt, userTemplate, 0, challengeText);
      const elapsed = Date.now() - startMs;
      console.log(`[tasks/generate] journey "${(journey.title ?? '').slice(0, 40)}" → ${tasks.length} tasks in ${elapsed}ms`);
      return { journey, tasks, error: null };
    } catch (err) {
      const elapsed = Date.now() - startMs;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[tasks/generate] journey "${(journey.title ?? '').slice(0, 40)}" FAILED after ${elapsed}ms: ${msg.slice(0, 120)}`);
      return { journey, tasks: null, error: msg };
    }
  }

  const journeys = journeyRows.map((row) => safeJsonParse<Journey>(row.data, {} as Journey));
  // Indexed by journey position so the final wbs-renumber loop reads them in
  // journey order even though workers complete in completion order.
  const outcomesByIndex: (JourneyOutcome | undefined)[] = new Array(journeys.length);
  const totalStartMs = Date.now();

  // Worker-pool concurrency. The old "batches of N then Promise.all + next
  // batch" pattern stalled the whole batch on its slowest journey. A worker
  // pool keeps CONCURRENCY workers continuously busy — as soon as one
  // journey finishes, that worker picks up the next available journey
  // immediately. On a project where some journeys are 5s and some are 30s
  // this gives a roughly 2-3x speedup on top of the higher concurrency.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= journeys.length) return;
      const journey = journeys[idx]!;
      const outcome = await generateForJourney(journey);
      outcomesByIndex[idx] = outcome;

      // Insert immediately so frontend polling sees tasks streaming in.
      if (outcome.tasks) {
        for (const task of outcome.tasks) {
          await execute(
            'INSERT INTO tasks (id, project_id, task_key, version, is_current, data, label) VALUES (?, ?, ?, 1, 1, ?, ?)',
            [uuid(), req.params['id'], task.id, JSON.stringify(task), 'AI Generated v1'],
          );
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, journeys.length) }, () => worker()));
  const outcomes: JourneyOutcome[] = outcomesByIndex.filter((o): o is JourneyOutcome => o != null);
  console.log(`[tasks/generate] all journeys done in ${Date.now() - totalStartMs}ms`);

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

  // Log this regen so the chat module can answer "what changed?".
  const afterTaskTitles = allResults
    .map((r) => (r.current as { title?: string }).title)
    .filter((t): t is string => typeof t === 'string');
  await recordRegenEvent(
    req.params['id'] as string,
    'tasks',
    beforeTasks.map((t) => ({ title: t['title'] as string })),
    afterTaskTitles.map((title) => ({ title })),
    challengeText,
  );

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

  // Page context — parent journey (happy path + steps) + grandparent epic
  // (title + description) + sibling tasks for the same journey. Keeps the
  // rewrite pinned to the Tasks page and prevents the LLM from drifting up
  // into journey or epic scope.
  const parentJourneyId = typeof currentData['journeyId'] === 'string' ? currentData['journeyId'] as string : null;
  const parentEpicId = typeof currentData['epicId'] === 'string' ? currentData['epicId'] as string : null;
  const briefRow = await queryOne<BriefRow>('SELECT * FROM briefs WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const briefData = briefRow ? safeJsonParse<Brief>(briefRow.data, {} as Brief) : null;
  const journeyRows = await query<JourneyRow>('SELECT * FROM journeys WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const epicRows = await query<EpicRow>('SELECT * FROM epics WHERE project_id = ? AND is_current = 1', [req.params['id']]);
  const parentJourneyData = parentJourneyId
    ? journeyRows.map((r) => safeJsonParse<Record<string, unknown>>(r.data, {})).find((d) => d['id'] === parentJourneyId)
    : null;
  const grandparentEpicData = parentEpicId
    ? epicRows.map((r) => safeJsonParse<Record<string, unknown>>(r.data, {})).find((d) => d['id'] === parentEpicId)
    : null;
  const siblingRows = await query<TaskRow>(
    'SELECT * FROM tasks WHERE project_id = ? AND is_current = 1 AND task_key <> ?',
    [req.params['id'], req.params['taskKey']],
  );
  const siblings = siblingRows
    .map((r) => safeJsonParse<Record<string, unknown>>(r.data, {}))
    .filter((d) => !parentJourneyId || d['journeyId'] === parentJourneyId)
    .map((d) => ({
      title: typeof d['title'] === 'string' ? d['title'] : undefined,
      summary: typeof d['estimateHours'] === 'number' ? `${d['estimateHours']}h estimate` : undefined,
    }));
  const context: RewriteContext = {
    brief: briefData ? { summary: briefData.summary, scope: briefData.inScope, outOfScope: briefData.outOfScope } : null,
    grandparent: grandparentEpicData
      ? {
          title: typeof grandparentEpicData['title'] === 'string' ? grandparentEpicData['title'] : undefined,
          description: typeof grandparentEpicData['description'] === 'string' ? grandparentEpicData['description'] : undefined,
        }
      : null,
    parent: parentJourneyData
      ? {
          title: typeof parentJourneyData['title'] === 'string' ? parentJourneyData['title'] : undefined,
          description: typeof parentJourneyData['happyPath'] === 'string' ? parentJourneyData['happyPath'] : undefined,
        }
      : null,
    siblings,
  };

  let rewritten;
  try {
    rewritten = await rewriteItem('task', currentData, instruction, project.provider as 'anthropic' | 'openai', systemPrompt, context);
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
