import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { logError, readRecentLogs } from '../lib/errorLog.js';

export const logsRouter = Router();

/**
 * POST /admin/logs/error
 * Body: { module, message, context?, stack? }
 *
 * Records a frontend error. INTENTIONALLY unauthenticated — login-page and
 * pre-auth failures must still land in the log. The endpoint accepts an
 * optional bearer token; if present we attribute the entry to that user.
 *
 * The endpoint is rate-limited implicitly by the log writer's 5 MB rotation
 * cap, and the writer truncates strings — abuse risk is bounded.
 */
logsRouter.post('/error', async (req, res) => {
  const body = req.body as {
    level?: 'error' | 'warn' | 'info';
    module?: string;
    message?: string;
    context?: Record<string, unknown>;
    stack?: string;
  };
  if (!body.module || !body.message) {
    res.status(400).json({ error: 'module and message are required.' });
    return;
  }

  // Best-effort user attribution. We don't apply verifyJWT middleware here
  // (would block login-page errors), so parse the token manually if present.
  let userId: string | undefined;
  let userEmail: string | undefined;
  const auth = req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const { default: jwt } = await import('jsonwebtoken');
      const secret = process.env['JWT_SECRET'] ?? 'dev-secret';
      const payload = jwt.verify(auth.slice(7), secret) as { userId?: string; email?: string };
      userId = payload.userId;
      userEmail = payload.email;
    } catch {
      // Token invalid or expired — log the entry without attribution.
    }
  }

  await logError({
    level: body.level ?? 'error',
    source: 'frontend',
    module: body.module,
    message: body.message,
    context: {
      ...(body.context ?? {}),
      userId,
      userEmail,
      ip: req.ip,
    },
    stack: body.stack,
  });
  res.json({ ok: true });
});

/**
 * GET /admin/logs/errors?limit=200
 * Returns the last N entries from the log file. Admin-only.
 */
logsRouter.get('/errors', verifyJWT, requireRole('admin'), async (req, res) => {
  const limitRaw = req.query['limit'];
  const limit = typeof limitRaw === 'string' ? Math.min(1000, Math.max(1, parseInt(limitRaw, 10) || 200)) : 200;
  const entries = await readRecentLogs(limit);
  res.json({ entries });
});
