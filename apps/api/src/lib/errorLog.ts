import { appendFile, mkdir, readFile, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve to apps/api/logs/errors.log regardless of cwd.
const LOG_DIR = join(__dirname, '..', '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'errors.log');
const ROTATE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROTATIONS = 5;              // keep errors.log.1 … errors.log.5

export type LogLevel = 'error' | 'warn' | 'info';
export type LogSource = 'backend' | 'frontend';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: LogSource;
  /** Logical area (route, module, page). */
  module: string;
  message: string;
  /** Anything additional — request path, project id, user, etc. */
  context?: Record<string, unknown>;
  stack?: string;
}

async function ensureLogDir(): Promise<void> {
  if (!existsSync(LOG_DIR)) {
    await mkdir(LOG_DIR, { recursive: true });
  }
}

/**
 * Rotate errors.log → errors.log.1 → errors.log.2 … capping at MAX_ROTATIONS.
 * Called lazily before each append when the file grows past ROTATE_BYTES.
 */
async function rotateIfNeeded(): Promise<void> {
  try {
    const s = await stat(LOG_FILE);
    if (s.size < ROTATE_BYTES) return;
    for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`;
      const dst = `${LOG_FILE}.${i + 1}`;
      if (existsSync(src)) await rename(src, dst);
    }
    await rename(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // File doesn't exist yet, or rotate failed — append will create a fresh file.
  }
}

/**
 * Append a single error event to the log. JSON Lines format — one JSON object
 * per line, easy to grep/tail/parse.
 *
 * Never throws; logging failures are swallowed because re-throwing inside an
 * error path would mask the original problem.
 */
export async function logError(entry: Omit<LogEntry, 'ts'>): Promise<void> {
  try {
    await ensureLogDir();
    await rotateIfNeeded();
    const full: LogEntry = { ts: new Date().toISOString(), ...entry };
    await appendFile(LOG_FILE, JSON.stringify(full) + '\n', 'utf8');
  } catch (err) {
    // Last-resort: print to stderr so the error isn't completely lost.
    // eslint-disable-next-line no-console
    console.error('[errorLog] failed to write:', err, 'original entry:', entry);
  }
}

/** Sync convenience for code paths that can't await (last-resort). */
export function logErrorFireAndForget(entry: Omit<LogEntry, 'ts'>): void {
  void logError(entry);
}

/**
 * Return the last N lines from the log (most recent last). Used by the admin
 * viewer to display recent errors without loading the whole file.
 */
export async function readRecentLogs(limit = 200): Promise<LogEntry[]> {
  try {
    if (!existsSync(LOG_FILE)) return [];
    const raw = await readFile(LOG_FILE, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const tail = lines.slice(-limit);
    return tail
      .map((line) => {
        try { return JSON.parse(line) as LogEntry; } catch { return null; }
      })
      .filter((e): e is LogEntry => e !== null);
  } catch {
    return [];
  }
}
