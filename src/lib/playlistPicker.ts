import { router } from 'expo-router';
import { create } from 'zustand';
import { api } from './api';
import { usePlaylists } from './playlists';
import type { DownloadJob, LibraryTrack, Playlist } from './types';

/**
 * "Add to playlist": songs of the library, or a requested song still in the download queue (the server adds it
 * to the playlist when its download finishes). The picker screen (`/add-to-playlist`) reads the target from here.
 */
export type PickerTarget = { kind: 'tracks'; tracks: LibraryTrack[] } | { kind: 'job'; job: DownloadJob };

type PickerState = { target: PickerTarget | null };

export const usePlaylistPicker = create<PickerState>(() => ({ target: null }));

export function openAddToPlaylist(target: PickerTarget) {
  usePlaylistPicker.setState({ target });
  router.push('/add-to-playlist');
}

/** Adds the target to an existing playlist; returns `queued` when the song is added once its download finishes. */
export async function addToPlaylist(target: PickerTarget, playlist: Playlist): Promise<'added' | 'queued'> {
  if (target.kind === 'job') {
    const res = await api<{ status: 'added' | 'queued' }>(`/api/download/job/${target.job.job_id}/playlist`, {
      method: 'POST',
      body: { playlist_id: playlist.id },
    });
    if (res.status === 'added') usePlaylists.getState().changed(playlist.id);
    return res.status;
  }
  await api(`/api/jellyfin/playlist/${playlist.id}/add-items`, { method: 'POST', body: { item_ids: target.tracks.map((tr) => tr.id) } });
  usePlaylists.getState().changed(playlist.id);
  return 'added';
}

/** Creates a playlist owned by this account; library songs go in at once, a queued song once it is downloaded. */
export async function createPlaylist(name: string, target: PickerTarget | null): Promise<'added' | 'queued'> {
  const itemIds = target?.kind === 'tracks' ? target.tracks.map((tr) => tr.id) : [];
  const playlist = await api<Playlist>('/api/jellyfin/playlists', { method: 'POST', body: { name, item_ids: itemIds } });
  usePlaylists.getState().refresh();
  if (target?.kind === 'job') return addToPlaylist(target, playlist);
  return 'added';
}
