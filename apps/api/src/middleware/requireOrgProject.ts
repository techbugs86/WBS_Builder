import type { Request, Response, NextFunction } from 'express';
import { queryOne } from '../db/index.js';

// The middleware loads the FULL project row — downstream handlers (and
// `GET /projects/:id` which spreads `req.project` straight into the response)
// rely on every column being present, not just the auth-relevant ones.
export interface OrgProjectRow {
  id: string;
  org_id: string;
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

declare global {
  namespace Express {
    interface Request {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      project?: Record<string, any>;
    }
  }
}

// Verifies the project exists and belongs to the caller's org, then attaches
// it to req.project. Org membership is the only authorization gate here —
// any role (owner/admin/pm) can READ + EDIT any project in their org.
//
// Destructive operations (DELETE project, DELETE All epics/journeys/tasks,
// per-item deletes, prompt edits, integrations) are guarded by per-route
// `requireRole('admin')` checks, so PMs still can't wipe data they shouldn't.
//
// Earlier this middleware had a "PMs can only see projects they created"
// rule. That broke the common agency workflow where an admin sets up a
// project and PMs run the day-to-day pipeline on it.
export async function requireOrgProject(req: Request, res: Response, next: NextFunction): Promise<void> {
  const projectId = req.params['id'];
  if (!projectId) { res.status(400).json({ error: 'Missing project id.' }); return; }

  const project = await queryOne<OrgProjectRow>('SELECT * FROM projects WHERE id = ?', [projectId as string]);
  if (!project) { res.status(404).json({ error: 'Project not found.' }); return; }

  if (project.org_id !== req.user!.orgId) {
    res.status(403).json({ error: 'Access denied — project belongs to a different organisation.' });
    return;
  }

  req.project = project;
  next();
}
