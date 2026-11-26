import { create } from 'zustand';
import { api, ApiError, bindSession, serverCandidates } from './api';
import { deleteKey, readKey, writeKey } from './keychain';
import { backfillCovers } from './offline';
import { usePlaylists } from './playlists';
import { usePreferences } from './preferences';
import type { User } from './types';

const KEYS = { server: 'server_url', token: 'session_token', user: 'session_user' };

type AuthState = {
  /**
   * `offline`: no session, the app shows the downloaded songs only. `locked`: the keychain cannot be read yet
   * (iPhone not unlocked since boot); `load` runs again when the app comes to the foreground.
   */
  status: 'loading' | 'locked' | 'signedOut' | 'signedIn' | 'offline';
  serverUrl: string;
  token: string | null;
  user: User | null;
  /** The last request could not reach the server: server screens show the offline mode, downloads still play. */
  unreachable: boolean;
  load: () => Promise<void>;
  verify: (timeoutMs?: number) => Promise<void>;
  /** Opens the downloads without signing in. */
  openDownloadsOnly: () => void;
  /** Leaves the downloads-only mode for the sign-in screen. */
  leaveDownloadsOnly: () => void;
  login: (server: string, username: string, password: string) => Promise<void>;
  continueAsGuest: (server: string) => Promise<void>;
  /**
   * Moves the session to another address of the server (LAN, VPN, domain). The saved token must be valid there,
   * else `session_not_valid` (another server: sign in again) or `offline` (not reachable).
   */
  changeServer: (server: string) => Promise<void>;
  logout: () => Promise<void>;
  /** The server rejected the token (expired or revoked). */
  expire: () => void;
};

type LoginResponse = { success: boolean; user: User; session_token?: string };

/** Saves the session in the keychain; a keychain failure keeps the session for this launch only. */
async function persist(server: string, token: string, user: User) {
  try {
    await writeKey(KEYS.server, server);
    await writeKey(KEYS.token, token);
    await writeKey(KEYS.user, JSON.stringify(user));
  } catch (error) {
    console.warn('[auth] could not save the session to the keychain', error);
  }
}

/** Runs `request` on the first address that answers; throws the first address's error when none does. */
async function firstReachable<T>(input: string, request: (serverUrl: string) => Promise<T>): Promise<{ serverUrl: string; result: T }> {
  let first: unknown = null;
  for (const serverUrl of serverCandidates(input)) {
    try {
      return { serverUrl, result: await request(serverUrl) };
    } catch (error) {
      first ??= error;
      if (!(error instanceof ApiError && error.offline)) break;
    }
  }
  throw first;
}

/** Restores this account's saved preferences (accent color) and refreshes them from the server. */
function loadPreferences(user: User | null) {
  if (!user || user.is_guest) return;
  if (usePreferences.getState().userId !== (user.id ?? user.name)) usePreferences.getState().restore(user.id ?? user.name);
  usePreferences.getState().sync();
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  serverUrl: '',
  token: null,
  user: null,
  unreachable: false,

  load: async () => {
    let serverUrl: string | null, token: string | null, userJson: string | null;
    try {
      [serverUrl, token, userJson] = await Promise.all([readKey(KEYS.server), readKey(KEYS.token), readKey(KEYS.user)]);
    } catch (error) {
      // A refused read is not a missing session: never show the sign-in screen for it.
      console.warn('[auth] keychain not readable yet', error);
      set({ status: 'locked' });
      return;
    }
    if (!serverUrl || !token) {
      set({ status: 'signedOut', serverUrl: serverUrl ?? '' });
      return;
    }
    let user: User | null = null;
    try {
      user = userJson ? JSON.parse(userJson) : null;
    } catch {
      user = null;
    }
    // Open the app at once with the saved session (downloads work without the server),
    // then confirm it in the background.
    set({ status: 'signedIn', serverUrl, token, user });
    // Sessions saved by older builds are readable only while unlocked: save them again with the new accessibility.
    writeKey(KEYS.server, serverUrl).catch(() => undefined);
    writeKey(KEYS.token, token).catch(() => undefined);
    if (userJson) writeKey(KEYS.user, userJson).catch(() => undefined);
    if (user && !user.is_guest) usePreferences.getState().restore(user.id ?? user.name);
    get().verify();
  },

  verify: async (timeoutMs = 6000) => {
    try {
      const session = await api<{ authenticated: boolean; user: User | null }>('/api/auth/session', { timeoutMs });
      if (!session.authenticated || !session.user) {
        get().expire();
        return;
      }
      set({ user: session.user, unreachable: false });
      await writeKey(KEYS.user, JSON.stringify(session.user)).catch(() => undefined);
      if (!session.user.is_guest) {
        loadPreferences(session.user);
        backfillCovers();
        usePlaylists.getState().refresh();
      }
    } catch (error) {
      if (error instanceof ApiError && error.offline) set({ unreachable: true });
    }
  },

  openDownloadsOnly: () => set({ status: 'offline', unreachable: false }),

  leaveDownloadsOnly: () => set({ status: 'signedOut' }),

  login: async (server, username, password) => {
    const { serverUrl, result: res } = await firstReachable(server, (url) =>
      api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        server: url,
        token: null,
        body: { username: username.trim(), password },
      }),
    );
    if (!res.session_token) throw new ApiError(500, 'server_too_old');
    await persist(serverUrl, res.session_token, res.user);
    set({ status: 'signedIn', serverUrl, token: res.session_token, user: res.user, unreachable: false });
    loadPreferences(res.user);
  },

  continueAsGuest: async (server) => {
    const { serverUrl, result: res } = await firstReachable(server, (url) =>
      api<LoginResponse>('/api/auth/guest', { method: 'POST', server: url, token: null }),
    );
    if (!res.session_token) throw new ApiError(500, 'server_too_old');
    await persist(serverUrl, res.session_token, res.user);
    set({ status: 'signedIn', serverUrl, token: res.session_token, user: res.user, unreachable: false });
  },

  changeServer: async (server) => {
    const { token } = get();
    const { serverUrl, result: session } = await firstReachable(server, (url) =>
      api<{ authenticated: boolean; user: User | null }>('/api/auth/session', { server: url, token, timeoutMs: 8000 }),
    );
    if (!session.authenticated || !session.user || !token) throw new ApiError(401, 'session_not_valid');
    await persist(serverUrl, token, session.user);
    set({ serverUrl, user: session.user, unreachable: false });
    loadPreferences(session.user);
  },

  logout: async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', timeoutMs: 5000 });
    } catch {
      // Sign out locally even when the server is unreachable.
    }
    get().expire();
  },

  expire: () => {
    deleteKey(KEYS.token).catch(() => undefined);
    deleteKey(KEYS.user).catch(() => undefined);
    usePreferences.getState().clear();
    set({ status: 'signedOut', token: null, user: null, unreachable: false });
  },
}));

bindSession(
  () => useAuth.getState(),
  () => useAuth.getState().expire(),
  (reachable) => {
    const { unreachable, user } = useAuth.getState();
    if (unreachable !== reachable) return;
    useAuth.setState({ unreachable: !reachable });
    // Back online: send the preferences changed meanwhile.
    if (reachable && user && !user.is_guest) usePreferences.getState().sync();
  },
);
