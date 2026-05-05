const BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:4000';

function getToken(): string | null {
  return localStorage.getItem('wbs_token');
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

export const api = {
  get:   <T>(path: string)                    => request<T>('GET',   path),
  post:  <T>(path: string, body?: unknown)    => request<T>('POST',  path, body),
  patch: <T>(path: string, body?: unknown)    => request<T>('PATCH', path, body),
  put:   <T>(path: string, body?: unknown)    => request<T>('PUT',   path, body),
  del:   <T>(path: string)                    => request<T>('DELETE', path),
};
