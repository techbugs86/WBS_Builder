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
  acceptanceCriteria: Array<{ type: string; given: string; when: string; then: string }>;
  status: string;
}

interface EpicData {
  id: string;
  title: string;
  description: string;
  domain: string;
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

function taskDescription(task: TaskData): string {
  const acLines = task.acceptanceCriteria
    .map((ac, i) => `${i + 1}. **[${ac.type}]** Given ${ac.given}\n   When ${ac.when}\n   Then ${ac.then}`)
    .join('\n\n');
  return [
    `**WBS ID:** \`${task.wbsId}\``,
    `**Domain:** ${task.domain}`,
    `**Estimate:** ${task.estimateHours}h`,
    '',
    '## Acceptance Criteria',
    acLines || '_None defined._',
  ].join('\n');
}

export async function syncProjectToClickUp(
  project: ProjectRow,
  apiKey: string,
  spaceId: string,
): Promise<SyncResult> {
  const log: SyncLogEntry[] = [];
  let syncedCount = 0;
  let errorCount = 0;

  log.push({ timestamp: ts(), message: `Starting ClickUp sync for "${project.name}"…`, type: 'info' });

  // ─── Load epics + approved tasks ────────────────────────────────────────
  const epicRows = await query<EpicRow>(
    'SELECT epic_key, data FROM epics WHERE project_id = ? AND is_current = 1',
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

  const tasks: Array<{ taskKey: string; task: TaskData }> = taskRows.map((r) => ({
    taskKey: r.task_key,
    task: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as TaskData,
  }));

  // ─── Pre-check: which approved tasks are NOT yet synced? ────────────────
  // Skip already-synced tasks unless the user explicitly wants to re-update.
  const unsynced: Array<{ taskKey: string; task: TaskData }> = [];
  let alreadySyncedCount = 0;
  for (const item of tasks) {
    const existing = await getMapping(project.id, 'task', item.taskKey);
    if (existing) {
      alreadySyncedCount++;
    } else {
      unsynced.push(item);
    }
  }

  // Early exit: everything already synced → no API calls needed.
  if (unsynced.length === 0) {
    log.push({
      timestamp: ts(),
      message: `✓ All ${tasks.length} approved task(s) are already synced. Nothing to do.`,
      type: 'success',
    });
    return { log, syncedCount: 0, errorCount: 0 };
  }

  if (alreadySyncedCount > 0) {
    log.push({
      timestamp: ts(),
      message: `${alreadySyncedCount} task(s) already synced — skipping. Syncing ${unsynced.length} new task(s).`,
      type: 'info',
    });
  }

  // ─── 1. Folder (project) ────────────────────────────────────────────────
  const folderName = `${project.name}${project.client ? ` — ${project.client}` : ''}`;
  let folderId = await getMapping(project.id, 'folder', project.id);

  // Validate the cached folder mapping is still alive in ClickUp. If the user
  // archived/trashed the folder in the ClickUp UI, our cached ID points to a
  // ghost — list-creates inside it appear to succeed (ClickUp doesn't validate)
  // but task-creates fail with "List deleted." Catch this up front and fall
  // through to adopt-by-name / fresh-create instead of marching into the wall.
  if (folderId) {
    const check = await clickupRequest<{ id: string; archived?: boolean }>(
      `/folder/${folderId}`,
      { method: 'GET', projectId: project.id, apiKey },
    );
    const isMissing = !check.ok || check.status === 404;
    const isArchived = check.ok && check.data?.archived === true;
    if (isMissing || isArchived) {
      log.push({
        timestamp: ts(),
        message: `↻ Cached folder ${folderId} is ${isArchived ? 'archived' : 'missing'} in ClickUp — clearing stale mappings and re-creating.`,
        type: 'info',
      });
      // Wipe our stale folder + list mappings for this project so the next
      // steps create fresh ones. Task mappings remain so we don't re-push
      // tasks that were already created in OTHER folders (unlikely but safe).
      await execute('DELETE FROM clickup_mappings WHERE project_id = ? AND entity_type IN (\'folder\', \'list\')', [project.id]);
      folderId = null;
    }
  }

  // Adopt-by-name: if our mapping is missing (e.g. project deleted+recreated, or
  // first sync after tests cleared the DB) but ClickUp still has a folder with
  // this exact name, reuse it. Avoids the "Folder name taken" 400 from POST.
  if (!folderId) {
    const foldersRes = await clickupRequest<{ folders: Array<{ id: string; name: string }> }>(
      `/space/${spaceId}/folder`,
      { method: 'GET', projectId: project.id, apiKey },
    );
    if (foldersRes.ok && Array.isArray(foldersRes.data?.folders)) {
      const existing = foldersRes.data!.folders.find((f) => f.name === folderName);
      if (existing) {
        folderId = existing.id;
        await setMapping(project.id, 'folder', project.id, folderId);
        log.push({ timestamp: ts(), message: `↻ Adopted existing folder "${folderName}" (${folderId})`, type: 'info' });
      }
    }
  }

  if (!folderId) {
    log.push({ timestamp: ts(), message: `Creating folder for project…`, type: 'info' });
    const res = await clickupRequest<{ id: string }>(`/space/${spaceId}/folder`, {
      method: 'POST',
      body: { name: folderName },
      projectId: project.id,
      apiKey,
    });

    // Race-condition fallback: another sync (or our own pre-fetch missing it
    // due to eventual consistency) created the folder between the GET and POST.
    if ((!res.ok || !res.data?.id) && res.error && /name taken/i.test(res.error)) {
      const retry = await clickupRequest<{ folders: Array<{ id: string; name: string }> }>(
        `/space/${spaceId}/folder`,
        { method: 'GET', projectId: project.id, apiKey },
      );
      const found = retry.data?.folders?.find((f) => f.name === folderName);
      if (found?.id) {
        folderId = found.id;
        await setMapping(project.id, 'folder', project.id, folderId);
        log.push({ timestamp: ts(), message: `↻ Adopted existing folder "${folderName}" after name conflict (${folderId})`, type: 'info' });
      }
    }

    if (!folderId) {
      if (res.ok && res.data?.id) {
        folderId = res.data.id;
        await setMapping(project.id, 'folder', project.id, folderId);
        log.push({ timestamp: ts(), message: `✓ Created folder (${folderId})`, type: 'success' });
      } else {
        log.push({ timestamp: ts(), message: `✗ Failed to create folder: ${res.error}`, type: 'error' });
        return { log, syncedCount: 0, errorCount: 1 };
      }
    }
  } else {
    log.push({ timestamp: ts(), message: `Reusing existing folder (${folderId})`, type: 'info' });
  }

  // ─── 2. Build epic lookup ───────────────────────────────────────────────
  const epicByEpicId = new Map<string, EpicData & { epicKey: string }>();
  for (const row of epicRows) {
    const epic = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as EpicData;
    epicByEpicId.set(epic.id, { ...epic, epicKey: row.epic_key });
  }

  // Only consider epics that have at least one *unsynced* task — no need to
  // create a list for an epic whose tasks are all already in ClickUp.
  const usedEpicIds = new Set(unsynced.map((t) => t.task.epicId));
  const listIdByEpicId = new Map<string, string>();

  const orphanEpicIds = [...usedEpicIds].filter((id) => !epicByEpicId.has(id));
  if (orphanEpicIds.length > 0) {
    log.push({
      timestamp: ts(),
      message: `⚠ ${orphanEpicIds.length} unsynced task(s) reference epic IDs that no longer exist. This usually happens when epics or journeys were regenerated AFTER tasks were created. Fix: regenerate Journeys → regenerate Tasks → approve them again → re-sync.`,
      type: 'error',
    });
  }

  // Fetch all existing lists in this folder — both live and archived — so we
  // can:
  //   1. Validate cached list mappings against what's actually live.
  //   2. Adopt-by-name when the title matches an existing live list.
  //   3. UNARCHIVE a trashed list when the user wants to re-sync — ClickUp's
  //      "name taken" check spans live + archived, so we MUST recover archived
  //      lists rather than try to create new ones with the same title.
  const existingListsByName = new Map<string, string>();
  const archivedListsByName = new Map<string, string>();
  const liveListIds = new Set<string>();
  {
    const listsRes = await clickupRequest<{ lists: Array<{ id: string; name: string; archived?: boolean }> }>(
      `/folder/${folderId}/list`,
      { method: 'GET', projectId: project.id, apiKey },
    );
    if (listsRes.ok && Array.isArray(listsRes.data?.lists)) {
      for (const l of listsRes.data!.lists) {
        if (l.archived) continue;
        existingListsByName.set(l.name, l.id);
        liveListIds.add(l.id);
      }
    }
    // Separate fetch for archived lists. ClickUp's default GET excludes them.
    const archivedRes = await clickupRequest<{ lists: Array<{ id: string; name: string }> }>(
      `/folder/${folderId}/list?archived=true`,
      { method: 'GET', projectId: project.id, apiKey },
    );
    if (archivedRes.ok && Array.isArray(archivedRes.data?.lists)) {
      for (const l of archivedRes.data!.lists) {
        archivedListsByName.set(l.name, l.id);
      }
    }
  }

  async function unarchiveList(listId: string): Promise<boolean> {
    const res = await clickupRequest<{ id: string }>(`/list/${listId}`, {
      method: 'PUT',
      body: { archived: false },
      projectId: project.id,
      apiKey,
    });
    return res.ok;
  }

  // Pre-flight: prune any cached list mappings that point to dead lists.
  // Without this, the sync trusts the stale ID, "Reuses" the list, and every
  // task-create then 400s with "List deleted." Wipe the bad rows so the
  // adopt-by-name / fresh-create path below can recover automatically.
  const cachedListRows = await query<{ entity_key: string; clickup_id: string }>(
    'SELECT entity_key, clickup_id FROM clickup_mappings WHERE project_id = ? AND entity_type = \'list\'',
    [project.id],
  );
  let prunedCount = 0;
  for (const row of cachedListRows) {
    if (!liveListIds.has(row.clickup_id)) {
      await execute(
        'DELETE FROM clickup_mappings WHERE project_id = ? AND entity_type = \'list\' AND entity_key = ?',
        [project.id, row.entity_key],
      );
      prunedCount++;
    }
  }
  if (prunedCount > 0) {
    log.push({
      timestamp: ts(),
      message: `↻ Pruned ${prunedCount} stale list mapping(s) — their ClickUp lists were deleted/archived. Will recreate.`,
      type: 'info',
    });
  }

  for (const epicId of usedEpicIds) {
    const epic = epicByEpicId.get(epicId);
    if (!epic) {
      log.push({ timestamp: ts(), message: `⚠ Skipping orphan tasks for missing epic ${epicId}`, type: 'error' });
      continue;
    }
    let listId = await getMapping(project.id, 'list', epic.epicKey);

    // Adopt-by-name: if our mapping is gone but ClickUp still has a list with
    // this exact title, reuse its ID and save a fresh mapping. This is what
    // the user expects after a bulk-delete + regenerate cycle.
    if (!listId && existingListsByName.has(epic.title)) {
      listId = existingListsByName.get(epic.title)!;
      await setMapping(project.id, 'list', epic.epicKey, listId);
      log.push({ timestamp: ts(), message: `↻ Adopted existing list "${epic.title}" (${listId})`, type: 'info' });
    }

    // Restore-from-archive: ClickUp's "name taken" check spans archived lists,
    // so trying to POST a new list with the same name will fail. Instead, find
    // the archived list by name and unarchive it. Mirrors how a user would
    // restore from the ClickUp trash UI.
    if (!listId && archivedListsByName.has(epic.title)) {
      const archivedId = archivedListsByName.get(epic.title)!;
      const restored = await unarchiveList(archivedId);
      if (restored) {
        listId = archivedId;
        await setMapping(project.id, 'list', epic.epicKey, listId);
        log.push({ timestamp: ts(), message: `↻ Restored archived list "${epic.title}" (${listId})`, type: 'info' });
      }
    }

    if (!listId) {
      const res = await clickupRequest<{ id: string }>(`/folder/${folderId}/list`, {
        method: 'POST',
        body: { name: epic.title, content: epic.description ?? '' },
        projectId: project.id,
        apiKey,
      });
      if (!res.ok || !res.data?.id) {
        // Fallback: ClickUp says "name taken" but our pre-fetch missed it
        // (race condition or eventual consistency). Re-fetch the folder's
        // lists — both live and archived — find ours by name, adopt or
        // unarchive as needed.
        if (res.error && /name taken/i.test(res.error)) {
          const refresh = await clickupRequest<{ lists: Array<{ id: string; name: string }> }>(
            `/folder/${folderId}/list`,
            { method: 'GET', projectId: project.id, apiKey },
          );
          const found = refresh.data?.lists?.find((l) => l.name === epic.title);
          if (found?.id) {
            listId = found.id;
            await setMapping(project.id, 'list', epic.epicKey, listId);
            log.push({ timestamp: ts(), message: `↻ Adopted existing list "${epic.title}" (${listId}) after name conflict`, type: 'info' });
          } else {
            // Look in archived too — name conflict could be from a trashed list.
            const archRefresh = await clickupRequest<{ lists: Array<{ id: string; name: string }> }>(
              `/folder/${folderId}/list?archived=true`,
              { method: 'GET', projectId: project.id, apiKey },
            );
            const archFound = archRefresh.data?.lists?.find((l) => l.name === epic.title);
            if (archFound?.id && (await unarchiveList(archFound.id))) {
              listId = archFound.id;
              await setMapping(project.id, 'list', epic.epicKey, listId);
              log.push({ timestamp: ts(), message: `↻ Restored archived list "${epic.title}" (${listId}) after name conflict`, type: 'info' });
            }
          }
        }
        if (!listId) {
          log.push({ timestamp: ts(), message: `✗ Failed to create list for epic "${epic.title}": ${res.error}`, type: 'error' });
          errorCount++;
          continue;
        }
      } else {
        listId = res.data.id;
        await setMapping(project.id, 'list', epic.epicKey, listId);
        log.push({ timestamp: ts(), message: `✓ Created list "${epic.title}" (${listId})`, type: 'success' });
      }
    } else {
      log.push({ timestamp: ts(), message: `Reusing list for "${epic.title}" (${listId})`, type: 'info' });
    }
    listIdByEpicId.set(epicId, listId);
  }

  // ─── 3. Create only the unsynced tasks ──────────────────────────────────
  for (const { taskKey, task } of unsynced) {
    const listId = listIdByEpicId.get(task.epicId);
    if (!listId) {
      log.push({ timestamp: ts(), message: `✗ Skipping task ${task.wbsId}: no list for epic`, type: 'error' });
      errorCount++;
      continue;
    }

    const body = {
      name: `[${task.wbsId}] ${task.title}`,
      description: taskDescription(task),
      time_estimate: Math.round(task.estimateHours * 60 * 60 * 1000),
      tags: [task.domain],
    };

    const res = await clickupRequest<{ id: string }>(`/list/${listId}/task`, {
      method: 'POST',
      body,
      projectId: project.id,
      wbsId: task.wbsId,
      apiKey,
    });
    if (res.ok && res.data?.id) {
      await setMapping(project.id, 'task', taskKey, res.data.id);
      log.push({ timestamp: ts(), message: `✓ Created [${task.wbsId}] ${task.title}`, type: 'success' });
      syncedCount++;
    } else {
      log.push({ timestamp: ts(), message: `✗ Failed to create [${task.wbsId}]: ${res.error}`, type: 'error' });
      errorCount++;
    }
  }

  // ─── 5. Done ────────────────────────────────────────────────────────────
  if (errorCount === 0) {
    log.push({ timestamp: ts(), message: `Sync complete. ${syncedCount} task(s) pushed to ClickUp.`, type: 'success' });
  } else {
    log.push({ timestamp: ts(), message: `Sync finished with ${errorCount} error(s). ${syncedCount} task(s) succeeded.`, type: 'error' });
  }

  return { log, syncedCount, errorCount };
}
