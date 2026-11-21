import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { api, ApiError, normalizeServerUrl } from './api';
import { useAccent } from './theme';
import type { User } from './types';

const KEYS = { server: 'server_url', token: 'session_token', user: 'session_user' };

type AuthState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  serverUrl: string;
  token: string | null;
  user: User | null;
  /** The last check could not reach the server; the app runs from offline downloads. */
  unreachable: boolean;
  load: () => Promise<void>;
  verify: () => Promise<void>;
  login: (server: string, username: string, password: string) => Promise<void>;
  continueAsGuest: (server: string) => Promise<void>;
  logout: () => Promise<void>;
  /** The server rejected the token (expired or revoked). */
  expire: () => void;
};

type LoginResponse = { success: boolean; user: User; session_token?: string };

async function persist(server: string, token: string, user: User) {
  await SecureStore.setItemAsync(KEYS.server, server);
  await SecureStore.setItemAsync(KEYS.token, token);
  await SecureStore.setItemAsync(KEYS.user, JSON.stringify(user));
}

async function loadAccent() {
  try {
    const prefs = await api<{ accent_color?: string | null; default_accent_color?: string | null }>('/api/me/preferences');
    useAccent.getState().setAccent(prefs.accent_color || prefs.default_accent_color);
  } catch {
    // Keep the current accent.
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  serverUrl: '',
  token: null,
  user: null,
  unreachable: false,

  load: async () => {
    const [serverUrl, token, userJson] = await Promise.all([
      SecureStore.getItemAsync(KEYS.server),
      SecureStore.getItemAsync(KEYS.token),
      SecureStore.getItemAsync(KEYS.user),
    ]);
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
    // Open the app at once with the saved session (offline downloads work without the server),
    // then confirm it in the background.
    set({ status: 'signedIn', serverUrl, token, user });
    get().verify();
  },

  verify: async () => {
    try {
      const session = await api<{ authenticated: boolean; user: User | null }>('/api/auth/session', { timeoutMs: 6000 });
      if (!session.authenticated || !session.user) {
        get().expire();
        return;
      }
      set({ user: session.user, unreachable: false });
      await SecureStore.setItemAsync(KEYS.user, JSON.stringify(session.user));
      if (!session.user.is_guest) loadAccent();
    } catch (error) {
      if (error instanceof ApiError && error.offline) set({ unreachable: true });
    }
  },

  login: async (server, username, password) => {
    const serverUrl = normalizeServerUrl(server);
    const res = await api<LoginResponse>('/api/auth/login', {
      method: 'POST',
      server: serverUrl,
      token: null,
      body: { username: username.trim(), password },
    });
    if (!res.session_token) throw new ApiError(500, 'server_too_old');
    await persist(serverUrl, res.session_token, res.user);
    set({ status: 'signedIn', serverUrl, token: res.session_token, user: res.user, unreachable: false });
    loadAccent();
  },

  continueAsGuest: async (server) => {
    const serverUrl = normalizeServerUrl(server);
    const res = await api<LoginResponse>('/api/auth/guest', { method: 'POST', server: serverUrl, token: null });
    if (!res.session_token) throw new ApiError(500, 'server_too_old');
    await persist(serverUrl, res.session_token, res.user);
    set({ status: 'signedIn', serverUrl, token: res.session_token, user: res.user, unreachable: false });
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
    SecureStore.deleteItemAsync(KEYS.token);
    SecureStore.deleteItemAsync(KEYS.user);
    set({ status: 'signedOut', token: null, user: null, unreachable: false });
  },
}));
