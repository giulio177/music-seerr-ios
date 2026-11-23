import { File } from 'expo-file-system';
import { create } from 'zustand';
import { api, ApiError } from './api';
import { supportDir } from './offline';
import { useAccent } from './theme';

/** The account preferences of `/api/me/preferences`, shared with the web app. */
export type Preferences = {
  accent_color: string | null;
  default_accent_color: string;
  crossfade_seconds: number;
  show_other_users_controls: boolean;
};
export type PreferenceChange = Partial<Pick<Preferences, 'accent_color' | 'crossfade_seconds' | 'show_other_users_controls'>>;

/** Saved copy: the last preferences from the server plus the changes made offline, sent when it answers again. */
type Saved = { userId: string; prefs: Preferences | null; pending: PreferenceChange };

const file = new File(supportDir, 'preferences.json');

function read(): Saved | null {
  try {
    return file.exists ? (JSON.parse(file.textSync()) as Saved) : null;
  } catch {
    return null;
  }
}

function write(saved: Saved) {
  try {
    if (!supportDir.exists) supportDir.create({ intermediates: true });
    file.writeSync(JSON.stringify(saved));
  } catch (error) {
    console.warn('[preferences] could not save', error);
  }
}

function applyAccent(prefs: Preferences | null) {
  if (prefs) useAccent.getState().setAccent(prefs.accent_color || prefs.default_accent_color);
}

type PreferencesState = {
  userId: string | null;
  /** Server values with the pending changes applied: what the app shows and uses. */
  prefs: Preferences | null;
  pending: PreferenceChange;
  /** Opens the saved copy for this account at launch, so the accent and settings hold without the server. */
  restore: (userId: string) => void;
  /** Sends the pending changes, then reads the server values. Silent when the server is unreachable. */
  sync: () => Promise<void>;
  /** Changes preferences at once; saved on the server now, or when it is reachable again. */
  change: (change: PreferenceChange) => Promise<void>;
  clear: () => void;
};

let syncing: Promise<void> | null = null;

export const usePreferences = create<PreferencesState>((set, get) => {
  const persist = () => {
    const { userId, prefs, pending } = get();
    if (userId) write({ userId, prefs, pending });
  };

  return {
    userId: null,
    prefs: null,
    pending: {},

    restore: (userId) => {
      const saved = read();
      if (saved?.userId !== userId) {
        set({ userId, prefs: null, pending: {} });
        return;
      }
      set({ userId, prefs: saved.prefs, pending: saved.pending ?? {} });
      applyAccent(saved.prefs);
    },

    sync: () => {
      syncing ??= (async () => {
        try {
          const pending = get().pending;
          if (Object.keys(pending).length) {
            await api('/api/me/preferences', { method: 'POST', body: pending });
            // Changes made while this request ran stay pending.
            const rest = { ...get().pending };
            for (const key of Object.keys(pending) as (keyof PreferenceChange)[]) {
              if (rest[key] === pending[key]) delete rest[key];
            }
            set({ pending: rest });
          }
          const server = await api<Preferences>('/api/me/preferences');
          const prefs = { ...server, ...get().pending };
          set({ prefs });
          persist();
          applyAccent(prefs);
        } catch (error) {
          // Unreachable: keep the pending changes for the next try. Rejected (HTTP error): drop them.
          if (error instanceof ApiError && !error.offline) {
            set({ pending: {} });
            persist();
          }
        } finally {
          syncing = null;
        }
      })();
      return syncing;
    },

    change: async (change) => {
      const base: Preferences = get().prefs ?? {
        accent_color: null,
        default_accent_color: 'pink',
        crossfade_seconds: 0,
        show_other_users_controls: false,
      };
      const prefs = { ...base, ...change };
      set({ prefs, pending: { ...get().pending, ...change } });
      persist();
      applyAccent(prefs);
      await syncing;
      await get().sync();
    },

    clear: () => {
      set({ userId: null, prefs: null, pending: {} });
      try {
        if (file.exists) file.delete();
      } catch {
        // Nothing to remove.
      }
    },
  };
});
