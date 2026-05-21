import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { promptsRouter } from './routes/prompts.js';
import { settingsRouter } from './routes/settings.js';
import { projectsRouter } from './routes/projects.js';
import { usersRouter } from './routes/users.js';
import { logsRouter } from './routes/logs.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logErrorFireAndForget } from './lib/errorLog.js';

export const app = express();

app.use(cors({ origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

app.use('/auth', authRouter);
app.use('/admin/prompts', promptsRouter);
app.use('/admin/settings', settingsRouter);
app.use('/admin/users', usersRouter);
app.use('/admin/logs', logsRouter);
app.use('/projects', projectsRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// 404 for unknown routes — must come after all real routes.
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// Global error handler — MUST be last. Catches anything thrown in async
// handlers wrapped with asyncHandler, plus express.json parser errors.
app.use(errorHandler);

// Last-resort safety net: log unhandled promise rejections instead of crashing
// the process silently. (tsx watch will continue running.)
process.on('unhandledRejection', (reason) => {
  console.error('[api:unhandledRejection]', reason);
  logErrorFireAndForget({
    level: 'error',
    source: 'backend',
    module: 'process',
    message: reason instanceof Error ? reason.message : String(reason),
    context: { kind: 'unhandledRejection' },
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
process.on('uncaughtException', (err) => {
  console.error('[api:uncaughtException]', err);
  logErrorFireAndForget({
    level: 'error',
    source: 'backend',
    module: 'process',
    message: err.message,
    context: { kind: 'uncaughtException' },
    stack: err.stack,
  });
});
