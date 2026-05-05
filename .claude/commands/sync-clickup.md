---
description: Walk through the ClickUp sync flow for a given project, dry-run first
argument-hint: <project-id>
---

Prepare the ClickUp sync for project $1.

Execute as a dry run first. Never actually call the ClickUp API until I confirm.

Steps:

1. Load all tasks for project $1 from the database. Report the count.
2. Run the AC linter against every task. Report the count of PASS and FAIL.
3. Block the sync if any task is FAIL. Show me which ones and why.
4. Load the ClickUpMapping table. Report which tasks are new vs. updates.
5. Build the planned API call sequence:
   - Folder creation or lookup
   - List creation or lookup per Epic
   - Custom field creation or verification
   - Task creation (new) or update (existing)
   - Subtask creation
   - Checklist creation for AC and DoD
   - Dependency linking (second pass)
6. Print the plan as a numbered list. Include estimated API call count and rate limit impact (100 req/min ceiling).
7. Wait for my explicit "go" before executing.
8. On execution: respect rate limits, log every call to the sync_log table, update ClickUpMapping with returned IDs.
9. On any failure: stop, do not roll back automatically, report what succeeded and what failed.

Report source-of-truth rules: WBS owns structure and AC; ClickUp owns status and assignee. Never overwrite ClickUp status from the WBS side.
