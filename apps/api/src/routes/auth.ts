import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryOne, query, execute } from '../db/index.js';
import { verifyJWT } from '../middleware/auth.js';

export const authRouter = Router();

interface UserRow {
  id: string;
  last_org_id: string | null;
  email: string;
  name: string;
  role: 'admin' | 'pm';
  password_hash: string;
}

interface OrgMemberRow {
  org_id: string;
  role: 'owner' | 'admin' | 'pm';
  org_name: string;
  org_slug: string;
  org_plan: string;
}

// POST /auth/login
authRouter.post('/login', async (req, res) => {
  const { email, password, orgId: requestedOrgId } = req.body as {
    email?: string;
    password?: string;
    orgId?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required.' });
    return;
  }

  const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (!user) { res.status(401).json({ error: 'Invalid credentials.' }); return; }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) { res.status(401).json({ error: 'Invalid credentials.' }); return; }

  // Load all orgs the user belongs to
  const memberships = await query<OrgMemberRow>(
    `SELECT om.org_id, om.role, o.name as org_name, o.slug as org_slug, o.plan as org_plan
     FROM org_members om
     JOIN organisations o ON o.id = om.org_id
     WHERE om.user_id = ?
     ORDER BY o.name ASC`,
    [user.id],
  );

  if (memberships.length === 0) {
    res.status(403).json({ error: 'User has no organisation membership. Contact an admin.' });
    return;
  }

  // Pick active org: requested → last used → first alphabetically
  const activeOrg =
    memberships.find((m) => m.org_id === requestedOrgId) ??
    memberships.find((m) => m.org_id === user.last_org_id) ??
    memberships[0]!;

  // Persist the last-used org
  await execute('UPDATE users SET last_org_id = ? WHERE id = ?', [activeOrg.org_id, user.id]);

  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET env var is not set.');

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: activeOrg.role, orgId: activeOrg.org_id },
    secret,
    { expiresIn: '8h' },
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: activeOrg.role,
      orgId: activeOrg.org_id,
    },
    orgs: memberships.map((m) => ({
      id: m.org_id,
      name: m.org_name,
      slug: m.org_slug,
      plan: m.org_plan,
      role: m.role,
      active: m.org_id === activeOrg.org_id,
    })),
  });
});

// POST /auth/switch-org — switch active org (re-issues JWT for new org)
authRouter.post('/switch-org', verifyJWT, async (req, res) => {
  const { orgId } = req.body as { orgId?: string };
  if (!orgId) { res.status(400).json({ error: 'orgId is required.' }); return; }

  const membership = await queryOne<OrgMemberRow>(
    `SELECT om.org_id, om.role, o.name as org_name, o.slug as org_slug, o.plan as org_plan
     FROM org_members om
     JOIN organisations o ON o.id = om.org_id
     WHERE om.user_id = ? AND om.org_id = ?`,
    [req.user!.userId, orgId],
  );

  if (!membership) {
    res.status(403).json({ error: 'You are not a member of that organisation.' });
    return;
  }

  await execute('UPDATE users SET last_org_id = ? WHERE id = ?', [orgId, req.user!.userId]);

  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET env var is not set.');

  const token = jwt.sign(
    { userId: req.user!.userId, email: req.user!.email, role: membership.role, orgId },
    secret,
    { expiresIn: '8h' },
  );

  res.json({
    token,
    user: {
      id: req.user!.userId,
      email: req.user!.email,
      name: '',   // client should already have name; re-use cached value
      role: membership.role,
      orgId,
    },
  });
});

// GET /auth/orgs — list all orgs the current user belongs to
authRouter.get('/orgs', verifyJWT, async (req, res) => {
  const memberships = await query<OrgMemberRow>(
    `SELECT om.org_id, om.role, o.name as org_name, o.slug as org_slug, o.plan as org_plan
     FROM org_members om
     JOIN organisations o ON o.id = om.org_id
     WHERE om.user_id = ?
     ORDER BY o.name ASC`,
    [req.user!.userId],
  );

  res.json(memberships.map((m) => ({
    id: m.org_id,
    name: m.org_name,
    slug: m.org_slug,
    plan: m.org_plan,
    role: m.role,
    active: m.org_id === req.user!.orgId,
  })));
});
