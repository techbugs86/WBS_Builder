import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { verifyJWT } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { query, queryOne, execute } from '../db/index.js';

export const usersRouter = Router();

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'pm';
  created_at: string;
}

function toResponse(row: UserRow) {
  return { id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at };
}

// GET /admin/users — list all users in the caller's org
usersRouter.get('/', verifyJWT, requireRole('admin'), async (req, res) => {
  const rows = await query<UserRow>(
    `SELECT u.id, u.email, u.name, om.role, u.created_at
     FROM users u
     JOIN org_members om ON om.user_id = u.id
     WHERE om.org_id = ?
     ORDER BY u.created_at ASC`,
    [req.user!.orgId],
  );
  res.json(rows.map(toResponse));
});

// POST /admin/users — create user and add to caller's org
usersRouter.post('/', verifyJWT, requireRole('admin'), async (req, res) => {
  const { email, name, role, password } = req.body as { email?: string; name?: string; role?: string; password?: string };

  if (!email || !name || !role || !password) {
    res.status(400).json({ error: 'email, name, role, and password are required.' });
    return;
  }
  if (!['owner', 'admin', 'pm'].includes(role)) {
    res.status(400).json({ error: 'role must be owner, admin, or pm.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters.' });
    return;
  }

  // Check if email already exists globally
  const existingUser = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);

  let userId: string;
  if (existingUser) {
    // User exists globally — check if already in this org
    const existingMembership = await queryOne<{ org_id: string }>(
      'SELECT org_id FROM org_members WHERE org_id = ? AND user_id = ?',
      [req.user!.orgId, existingUser.id],
    );
    if (existingMembership) {
      res.status(409).json({ error: 'That user is already a member of this organisation.' });
      return;
    }
    userId = existingUser.id;
  } else {
    // New user — create globally
    userId = uuid();
    const hash = await bcrypt.hash(password, 10);
    await execute(
      'INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)',
      [userId, email.toLowerCase().trim(), name.trim(), role === 'owner' ? 'admin' : role, hash],
    );
  }

  // Add to org
  await execute(
    'INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)',
    [req.user!.orgId, userId, role],
  );

  const row = await queryOne<UserRow>(
    `SELECT u.id, u.email, u.name, om.role, u.created_at
     FROM users u
     JOIN org_members om ON om.user_id = u.id
     WHERE u.id = ? AND om.org_id = ?`,
    [userId, req.user!.orgId],
  );
  res.status(201).json(toResponse(row!));
});

// PATCH /admin/users/:id — update name and/or org role
usersRouter.patch('/:id', verifyJWT, requireRole('admin'), async (req, res) => {
  const { id } = req.params as { id: string };
  const { name, role } = req.body as { name?: string; role?: string };

  if (role !== undefined && !['owner', 'admin', 'pm'].includes(role)) {
    res.status(400).json({ error: 'role must be owner, admin, or pm.' });
    return;
  }

  // Verify membership in this org
  const membership = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM org_members WHERE org_id = ? AND user_id = ?',
    [req.user!.orgId, id],
  );
  if (!membership) {
    res.status(404).json({ error: 'User not found in this organisation.' });
    return;
  }

  if (name !== undefined) {
    await execute('UPDATE users SET name = ? WHERE id = ?', [name.trim(), id]);
  }
  if (role !== undefined) {
    await execute('UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?', [role, req.user!.orgId, id]);
  }

  const row = await queryOne<UserRow>(
    `SELECT u.id, u.email, u.name, om.role, u.created_at
     FROM users u
     JOIN org_members om ON om.user_id = u.id
     WHERE u.id = ? AND om.org_id = ?`,
    [id, req.user!.orgId],
  );
  res.json(toResponse(row!));
});

// DELETE /admin/users/:id — remove from org (or hard-delete if only org)
usersRouter.delete('/:id', verifyJWT, requireRole('admin'), async (req, res) => {
  const { id } = req.params as { id: string };

  if (req.user?.userId === id) {
    res.status(400).json({ error: 'You cannot remove your own account.' });
    return;
  }

  const result = await execute(
    'DELETE FROM org_members WHERE org_id = ? AND user_id = ?',
    [req.user!.orgId, id],
  );
  if (result.affectedRows === 0) {
    res.status(404).json({ error: 'User not found in this organisation.' });
    return;
  }

  res.json({ deleted: true, id });
});

// POST /admin/users/:id/reset-password
usersRouter.post('/:id/reset-password', verifyJWT, requireRole('admin'), async (req, res) => {
  const { id } = req.params as { id: string };
  const { password } = req.body as { password?: string };

  if (!password || password.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters.' });
    return;
  }

  // Verify user belongs to this org
  const membership = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM org_members WHERE org_id = ? AND user_id = ?',
    [req.user!.orgId, id],
  );
  if (!membership) {
    res.status(404).json({ error: 'User not found in this organisation.' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);

  res.json({ reset: true, id });
});
