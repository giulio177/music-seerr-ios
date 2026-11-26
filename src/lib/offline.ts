import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { create } from 'zustand';
import { absoluteUrl, albumCoverPath, api, authHeaders } from './api';
import type { LibraryTrack, Lyrics } from './types';

/**
 * Offline library. Songs live in Documents as `<Artist>/<Album>/<NN> <Title>.<ext>`, which the Files app shows
 * under "On My iPhone > Sonalis" (UIFileSharingEnabled). Covers and the SQLite metadata stay hidden in
 * Library/Application Support. Paths are stored relative, because iOS changes the container path on every update.
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

const musicDir = Paths.document;
export const supportDir = new Directory(Paths.document.parentDirectory, 'Library', 'Application Support', 'Sonalis');
const coverDir = new Directory(supportDir, 'covers');
const partialDir = new Directory(Paths.cache, 'downloads');

/** Relative audio path (`Artist/Album/01 Title.mp3`) to a File. */
function audioFile(relative: string) {
  return new File(musicDir, ...relative.split('/'));
}

/**
 * File name part safe for the Files app and for file URLs: letters, digits, spaces, and a few punctuation
 * marks. Brackets become parentheses (`[Radio Version]`); characters a URL path cannot hold become `_`.
 */
function safeName(value: string | null | undefined, fallback: string) {
  const cleaned = (value ?? '')
    .replace(/[[{]/g, '(')
    .replace(/[\]}]/g, ')')
    .replace(/[^\p{L}\p{N}\p{M} _\-.,'()&+!]/gu, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

function readablePath(track: Pick<LibraryTrack, 'id' | 'title' | 'artist' | 'album' | 'index_number'>, ext: string) {
  const number = track.index_number ? `${String(track.index_number).padStart(2, '0')} ` : '';
  const base = [safeName(track.artist, 'Unknown artist'), safeName(track.album, 'Unknown album'), `${number}${safeName(track.title, track.id)}`].join('/');
  // Two different songs can share artist, album, and title; the ID keeps them apart.
  return audioFile(`${base}.${ext}`).exists ? `${base} (${track.id.slice(0, 6)}).${ext}` : `${base}.${ext}`;
}

/** Deletes empty album and artist folders left behind by a removed song. */
function pruneEmptyFolders(relative: string) {
  const parts = relative.split('/').slice(0, -1);
  while (parts.length) {
    const dir = new Directory(musicDir, ...parts);
    try {
      if (dir.exists && dir.list().length === 0) dir.delete();
      else return;
    } catch {
      return;
    }
    parts.pop();
  }
}

function pathOf(dir: Directory) {
  return decodeURIComponent(dir.uri.replace(/^file:\/\//, ''));
}

/**
 * Moves the first layout (Documents/music/<id>.<ext>, Documents/covers, Documents/SQLite) into the current one.
 * Idempotent and synchronous (`moveSync`): it also repairs a half-finished earlier run, so a song whose row
 * points at a missing file is looked up again in the old folder.
 */
function migrateLegacyStorage(database: SQLite.SQLiteDatabase) {
  // Rows still in the old database (an earlier run could open the new one before the old one moved).
  const legacyDb = new Directory(Paths.document, 'SQLite');
  if (new File(legacyDb, 'offline.db').exists) {
    try {
      database.execSync(`ATTACH DATABASE '${pathOf(legacyDb).replace(/'/g, "''")}/offline.db' AS legacy`);
      database.execSync('INSERT OR IGNORE INTO tracks SELECT * FROM legacy.tracks');
      database.execSync('DETACH DATABASE legacy');
      legacyDb.delete();
    } catch (error) {
      console.warn('[offline] could not merge the old database', error);
    }
  }

  // Covers are re-fetched by backfillCovers when missing, so a failed move loses nothing.
  const legacyCovers = new Directory(Paths.document, 'covers');
  if (legacyCovers.exists) {
    for (const entry of legacyCovers.list()) {
      try {
        if (entry instanceof File && !new File(coverDir, entry.name).exists) entry.moveSync(coverDir);
      } catch (error) {
        console.warn('[offline] could not move a cover', error);
      }
    }
    try {
      legacyCovers.delete();
    } catch {
      // Leave it.
    }
  }

  const legacyMusic = new Directory(Paths.document, 'music');
  if (!legacyMusic.exists) return;
  for (const row of database.getAllSync<OfflineTrack>('SELECT * FROM tracks')) {
    if (row.audio_file.includes('/') && audioFile(row.audio_file).exists) continue;
    const ext = row.audio_file.split('.').pop() || 'mp3';
    const old = new File(legacyMusic, `${row.id}.${ext}`);
    if (!old.exists) continue;
    try {
      const relative = readablePath(row, ext);
      const dest = audioFile(relative);
      if (!dest.parentDirectory.exists) dest.parentDirectory.create({ intermediates: true });
      old.moveSync(dest);
      database.runSync('UPDATE tracks SET audio_file = ?, size = ? WHERE id = ?', relative, dest.size ?? row.size, row.id);
    } catch (error) {
      console.warn('[offline] could not move', row.audio_file, error);
    }
  }
  // What is left belongs to no saved song (an earlier run lost its row): the app can no longer play it.
  try {
    legacyMusic.delete();
  } catch {
    // Leave it.
  }
}

let db: SQLite.SQLiteDatabase | null = null;
function database() {
  if (!db) {
    if (!supportDir.exists) supportDir.create({ intermediates: true });
    // The first layout kept the database in Documents/SQLite, which the Files app would show.
    const legacyDb = new Directory(Paths.document, 'SQLite');
    if (new File(legacyDb, 'offline.db').exists && !new File(supportDir, 'offline.db').exists) {
      for (const name of ['offline.db', 'offline.db-wal', 'offline.db-shm']) {
        const file = new File(legacyDb, name);
        if (file.exists) file.moveSync(supportDir);
      }
      try {
        legacyDb.delete();
      } catch {
        // Leave it.
      }
    }
    db = SQLite.openDatabaseSync('offline.db', undefined, pathOf(supportDir));
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
    migrateLegacyStorage(db);
  }
  return db;
}

function ensureDirs() {
  for (const dir of [coverDir, partialDir]) {
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
  return audioFile(track.audio_file).uri;
}

export function localCoverUri(track: OfflineTrack) {
  return track.cover_file ? new File(coverDir, track.cover_file).uri : null;
}

/**
 * Saves the first artwork that loads (song image, then album image) to `dest`. Uses `fetch` because the
 * file download API dropped the Authorization header for images (the server answered 401).
 * Returns false when none exists or the server is unreachable.
 */
export async function saveArtwork(paths: (string | null | undefined)[], dest: File): Promise<boolean> {
  for (const path of paths) {
    if (!path) continue;
    try {
      const res = await fetch(absoluteUrl(path), { headers: authHeaders(), credentials: 'omit' });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length) continue;
      if (dest.exists) dest.delete();
      dest.writeSync(bytes);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Fetches missing covers of downloaded songs (earlier versions saved none when the song had no own image). */
let backfilling = false;
export async function backfillCovers() {
  if (backfilling) return;
  backfilling = true;
  try {
    ensureDirs();
    for (const track of Object.values(useOffline.getState().tracks)) {
      if (track.cover_file && new File(coverDir, track.cover_file).exists) continue;
      const name = `${track.id}.jpg`;
      const ok = await saveArtwork([`/api/jellyfin/image/${track.id}`, albumCoverPath(track.album_id)], new File(coverDir, name));
      if (!ok) continue;
      database().runSync('UPDATE tracks SET cover_file = ? WHERE id = ?', name, track.id);
      useOffline.setState((s) => (s.tracks[track.id] ? { tracks: { ...s.tracks, [track.id]: { ...s.tracks[track.id], cover_file: name } } } : s));
    }
  } finally {
    backfilling = false;
  }
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
  const audioName = readablePath(track, audioExtension(track.path));
  const audio = audioFile(audioName);
  // Partial downloads stay in Caches so the Files app never shows half a song.
  const partial = new File(partialDir, `${track.id}.part`);
  if (partial.exists) partial.delete();
  await File.downloadFileAsync(absoluteUrl(streamPath(track)), partial, {
    headers: authHeaders(),
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress(bytesWritten / totalBytes);
    },
  });
  if (!audio.parentDirectory.exists) audio.parentDirectory.create({ intermediates: true });
  partial.moveSync(audio);

  const coverName = (await saveArtwork([track.cover_url, albumCoverPath(track.album_id)], new File(coverDir, `${track.id}.jpg`)))
    ? `${track.id}.jpg`
    : null;

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
      // Drop rows whose audio file disappeared (deleted in the Files app, or after a restore).
      if (audioFile(row.audio_file).exists) tracks[row.id] = row;
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
    for (const file of [audioFile(track.audio_file), track.cover_file && new File(coverDir, track.cover_file)]) {
      try {
        if (file && file.exists) file.delete();
      } catch {
        // Already gone.
      }
    }
    pruneEmptyFolders(track.audio_file);
    database().runSync('DELETE FROM tracks WHERE id = ?', id);
    set((s) => {
      const tracks = { ...s.tracks };
      delete tracks[id];
      return { tracks };
    });
  },

  removeAll: () => {
    queue.length = 0;
    // Documents is shared with the Files app: delete only the songs the app saved.
    for (const track of Object.values(get().tracks)) {
      try {
        const file = audioFile(track.audio_file);
        if (file.exists) file.delete();
      } catch {
        // Already gone.
      }
      pruneEmptyFolders(track.audio_file);
    }
    try {
      if (coverDir.exists) coverDir.delete();
    } catch {
      // Ignore.
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
