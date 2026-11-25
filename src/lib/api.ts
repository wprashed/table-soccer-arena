/** Typed fetch wrapper. Token lives in (safe) storage; every call is authenticated. */
import { storage } from './safeStorage';

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
    throw networkError(err);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: any) => request<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(p: string, body?: any) => request<T>(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(p: string, body?: any) => request<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
};
