import { useEffect, useState } from 'react';
import { api } from './api';
import { useOffline } from './offline';
import type { QueueItem } from './player';
import type { Lyrics } from './types';

export type LyricLine = { time: number; text: string };

/** Parses LRC text; a line may carry several timestamps. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const stamp of stamps) lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]), text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

const cache = new Map<string, Lyrics | null>();

/** Lyrics of the current song: downloaded copy first, then the server (cached per song). */
export function useLyrics(item?: QueueItem) {
  const id = item?.kind === 'library' ? item.id : undefined;
  const saved = useOffline((s) => (id ? s.tracks[id] : undefined));
  const local: Lyrics | undefined =
    saved && (saved.lyrics_synced || saved.lyrics_plain)
      ? { found: true, synced: saved.lyrics_synced, plain: saved.lyrics_plain }
      : undefined;
  const [fetched, setFetched] = useState<{ id: string; lyrics: Lyrics | null } | null>(null);
  const title = item?.title;
  const artist = item?.artist;
  const needsFetch = !!id && !local && !cache.has(id);

  useEffect(() => {
    if (!needsFetch || !id) return;
    let cancelled = false;
    api<Lyrics>(`/api/jellyfin/track-lyrics/${id}`, { query: { title, artist }, timeoutMs: 12000 })
      .then((lyrics) => {
        cache.set(id, lyrics);
        return lyrics;
      })
      .catch(() => null)
      .then((lyrics) => {
        if (!cancelled) setFetched({ id, lyrics });
      });
    return () => {
      cancelled = true;
    };
  }, [needsFetch, id, title, artist]);

  if (!id) return { lyrics: null, loading: false };
  if (local) return { lyrics: local, loading: false };
  if (cache.has(id)) return { lyrics: cache.get(id) ?? null, loading: false };
  if (fetched?.id === id) return { lyrics: fetched.lyrics, loading: false };
  return { lyrics: null, loading: true };
}
