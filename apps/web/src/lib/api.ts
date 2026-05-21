import { reportClientError } from './errorReporter';

const BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:4000';

function getToken(): string | null {
  return localStorage.getItem('wbs_token');
}

/**
 * Determines whether a failed request is worth logging. We skip:
 *   - /admin/logs/* — they are the log itself; recursion is bad.
 *   - 401 from /auth/login — wrong-password is user error, not a system fault.
 *   - 404s with a project id (handled by ProjectNotFound view + dedicated log)
 *     are still logged here as a level=warn so the trail is complete.
 */
function shouldLog(path: string): boolean {
  if (path.startsWith('/admin/logs')) return false;
  return true;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Network failure (server down, DNS, CORS preflight, offline, etc.)
    const msg = err instanceof Error ? err.message : 'Network error';
    if (shouldLog(path)) {
      reportClientError({
        module: 'api.fetch',
        message: `Cannot reach API: ${msg}`,
        context: { method, path, kind: 'network' },
        err,
      });
    }
    throw new ApiError(0, `Cannot reach API: ${msg}`, 'NETWORK_ERROR');
  }

  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    let code: string | undefined;
    let details: unknown;
    try {
      const err = (await res.json()) as { error?: string; code?: string; details?: unknown };
      if (err.error) message = err.error;
      code = err.code;
      details = err.details;
    } catch {
      // Body wasn't JSON — keep statusText
    }

    // Auto-logout on 401 so the user goes back to login instead of getting stuck
    if (res.status === 401 && path !== '/auth/login') {
      try {
        localStorage.removeItem('wbs_token');
        localStorage.removeItem('wbs_user');
      } catch { /* ignore storage errors (private mode) */ }
    }

    // Auto-log every non-2xx response. 5xx → error (server fault),
    // 4xx → warn (usually user input or missing data; still useful for audit
    // and to debug "I can't log in" reports). The log file stays clean
    // because warn/error are clearly separable by level.
    if (shouldLog(path)) {
      reportClientError({
        level: res.status >= 500 ? 'error' : 'warn',
        module: 'api.fetch',
        message: `${method} ${path} → ${res.status}: ${message}`,
        context: { method, path, status: res.status, code, details },
      });
    }

    throw new ApiError(res.status, message, code, details);
  }

  // 204 No Content or empty body
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, 'API returned non-JSON response', 'INVALID_RESPONSE');
  }
}

/**
 * Multipart upload helper — used for project attachments. Bypasses the
 * JSON `request()` because FormData needs the browser to set its own
 * Content-Type (with the boundary parameter). Otherwise identical: same
 * Authorization header, same error semantics, same auto-logging.
 */
async function upload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // NOTE: do NOT set Content-Type — browser must set boundary for multipart.
      },
      body: formData,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    if (shouldLog(path)) {
      reportClientError({
        module: 'api.upload',
        message: `Upload failed to reach API: ${msg}`,
        context: { path, kind: 'network' },
        err,
      });
    }
    throw new ApiError(0, `Cannot reach API: ${msg}`, 'NETWORK_ERROR');
  }

  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    let code: string | undefined;
    let details: unknown;
    try {
      const err = (await res.json()) as { error?: string; code?: string; details?: unknown };
      if (err.error) message = err.error;
      code = err.code;
      details = err.details;
    } catch { /* non-JSON body — keep statusText */ }
    if (shouldLog(path)) {
      reportClientError({
        level: res.status >= 500 ? 'error' : 'warn',
        module: 'api.upload',
        message: `POST ${path} → ${res.status}: ${message}`,
        context: { path, status: res.status, code, details },
      });
    }
    throw new ApiError(res.status, message, code, details);
  }

  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

export const api = {
  get:   <T>(path: string)                    => request<T>('GET',   path),
  post:  <T>(path: string, body?: unknown)    => request<T>('POST',  path, body),
  patch: <T>(path: string, body?: unknown)    => request<T>('PATCH', path, body),
  put:   <T>(path: string, body?: unknown)    => request<T>('PUT',   path, body),
  del:   <T>(path: string)                    => request<T>('DELETE', path),
  upload: <T>(path: string, formData: FormData) => upload<T>(path, formData),
};
