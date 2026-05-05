# ClickUp Mapping

How the WBS Builder pipeline maps onto a ClickUp workspace, and how the sync stays idempotent.

---

## Hierarchy mapping

| WBS entity | ClickUp entity | Identifier source |
|---|---|---|
| Project | Folder (inside the configured Space) | `projects.id` → `clickup_mappings.entity_key` (type=`folder`) |
| Epic | List (inside the project's Folder) | `epics.epic_key` → `clickup_mappings.entity_key` (type=`list`) |
| Task (atomic, approved) | Task (inside the epic's List) | `tasks.task_key` → `clickup_mappings.entity_key` (type=`task`) |

Journeys are **not** synced as a separate ClickUp entity in MVP. Their content is implicit in the tasks they spawned. (Future work: emit them as nested checklists or grouping tags.)

Only tasks with `data.status = 'approved'` are pushed. Pending and flagged tasks are skipped.

---

## What gets written into a ClickUp Task

| ClickUp field | Source |
|---|---|
| `name` | `[wbsId] title` (e.g. `[WBS-007] Implement Stripe Checkout endpoint`) |
| `description` | Markdown body containing WBS ID, domain, estimate, and the full Given/When/Then acceptance criteria list |
| `time_estimate` | `estimateHours * 3600 * 1000` (ClickUp expects milliseconds) |
| `tags` | `[domain]` (e.g. `billing`, `auth`) |

Status, assignee, and time tracking are **not** written from WBS. ClickUp owns those.

---

## Idempotency

Every entity is keyed by a stable WBS-side identifier and stored in `clickup_mappings`:

```
project_id | entity_type | entity_key      | clickup_id
─────────────────────────────────────────────────────────
proj-123   | folder      | proj-123        | 901234560000
proj-123   | list        | <epic_key>      | 901234560001
proj-123   | task        | <task_key>      | 86abc1d2e
```

**Every sync first checks `clickup_mappings`.** If a row exists, the existing ClickUp ID is reused and the entity is updated in place (PUT). If not, a new entity is created (POST) and the returned ID is saved.

This means:
- Re-running sync is safe — no duplicate folders/lists/tasks are created.
- Editing a WBS task after it was synced and re-syncing updates the existing ClickUp task.
- Deleting a task in ClickUp manually does not delete it from WBS, and a future sync would NOT auto-recreate it (the mapping still points at the deleted ID, so the PUT will 4xx — flagged in `sync_log` for the operator).

---

## Source-of-truth split

| Concern | Owner |
|---|---|
| Task structure (title, AC, estimate, dependencies) | **WBS Builder** |
| Hierarchy (folder/list assignment) | **WBS Builder** |
| Execution status (in progress, blocked, done) | **ClickUp** |
| Assignee | **ClickUp** |
| Time tracked | **ClickUp** |
| Comments | **ClickUp** |

The sync writes WBS-owned fields and never overwrites ClickUp-owned fields.

---

## Rate limiting and logging

ClickUp's published rate limit is 100 requests/min/token. The client at [apps/api/src/clickup/client.ts](../apps/api/src/clickup/client.ts) enforces a minimum interval between calls (~600ms) to stay under that ceiling, with a single automatic retry on `429` after a 2-second backoff.

Every API call is logged to the `sync_log` table with: project_id, wbs_id, method, URL, status code, duration, and error (if any). To debug a failed sync, query:

```sql
SELECT * FROM sync_log
WHERE project_id = '<id>'
ORDER BY created_at DESC
LIMIT 50;
```

---

## Configuration

The sync needs two values per organisation:

| Setting key | What it is | Where to find it |
|---|---|---|
| `clickup_api_key` | Personal API token. Auth header value (NOT a Bearer token — pass as-is) | ClickUp → Settings → Apps → Generate |
| `clickup_space_id` | Numeric ID of the Space new project Folders should be created inside | URL when viewing a Space: `https://app.clickup.com/<team_id>/v/li/<space_id>` |

Both are managed via **Admin → Integrations** in the WBS UI. They are persisted in the per-org `settings` table and mirrored into `process.env` at write time so the running API picks them up without restart.

---

## What is NOT yet implemented

- AC and DoD as native ClickUp **checklists** (currently inlined into the task description as Markdown). ClickUp's checklist API would let developers tick AC off; this is a planned upgrade.
- **Custom fields** — `wbs_id` should ideally be a custom field on each task rather than embedded in the description. Requires creating the field once per Space.
- **Dependency edges** — `tasks.dependencies[]` is not yet pushed. Two-pass creation (create all tasks, then link) is the planned approach.
- **Subtasks** — every task currently lands as a top-level task in its epic List. Mapping journeys to parent ClickUp tasks with atomic tasks as subtasks is a future option.
- **Webhook → WBS sync-back** — execution-state changes in ClickUp do not flow back to WBS. The current sync is one-way.
