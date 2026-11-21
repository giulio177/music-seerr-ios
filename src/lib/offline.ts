import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { create } from 'zustand';
import { absoluteUrl, api, authHeaders } from './api';
import type { LibraryTrack, Lyrics } from './types';

/**
 * Offline library: audio and covers live in the app's Documents folder, metadata in SQLite.
 * Paths are stored as file names only, because iOS changes the container path on every update.
 */
export type OfflineTrack = {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  album: string;
  album_id: string | null;
  duration_sec: number;
  index_number: number | null;
  audio_file: string;
  cover_file: string | null;
  lyrics_synced: string | null;
  lyrics_plain: string | null;
  size: number;
  added_at: number;
};

const musicDir = new Directory(Paths.document, 'music');
const coverDir = new Directory(Paths.document, 'covers');

let db: SQLite.SQLiteDatabase | null = null;
function database() {
  if (!db) {
    db = SQLite.openDatabaseSync('offline.db');
    db.execSync(`CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      artist_id TEXT,
      album TEXT NOT NULL,
      album_id TEXT,
      duration_sec REAL NOT NULL DEFAULT 0,
      index_number INTEGER,
      audio_file TEXT NOT NULL,
      cover_file TEXT,
      lyrics_synced TEXT,
      lyrics_plain TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      added_at REAL NOT NULL
    )`);
  }
  return db;
}

function ensureDirs() {
  for (const dir of [musicDir, coverDir]) {
    if (!dir.exists) dir.create({ intermediates: true });
  }
}

/** AVPlayer cannot decode these containers; the backend transcodes them to MP3. */
const TRANSCODE = new Set(['ogg', 'oga', 'opus', 'wma', 'ape', 'wv', 'mka', 'webm']);

export function audioExtension(path?: string) {
  const ext = (path ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (!ext || ext.length > 5 || ext.includes('/')) return 'mp3';
  return TRANSCODE.has(ext) ? 'mp3' : ext;
}

export function streamPath(track: Pick<LibraryTrack, 'id' | 'path'>) {
  const ext = (track.path ?? '').split('.').pop()?.toLowerCase() ?? '';
  return `/api/jellyfin/stream/${track.id}${TRANSCODE.has(ext) ? '?format=mp3' : ''}`;
}

export function localAudioUri(track: OfflineTrack) {
  return new File(musicDir, track.audio_file).uri;
}

export function localCoverUri(track: OfflineTrack) {
  return track.cover_file ? new File(coverDir, track.cover_file).uri : null;
}

type DownloadState = 'queued' | number | 'error';

type OfflineState = {
  tracks: Record<string, OfflineTrack>;
  /** Progress (0-1), queued, or failed, per track ID while downloading. */
  active: Record<string, DownloadState>;
  refresh: () => void;
  download: (tracks: LibraryTrack[]) => void;
  remove: (id: string) => void;
  removeAll: () => void;
  totalSize: () => number;
};

const queue: LibraryTrack[] = [];
let running = 0;
const CONCURRENCY = 2;

async function fetchLyrics(track: LibraryTrack): Promise<Lyrics | null> {
  try {
    return await api<Lyrics>(`/api/jellyfin/track-lyrics/${track.id}`, {
      query: { title: track.title, artist: track.artist },
      timeoutMs: 10000,
    });
  } catch {
    return null;
  }
}

async function downloadOne(track: LibraryTrack, onProgress: (p: number) => void): Promise<OfflineTrack> {
  ensureDirs();
  const audioName = `${track.id}.${audioExtension(track.path)}`;
  const audio = new File(musicDir, audioName);
  if (audio.exists) audio.delete();
  const partial = new File(musicDir, `${audioName}.part`);
  if (partial.exists) partial.delete();
  await File.downloadFileAsync(absoluteUrl(streamPath(track)), partial, {
    headers: authHeaders(),
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress(bytesWritten / totalBytes);
    },
  });
  partial.move(audio);

  let coverName: string | null = `${track.id}.jpg`;
  try {
    const cover = new File(coverDir, coverName);
    if (cover.exists) cover.delete();
    await File.downloadFileAsync(absoluteUrl(track.cover_url), cover, { headers: authHeaders() });
  } catch {
    coverName = null;
  }

  const lyrics = await fetchLyrics(track);
  const row: OfflineTrack = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    artist_id: track.artist_id ?? null,
    album: track.album,
    album_id: track.album_id ?? null,
    duration_sec: track.duration_sec,
    index_number: track.index_number ?? null,
    audio_file: audioName,
    cover_file: coverName,
    lyrics_synced: lyrics?.synced ?? null,
    lyrics_plain: lyrics?.plain ?? null,
    size: audio.size ?? 0,
    added_at: Date.now() / 1000,
  };
  database().runSync(
    `INSERT OR REPLACE INTO tracks (id, title, artist, artist_id, album, album_id, duration_sec, index_number,
      audio_file, cover_file, lyrics_synced, lyrics_plain, size, added_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    row.id, row.title, row.artist, row.artist_id, row.album, row.album_id, row.duration_sec, row.index_number,
    row.audio_file, row.cover_file, row.lyrics_synced, row.lyrics_plain, row.size, row.added_at,
  );
  return row;
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const track = queue.shift()!;
    running++;
    const setActive = (state: DownloadState) =>
      useOffline.setState((s) => ({ active: { ...s.active, [track.id]: state } }));
    setActive(0);
    let lastReport = 0;
    downloadOne(track, (p) => {
      // Throttle progress updates to keep lists smooth.
      if (p - lastReport >= 0.05 || p >= 1) {
        lastReport = p;
        setActive(p);
      }
    })
      .then((row) => {
        useOffline.setState((s) => {
          const active = { ...s.active };
          delete active[track.id];
          return { active, tracks: { ...s.tracks, [row.id]: row } };
        });
      })
      .catch(() => setActive('error'))
      .finally(() => {
        running--;
        pump();
      });
  }
}

export const useOffline = create<OfflineState>((set, get) => ({
  tracks: {},
  active: {},

  refresh: () => {
    const rows = database().getAllSync<OfflineTrack>('SELECT * FROM tracks');
    const tracks: Record<string, OfflineTrack> = {};
    for (const row of rows) {
      // Drop rows whose audio file disappeared (for example after a restore).
      if (new File(musicDir, row.audio_file).exists) tracks[row.id] = row;
      else database().runSync('DELETE FROM tracks WHERE id = ?', row.id);
    }
    set({ tracks });
  },

  download: (tracks) => {
    const { tracks: saved, active } = get();
    const next = { ...active };
    for (const track of tracks) {
      const state = active[track.id];
      if (saved[track.id] || (state !== undefined && state !== 'error')) continue;
      next[track.id] = 'queued';
      queue.push(track);
    }
    set({ active: next });
    pump();
  },

  remove: (id) => {
    const track = get().tracks[id];
    if (!track) return;
    for (const file of [new File(musicDir, track.audio_file), track.cover_file && new File(coverDir, track.cover_file)]) {
      try {
        if (file && file.exists) file.delete();
      } catch {
        // Already gone.
      }
    }
    database().runSync('DELETE FROM tracks WHERE id = ?', id);
    set((s) => {
      const tracks = { ...s.tracks };
      delete tracks[id];
      return { tracks };
    });
  },

  removeAll: () => {
    queue.length = 0;
    for (const dir of [musicDir, coverDir]) {
      try {
        if (dir.exists) dir.delete();
      } catch {
        // Ignore.
      }
    }
    database().runSync('DELETE FROM tracks');
    set({ tracks: {}, active: {} });
  },

  totalSize: () => Object.values(get().tracks).reduce((sum, t) => sum + (t.size || 0), 0),
}));

/** An offline row in the library track shape, for playback and lists. */
export function offlineToLibrary(track: OfflineTrack): LibraryTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    artist_id: track.artist_id,
    album: track.album,
    album_id: track.album_id,
    duration_sec: track.duration_sec,
    index_number: track.index_number,
    path: track.audio_file,
    stream_url: `/api/jellyfin/stream/${track.id}`,
    cover_url: `/api/jellyfin/image/${track.id}`,
  };
}
