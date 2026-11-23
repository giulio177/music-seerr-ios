import { useEffect, useState } from 'react';
import { api } from './api';
import { useOffline } from './offline';
import type { QueueItem } from './player';
import type { Lyrics } from './types';

/** `text` empty means an instrumental part, shown as three dots that fill up over `duration` seconds. */
export type LyricLine = { time: number; text: string; duration: number };

const DOT_TEXTS = new Set(['\u266a', '...', '..', '\u2022 \u2022 \u2022']);

/**
 * Parses LRC text (a line may carry several timestamps), the same way as the web app:
 * music-note and dot lines become instrumental parts, an intro before the first line and
 * gaps of 7.5 s or more between sung lines get one too.
 */
export function parseLrc(lrc: string): LyricLine[] {
  let lines: { time: number; text: string }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    let text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (DOT_TEXTS.has(text)) text = '';
    for (const stamp of stamps) lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]), text });
  }
  lines.sort((a, b) => a.time - b.time);

  // Metadata at 00:00 (e.g. "[00:00.00]Artist") followed by an empty line within a second.
  if (lines.length > 1 && lines[0].time < 0.5 && lines[1].time < 1 && !lines[1].text) {
    lines.shift();
    lines[0].time = 0;
  }
  if (lines.length && lines[0].time > 1.2) lines.unshift({ time: 0, text: '' });

  const enriched: { time: number; text: string }[] = [];
  lines.forEach((line, i) => {
    enriched.push(line);
    const next = lines[i + 1];
    if (next && line.text && next.text && next.time - line.time >= 7.5) {
      enriched.push({ time: +(line.time + Math.min(4, (next.time - line.time) * 0.4)).toFixed(2), text: '' });
    }
  });
  lines = enriched;

  return lines.map((line, i) => ({
    ...line,
    duration: i < lines.length - 1 ? Math.max(0.4, lines[i + 1].time - line.time) : 5,
  }));
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
