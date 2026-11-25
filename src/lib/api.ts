/** Typed fetch wrapper. Token lives in (safe) storage; every call is authenticated. */
import { storage } from './safeStorage';
import { handleMockApi } from './mockBackend';

const TOKEN_KEY = 'tsa.token';

export function getToken(): string | null {
  return storage.get(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) storage.set(TOKEN_KEY, t);
  else storage.remove(TOKEN_KEY);
}

/** Human-readable network failures (offline, DNS, proxy rejecting the origin). */
function networkError(err: unknown): ApiError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
    return new ApiError('Cannot reach the game server — check your connection', 0);
  }
  return new ApiError(msg, 0);
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const serverUrl = (typeof window !== 'undefined' && localStorage.getItem('server_url')) || (import.meta as any).env?.VITE_SERVER_URL || '';
  const isGitHubPages = typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');

  // If on GitHub Pages and no custom server is specified, use client-side mock backend directly
  if (!serverUrl && isGitHubPages) {
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
    return (await handleMockApi(path, opts.method || 'GET', body, token)) as T;
  }

  const apiBase = serverUrl ? serverUrl.replace(/\/$/, '') : '';
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });
  } catch (err) {
    // If network fails and no serverUrl is configured, try mock backend
    if (!serverUrl) {
      const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
      return (await handleMockApi(path, opts.method || 'GET', body, token)) as T;
    }
    throw networkError(err);
  }

  // GitHub Pages static web servers return 405 Not Allowed for POST / PUT / PATCH
  if (res.status === 405 || (!serverUrl && res.status === 404)) {
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
    return (await handleMockApi(path, opts.method || 'GET', body, token)) as T;
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    let errMsg = data?.error;
    if (typeof errMsg === 'string' && errMsg.includes('<html')) {
      errMsg = `Server error (${res.status} ${res.statusText || 'Endpoint unavailable'})`;
    }
    throw new ApiError(errMsg ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: any) => request<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(p: string, body?: any) => request<T>(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(p: string, body?: any) => request<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
};
