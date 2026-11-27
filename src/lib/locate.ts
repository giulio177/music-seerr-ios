import { router } from 'expo-router';
import { toast } from '@/components/Toast';
import { api, ApiError } from './api';
import i18n from './i18n';

/**
 * Opens a song's album in the current tab with the song highlighted (`/album/<id>?track=<song>`). The song is found
 * by Jellyfin ID when known (search results), else by title and artist (requests, whose rows keep the catalog song).
 */
export async function openInLibrary(song: { jellyfinId?: string | null; title: string; artist: string }) {
  try {
    const found = await api<{ id: string; album_id: string }>('/api/jellyfin/locate', {
      query: { item_id: song.jellyfinId ?? '', title: song.title, artist: song.artist },
    });
    router.push(`/album/${found.album_id}?track=${found.id}` as never);
  } catch (error) {
    toast(error instanceof ApiError && error.status === 404 ? i18n.t('search.notFoundInLibrary') : i18n.t('search.openFailed'));
  }
}
