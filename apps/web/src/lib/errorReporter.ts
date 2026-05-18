// NOTE: this file intentionally uses raw `fetch` instead of the `api` client.
// If api.ts auto-logs failed requests (it does), routing log POSTs through
// it would create infinite recursion when the backend is unreachable.

const BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:4000';

async function postLogEntry(payload: QueuedEntry): Promise<void> {
  const token = (() => {
    try { return localStorage.getItem('wbs_token'); } catch { return null; }
  })();
  const res = await fetch(BASE + '/admin/logs/error', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Log POST returned ${res.status}`);
  }
}

interface ReportOptions {
  /** Logical area — page name, module, store action. */
  module: string;
  /** Short, human-readable message. */
  message: string;
  /** Extra context — projectId, stage, http status, etc. */
  context?: Record<string, unknown>;
  /** Stack from a caught Error, if available. */
  stack?: string;
  level?: 'error' | 'warn' | 'info';
}

interface QueuedEntry {
  level: 'error' | 'warn' | 'info';
  module: string;
  message: string;
  context?: Record<string, unknown>;
  stack?: string;
}

const QUEUE_KEY = 'wbs_error_log_queue';
const QUEUE_MAX = 200;

function loadQueue(): QueuedEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedEntry[]) : [];
  } catch { return []; }
}

function saveQueue(q: QueuedEntry[]): void {
  try {
    // Cap the queue so a long offline session can't blow out localStorage.
    const trimmed = q.length > QUEUE_MAX ? q.slice(-QUEUE_MAX) : q;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
  } catch { /* quota / private mode — drop silently */ }
}

let isFlushing = false;

/**
 * Drain queued entries to the backend, oldest first. Stops at the first
 * failure (no point hammering an offline server) and re-saves the remainder.
 */
async function flushQueue(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    let queue = loadQueue();
    while (queue.length > 0) {
      const next = queue[0]!;
      try {
        await postLogEntry(next);
        queue = queue.slice(1);
        saveQueue(queue);
      } catch {
        // Backend still unreachable — leave the queue intact and stop.
        return;
      }
    }
  } finally {
    isFlushing = false;
  }
}

/**
 * Send a frontend failure to the backend errors.log. Fire-and-forget — never
 * throws, even if the backend is down (we don't want to mask the original
 * error with a reporter error).
 *
 * Usage:
 *   try { await api.post(...) }
 *   catch (err) {
 *     reportClientError({ module: 'EpicsPage', message: 'Regenerate failed', err });
 *     throw err;
 *   }
 */
export function reportClientError(opts: ReportOptions & { err?: unknown }): void {
  const { err, ...rest } = opts;
  const message = rest.message || (err instanceof Error ? err.message : String(err ?? 'unknown error'));
  const stack = rest.stack ?? (err instanceof Error ? err.stack : undefined);

  // Augment context with browser info to aid triage.
  const context: Record<string, unknown> = {
    ...(rest.context ?? {}),
    href: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };

  const payload: QueuedEntry = {
    level: rest.level ?? 'error',
    module: rest.module,
    message,
    context,
    ...(stack ? { stack } : {}),
  };

  postLogEntry(payload)
    .then(() => {
      // Successful POST — opportunistically drain any backlog from previous
      // offline failures so the log catches up.
      void flushQueue();
    })
    .catch(() => {
      // Backend unreachable — enqueue locally. Will retry on next successful
      // POST or on next page load via installGlobalErrorReporter.
      const queue = loadQueue();
      queue.push(payload);
      saveQueue(queue);
      // eslint-disable-next-line no-console
      console.warn('[errorReporter] backend unreachable — entry queued locally (queue size:', queue.length, ')');
    });
}

/**
 * Wire up window-level catches so any uncaught JS error or unhandled promise
 * rejection ends up in the log. Call once from main.tsx.
 */
export function installGlobalErrorReporter(): void {
  if (typeof window === 'undefined') return;
  // Try to drain any queue left by a previous offline session.
  void flushQueue();
  // Also retry when the browser comes back online.
  window.addEventListener('online', () => { void flushQueue(); });
  window.addEventListener('error', (event) => {
    reportClientError({
      module: 'window.onerror',
      message: event.message,
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportClientError({
      module: 'unhandledrejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
