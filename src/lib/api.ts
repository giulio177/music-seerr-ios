type Session = { serverUrl: string; token: string | null };

// The auth store registers itself here, so this module does not import it (no require cycle).
let currentSession: () => Session = () => ({ serverUrl: '', token: null });
let onUnauthorized: () => void = () => undefined;
let onReachability: (reachable: boolean) => void = () => undefined;

export function bindSession(get: () => Session, unauthorized: () => void, reachability: (reachable: boolean) => void) {
  currentSession = get;
  onUnauthorized = unauthorized;
  onReachability = reachability;
}

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
export function absoluteUrl(path: string, server = currentSession().serverUrl) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${server}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Backend path of a URL on the current server (`/api/...`), or null for other hosts. */
export function serverPath(url: string) {
  if (url.startsWith('/')) return url;
  const server = currentSession().serverUrl;
  return server && url.startsWith(`${server}/`) ? url.slice(server.length) : null;
}

/** Album artwork, used when a song has no image of its own (Jellyfin keeps most artwork on the album). */
export function albumCoverPath(albumId?: string | null) {
  return albumId ? `/api/jellyfin/image/${albumId}` : null;
}

export function authHeaders(token = currentSession().token): Record<string, string> {
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
  const server = options.server ?? currentSession().serverUrl;
  const token = options.token === undefined ? currentSession().token : options.token;
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
    if (server === currentSession().serverUrl) onReachability(false);
    throw new ApiError(0, 'offline');
  } finally {
    clearTimeout(timer);
  }
  if (server === currentSession().serverUrl) onReachability(true);
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : `HTTP ${response.status}`;
    if (response.status === 401 && token && token === currentSession().token && server === currentSession().serverUrl) onUnauthorized();
    throw new ApiError(response.status, detail);
  }
  return data as T;
}
