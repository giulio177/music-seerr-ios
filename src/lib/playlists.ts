import { File } from 'expo-file-system';
import { create } from 'zustand';
import { api } from './api';
import { supportDir } from './offline';
import type { LibraryTrack, Playlist } from './types';

/** A playlist as remembered for the Downloads tab: its name and song IDs in order. */
export type SavedPlaylist = { id: string; name: string; cover_url?: string | null; track_ids: string[] };

const file = new File(supportDir, 'playlists.json');

function save(playlists: SavedPlaylist[]) {
  try {
    if (!supportDir.exists) supportDir.create({ intermediates: true });
    file.writeSync(JSON.stringify(playlists));
  } catch (error) {
    console.warn('[playlists] could not save', error);
  }
}

function read(): SavedPlaylist[] {
  try {
    return file.exists ? (JSON.parse(file.textSync()) as SavedPlaylist[]) : [];
  } catch {
    return [];
  }
}

type PlaylistState = {
  playlists: SavedPlaylist[];
  /** Fetches every playlist with its song IDs and saves them, so Downloads can show playlists offline. */
  refresh: () => Promise<void>;
  /** Updates one playlist after its page loaded online. */
  remember: (playlist: SavedPlaylist) => void;
  /** Bumped when a playlist changes here, so its open page reloads. */
  revisions: Record<string, number>;
  /** Removes one entry from the Jellyfin playlist (throws `ApiError`). */
  removeEntry: (playlistId: string, track: LibraryTrack) => Promise<void>;
};

let running: Promise<void> | null = null;

export const usePlaylists = create<PlaylistState>((set, get) => ({
  playlists: read(),
  revisions: {},
  removeEntry: async (playlistId, track) => {
    if (!track.playlist_entry_id) return;
    await api(`/api/jellyfin/playlist/${playlistId}/items/${encodeURIComponent(track.playlist_entry_id)}`, { method: 'DELETE' });
    const playlists = get().playlists.map((p) => {
      if (p.id !== playlistId) return p;
      const at = p.track_ids.indexOf(track.id);
      return at < 0 ? p : { ...p, track_ids: p.track_ids.filter((_, i) => i !== at) };
    });
    set({ playlists, revisions: { ...get().revisions, [playlistId]: (get().revisions[playlistId] ?? 0) + 1 } });
    save(playlists);
  },
  remember: (playlist) => {
    const current = get().playlists;
    const old = current.find((p) => p.id === playlist.id);
    if (old && old.name === playlist.name && old.track_ids.join() === playlist.track_ids.join()) return;
    const playlists = old ? current.map((p) => (p.id === playlist.id ? playlist : p)) : [...current, playlist];
    set({ playlists });
    save(playlists);
  },
  refresh: () => {
    running ??= (async () => {
      try {
        const list = await api<Playlist[]>('/api/jellyfin/playlists');
        const playlists: SavedPlaylist[] = [];
        // A few at a time: libraries can hold many playlists.
        for (let i = 0; i < list.length; i += 4) {
          const batch = await Promise.all(
            list.slice(i, i + 4).map(async (p) => {
              try {
                const res = await api<{ tracks: LibraryTrack[] }>(`/api/jellyfin/playlist/${p.id}/tracks`);
                return { id: p.id, name: p.name, cover_url: p.cover_url, track_ids: res.tracks.map((tr) => tr.id) };
              } catch {
                return usePlaylists.getState().playlists.find((saved) => saved.id === p.id) ?? null;
              }
            }),
          );
          playlists.push(...batch.filter((p): p is SavedPlaylist => !!p));
        }
        set({ playlists });
        save(playlists);
      } catch {
        // Offline or a guest: keep the saved list.
      } finally {
        running = null;
      }
    })();
    return running;
  },
}));
