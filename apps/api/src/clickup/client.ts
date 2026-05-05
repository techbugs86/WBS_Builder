import { v4 as uuid } from 'uuid';
import { execute } from '../db/index.js';

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';
const RATE_LIMIT_PER_MIN = 100;
const MIN_INTERVAL_MS = Math.ceil(60_000 / RATE_LIMIT_PER_MIN); // ~600ms between calls

let lastCallTs = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = lastCallTs + MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCallTs = Date.now();
}

export interface ClickUpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  projectId: string;
  wbsId?: string;
  apiKey: string;
}

export interface ClickUpResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function clickupRequest<T>(path: string, opts: ClickUpRequestOptions): Promise<ClickUpResponse<T>> {
  const url = `${CLICKUP_BASE}${path.startsWith('/') ? path : '/' + path}`;
  const method = opts.method ?? 'GET';

  await throttle();

  const start = Date.now();
  let status = 0;
  let ok = false;
  let data: T | undefined;
  let error: string | undefined;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': opts.apiKey,
        'Content-Type': 'application/json',
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    status = res.status;
    ok = res.ok;

    if (res.status === 429) {
      // Rate limited — back off and retry once
      await new Promise((r) => setTimeout(r, 2000));
      return clickupRequest<T>(path, opts);
    }

    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        error = 'Invalid JSON in ClickUp response';
      }
    }

    if (!ok && data && typeof data === 'object' && 'err' in (data as Record<string, unknown>)) {
      error = String((data as { err?: string }).err ?? `HTTP ${status}`);
    } else if (!ok) {
      error = error ?? `HTTP ${status}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : 'Network error';
  } finally {
    const duration = Date.now() - start;
    // Best-effort log; never fail the request because the log failed
    try {
      await execute(
        'INSERT INTO sync_log (id, project_id, wbs_id, method, url, status_code, duration_ms, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), opts.projectId, opts.wbsId ?? '', method, url, status, duration, ok ? 1 : 0, error ?? null],
      );
    } catch (logErr) {
      console.error('[clickup] sync_log insert failed:', logErr);
    }
  }

  return { ok, status, data, error };
}
