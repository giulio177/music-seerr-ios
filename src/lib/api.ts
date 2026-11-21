import { useAuth } from './auth';

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
  /** True when the server could not be reached at all (no HTTP response). */
  get offline() {
    return this.status === 0;
  }
}

/** Adds `http://` when missing and drops trailing slashes. */
export function normalizeServerUrl(input: string) {
  let url = input.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

/** Absolute URL for a backend path (paths from the API start with `/api/`). */
export function absoluteUrl(path: string, server = useAuth.getState().serverUrl) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${server}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function authHeaders(token = useAuth.getState().token): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  server?: string;
  token?: string | null;
  timeoutMs?: number;
  query?: Record<string, string | number | boolean | undefined | null>;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 15000, query } = options;
  const server = options.server ?? useAuth.getState().serverUrl;
  const token = options.token === undefined ? useAuth.getState().token : options.token;
  let url = absoluteUrl(path, server);
  if (query) {
    const params = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    if (params.length) url += (url.includes('?') ? '&' : '?') + params.join('&');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      // Native clients authenticate with a bearer token; never send cookies.
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'X-Music-Seerr-Client': 'ios',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(token),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline');
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : `HTTP ${response.status}`;
    if (response.status === 401 && token && token === useAuth.getState().token) {
      useAuth.getState().expire();
    }
    throw new ApiError(response.status, detail);
  }
  return data as T;
}
