import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../db/index.js';
import { clickupRequest } from './client.js';

interface MappingRow {
  clickup_id: string;
}

interface ProjectRow {
  id: string;
  name: string;
  client: string;
}

interface EpicRow {
  epic_key: string;
  data: string;
}

interface JourneyRow {
  journey_key: string;
  data: string;
}

interface TaskRow {
  task_key: string;
  data: string;
}

interface TaskData {
  id: string;
  wbsId: string;
  title: string;
  estimateHours: number;
  domain: string;
  epicId: string;
  journeyId: string;
  acceptanceCriteria: Array<{ type: 'functional' | 'non-functional' | 'technical'; given: string; when: string; then: string }>;
  status: string;
}

interface EpicData {
  id: string;
  title: string;
  description: string;
  domain: string;
  storyPoints?: number;
}

interface JourneyData {
  id: string;
  epicId: string;
  title: string;
  persona: string;
  happyPath: string;
  steps: string[];
  edgeCases: string[];
}

export interface SyncLogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export interface SyncResult {
  log: SyncLogEntry[];
  syncedCount: number;
  errorCount: number;
}

function ts(): string { return new Date().toISOString(); }

async function getMapping(projectId: string, type: 'folder' | 'list' | 'task', key: string): Promise<string | null> {
  const row = await queryOne<MappingRow>(
    'SELECT clickup_id FROM clickup_mappings WHERE project_id = ? AND entity_type = ? AND entity_key = ?',
    [projectId, type, key],
  );
  return row?.clickup_id ?? null;
}

async function setMapping(projectId: string, type: 'folder' | 'list' | 'task', key: string, clickupId: string): Promise<void> {
  await execute(
    `INSERT INTO clickup_mappings (id, project_id, entity_type, entity_key, clickup_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE clickup_id = ?, updated_at = NOW()`,
    [uuid(), projectId, type, key, clickupId, clickupId],
  );
}

// ─── Description formatters ──────────────────────────────────────────────────
//
// Plain-markdown descriptions for ClickUp. ClickUp renders **bold**, ## H2,
// numbered/bulleted lists, and code fences in task descriptions out of the box.
// Keep these formatters dumb (no LLM calls) so sync stays deterministic.

function epicDescription(epic: EpicData): string {
  return [
    `**Domain:** ${epic.domain}`,
    epic.storyPoints !== undefined ? `**Story points:** ${epic.storyPoints}` : '',
    '',
    epic.description || '_No description._',
  ].filter(Boolean).join('\n');
}

function journeyDescription(journey: JourneyData): string {
  const stepLines = (journey.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const edgeLines = (journey.edgeCases ?? []).map((e, i) => `${i + 1}. ${e}`).join('\n');
  return [
    `**Persona:** ${journey.persona || '_unspecified_'}`,
    '',
    '## Happy Path',
    journey.happyPath || '_None._',
    '',
    '## Steps',
    stepLines || '_None._',
    '',
    '## Edge Cases',
    edgeLines || '_None._',
  ].join('\n');
}

/**
 * Task description with AC grouped by FR / NFR / Technical sections, so the
 * dev reading the ClickUp task sees the requirements organized by type
 * (matching the PM's mental model from the Tasks page in the app).
 */
function taskDescription(task: TaskData): string {
  const byType = {
    functional: task.acceptanceCriteria.filter((ac) => ac.type === 'functional'),
    'non-functional': task.acceptanceCriteria.filter((ac) => ac.type === 'non-functional'),
    technical: task.acceptanceCriteria.filter((ac) => ac.type === 'technical'),
  };
  const renderAC = (group: Array<{ given: string; when: string; then: string }>): string =>
    group.map((ac, i) => `${i + 1}. **Given** ${ac.given}\n   **When** ${ac.when}\n   **Then** ${ac.then}`).join('\n\n');

  const sections: string[] = [
    `**WBS ID:** \`${task.wbsId}\``,
    `**Domain:** ${task.domain}`,
    `**Estimate:** ${task.estimateHours}h`,
    '',
  ];
  if (byType.functional.length > 0) {
    sections.push('## Functional Requirements (FR)', renderAC(byType.functional), '');
  }
  if (byType['non-functional'].length > 0) {
    sections.push('## Non-Functional Requirements (NFR)', renderAC(byType['non-functional']), '');
  }
  if (byType.technical.length > 0) {
    sections.push('## Technical Constraints', renderAC(byType.technical), '');
  }
  if (byType.functional.length + byType['non-functional'].length + byType.technical.length === 0) {
    sections.push('_No acceptance criteria defined._');
  }
  return sections.join('\n').trim();
}

// ─── Destructive cleanup ─────────────────────────────────────────────────────
//
// "Start over" mode: delete the existing ClickUp folder for this project
// (which cascades through lists, tasks, and subtasks), then wipe all
// mappings so the rebuild below starts from a clean slate. This is the
// path chosen when the user re-syncs with a new hierarchy shape.

async function destructiveCleanup(
  projectId: string,
  apiKey: string,
  log: SyncLogEntry[],
): Promise<void> {
  const folderId = await getMapping(projectId, 'folder', projectId);
  if (folderId) {
    log.push({ timestamp: ts(), message: `↻ Cleanup: deleting existing ClickUp folder ${folderId} and all nested lists/tasks/subtasks…`, type: 'info' });
    const res = await clickupRequest(`/folder/${folderId}`, { method: 'DELETE', projectId, apiKey });
    if (res.ok || res.status === 404) {
      log.push({ timestamp: ts(), message: `✓ Cleanup: existing folder removed.`, type: 'success' });
    } else {
      log.push({ timestamp: ts(), message: `⚠ Cleanup: folder delete returned ${res.status} (${res.error ?? 'no message'}). Continuing — old items may linger; delete them manually in ClickUp UI.`, type: 'error' });
    }
  } else {
    log.push({ timestamp: ts(), message: `Cleanup: no existing folder mapping — fresh project.`, type: 'info' });
  }
  // Wipe ALL mappings for this project so the rebuild creates fresh IDs.
  await execute('DELETE FROM clickup_mappings WHERE project_id = ?', [projectId]);
}

// ─── Main sync ───────────────────────────────────────────────────────────────

export async function syncProjectToClickUp(
  project: ProjectRow,
  apiKey: string,
  spaceId: string,
): Promise<SyncResult> {
  const log: SyncLogEntry[] = [];
  let syncedCount = 0;
  let errorCount = 0;

  log.push({ timestamp: ts(), message: `Starting ClickUp sync for "${project.name}"…`, type: 'info' });

  // ─── Load epics, journeys, approved tasks ───────────────────────────────
  const epicRows = await query<EpicRow>(
    'SELECT epic_key, data FROM epics WHERE project_id = ? AND is_current = 1',
    [project.id],
  );
  const journeyRows = await query<JourneyRow>(
    'SELECT journey_key, data FROM journeys WHERE project_id = ? AND is_current = 1',
    [project.id],
  );
  const taskRows = await query<TaskRow>(
    `SELECT task_key, data FROM tasks WHERE project_id = ? AND is_current = 1
     AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.status')) = 'approved'`,
    [project.id],
  );

  if (taskRows.length === 0) {
    log.push({ timestamp: ts(), message: `No approved tasks to sync. Approve tasks before syncing.`, type: 'error' });
    return { log, syncedCount: 0, errorCount: 0 };
  }

  const epics = epicRows.map((r) => ({
    epicKey: r.epic_key,
    epic: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as EpicData,
  }));
  const journeys = journeyRows.map((r) => ({
    journeyKey: r.journey_key,
    journey: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as JourneyData,
  }));
  const tasks = taskRows.map((r) => ({
    taskKey: r.task_key,
    task: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as TaskData,
  }));

  // ─── Determine which epics + journeys to create ─────────────────────────
  // Only sync items that have downstream approved content. Skip empty epics
  // and journeys so the ClickUp folder doesn't fill up with shells.
  const taskByJourneyId = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const arr = taskByJourneyId.get(t.task.journeyId) ?? [];
    arr.push(t);
    taskByJourneyId.set(t.task.journeyId, arr);
  }
  const journeysWithApprovedTasks = journeys.filter((j) => (taskByJourneyId.get(j.journey.id)?.length ?? 0) > 0);
  const journeysByEpicId = new Map<string, typeof journeys>();
  for (const j of journeysWithApprovedTasks) {
    const arr = journeysByEpicId.get(j.journey.epicId) ?? [];
    arr.push(j);
    journeysByEpicId.set(j.journey.epicId, arr);
  }
  const epicsToCreate = epics.filter((e) => (journeysByEpicId.get(e.epic.id)?.length ?? 0) > 0);

  if (epicsToCreate.length === 0) {
    log.push({ timestamp: ts(), message: `Approved tasks exist but none have a matching epic+journey. Regenerate the pipeline and re-sync.`, type: 'error' });
    return { log, syncedCount: 0, errorCount: 1 };
  }

  // ─── Destructive cleanup (chosen path: "start over") ────────────────────
  log.push({ timestamp: ts(), message: `⚠ DESTRUCTIVE MODE: existing ClickUp folder + all nested content will be replaced. Manual ClickUp edits will be lost.`, type: 'info' });
  await destructiveCleanup(project.id, apiKey, log);

  // ─── Create fresh folder ────────────────────────────────────────────────
  const folderName = `${project.name}${project.client ? ` — ${project.client}` : ''}`;
  let folderId: string;
  {
    const res = await clickupRequest<{ id: string }>(`/space/${spaceId}/folder`, {
      method: 'POST',
      body: { name: folderName },
      projectId: project.id,
      apiKey,
    });
    if (res.ok && res.data?.id) {
      folderId = res.data.id;
      await setMapping(project.id, 'folder', project.id, folderId);
      log.push({ timestamp: ts(), message: `✓ Created folder "${folderName}" (${folderId})`, type: 'success' });
    } else if (res.error && /name taken/i.test(res.error)) {
      // Cleanup didn't delete the folder (e.g. permission issue) but its
      // name is still taken. Adopt by name so we proceed instead of erroring.
      const list = await clickupRequest<{ folders: Array<{ id: string; name: string }> }>(
        `/space/${spaceId}/folder`,
        { method: 'GET', projectId: project.id, apiKey },
      );
      const found = list.data?.folders?.find((f) => f.name === folderName);
      if (found?.id) {
        folderId = found.id;
        await setMapping(project.id, 'folder', project.id, folderId);
        log.push({ timestamp: ts(), message: `↻ Adopted existing folder "${folderName}" (${folderId}). You may want to manually delete its old contents.`, type: 'info' });
      } else {
        log.push({ timestamp: ts(), message: `✗ Failed to create folder: ${res.error}`, type: 'error' });
        return { log, syncedCount: 0, errorCount: 1 };
      }
    } else {
      log.push({ timestamp: ts(), message: `✗ Failed to create folder: ${res.error ?? 'unknown error'}`, type: 'error' });
      return { log, syncedCount: 0, errorCount: 1 };
    }
  }

  // ─── Create one default list inside the folder ──────────────────────────
  // All epics live as parent tasks inside this list. Subtasks (journeys) and
  // sub-subtasks (tasks) are nested under their epic.
  const listName = 'Pipeline';
  let listId: string;
  {
    const res = await clickupRequest<{ id: string }>(`/folder/${folderId}/list`, {
      method: 'POST',
      body: { name: listName },
      projectId: project.id,
      apiKey,
    });
    if (!res.ok || !res.data?.id) {
      log.push({ timestamp: ts(), message: `✗ Failed to create list "${listName}": ${res.error}`, type: 'error' });
      return { log, syncedCount, errorCount: errorCount + 1 };
    }
    listId = res.data.id;
    await setMapping(project.id, 'list', project.id, listId);
    log.push({ timestamp: ts(), message: `✓ Created list "${listName}" (${listId})`, type: 'success' });
  }

  // ─── Create Epic → Journey → Task hierarchy ─────────────────────────────
  for (const { epicKey, epic } of epicsToCreate) {
    // 1. Epic as a parent task in the Pipeline list
    const epicRes = await clickupRequest<{ id: string }>(`/list/${listId}/task`, {
      method: 'POST',
      body: {
        name: epic.title,
        description: epicDescription(epic),
        tags: [epic.domain, 'epic'],
      },
      projectId: project.id,
      apiKey,
    });
    if (!epicRes.ok || !epicRes.data?.id) {
      log.push({ timestamp: ts(), message: `✗ Failed to create epic "${epic.title}": ${epicRes.error}`, type: 'error' });
      errorCount++;
      continue;
    }
    const epicTaskId = epicRes.data.id;
    await setMapping(project.id, 'task', epicKey, epicTaskId);
    log.push({ timestamp: ts(), message: `✓ Epic: ${epic.title}`, type: 'success' });

    // 2. Journeys for this epic — subtasks under epicTaskId
    const epicJourneys = journeysByEpicId.get(epic.id) ?? [];
    for (const { journeyKey, journey } of epicJourneys) {
      const journeyRes = await clickupRequest<{ id: string }>(`/list/${listId}/task`, {
        method: 'POST',
        body: {
          name: journey.title,
          description: journeyDescription(journey),
          parent: epicTaskId,
          tags: [epic.domain, 'journey'],
        },
        projectId: project.id,
        apiKey,
      });
      if (!journeyRes.ok || !journeyRes.data?.id) {
        log.push({ timestamp: ts(), message: `   ✗ Journey "${journey.title}": ${journeyRes.error}`, type: 'error' });
        errorCount++;
        continue;
      }
      const journeyTaskId = journeyRes.data.id;
      await setMapping(project.id, 'task', journeyKey, journeyTaskId);
      log.push({ timestamp: ts(), message: `   ✓ Journey: ${journey.title}`, type: 'success' });

      // 3. Tasks under this journey — sub-subtasks (parent = journey task)
      const journeyTasks = taskByJourneyId.get(journey.id) ?? [];
      for (const { taskKey, task } of journeyTasks) {
        const taskRes = await clickupRequest<{ id: string }>(`/list/${listId}/task`, {
          method: 'POST',
          body: {
            name: `[${task.wbsId}] ${task.title}`,
            description: taskDescription(task),
            parent: journeyTaskId,
            time_estimate: Math.round(task.estimateHours * 60 * 60 * 1000),
            tags: [task.domain],
          },
          projectId: project.id,
          wbsId: task.wbsId,
          apiKey,
        });
        if (!taskRes.ok || !taskRes.data?.id) {
          log.push({ timestamp: ts(), message: `      ✗ Task [${task.wbsId}]: ${taskRes.error}`, type: 'error' });
          errorCount++;
          continue;
        }
        await setMapping(project.id, 'task', taskKey, taskRes.data.id);
        log.push({ timestamp: ts(), message: `      ✓ Task: [${task.wbsId}] ${task.title}`, type: 'success' });
        syncedCount++;
      }
    }
  }

  // ─── Done ───────────────────────────────────────────────────────────────
  if (errorCount === 0) {
    log.push({
      timestamp: ts(),
      message: `Sync complete. ${syncedCount} task(s) pushed under ${epicsToCreate.length} epic(s) and ${journeysWithApprovedTasks.length} journey(s).`,
      type: 'success',
    });
  } else {
    log.push({
      timestamp: ts(),
      message: `Sync finished with ${errorCount} error(s). ${syncedCount} task(s) succeeded.`,
      type: 'error',
    });
  }

  return { log, syncedCount, errorCount };
}
