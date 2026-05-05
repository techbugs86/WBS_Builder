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

// Verifies the project exists, belongs to the caller's org, and attaches it to req.project.
// Owners and admins can access any project in their org; PMs only see their own.
export async function requireOrgProject(req: Request, res: Response, next: NextFunction): Promise<void> {
  const projectId = req.params['id'];
  if (!projectId) { res.status(400).json({ error: 'Missing project id.' }); return; }

  const project = await queryOne<OrgProjectRow>('SELECT * FROM projects WHERE id = ?', [projectId as string]);
  if (!project) { res.status(404).json({ error: 'Project not found.' }); return; }

  if (project.org_id !== req.user!.orgId) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  // PMs can only access projects they created; admins/owners see all in the org
  const role = req.user!.role;
  if (role === 'pm' && project.created_by !== req.user!.userId) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  req.project = project;
  next();
}
