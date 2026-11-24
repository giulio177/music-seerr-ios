import { createAudioPlayer, createAudioPlaylist, setAudioModeAsync, type AudioPlayer, type AudioPlaylist, type AudioSource } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { create } from 'zustand';
import { absoluteUrl, albumCoverPath, api, authHeaders } from './api';
import { localAudioUri, localCoverUri, saveArtwork, streamPath, supportDir, useOffline } from './offline';
import { usePreferences } from './preferences';
import type { CatalogTrack, LibraryTrack } from './types';

export type QueueItem = {
  /** Unique per queue entry (the same song can be queued twice). */
  key: string;
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string | null;
  artistId?: string | null;
  duration: number;
  /** Absolute artwork URL (needs auth headers when it points at the server). */
  cover: string | null;
  /** Album artwork path, for songs without an image of their own. */
  coverFallback?: string | null;
  /** Local artwork file for downloaded tracks. */
  coverLocal: string | null;
  kind: 'library' | 'preview';
  library?: LibraryTrack;
  /** Original position, used to undo shuffle. */
  order: number;
  /** Jellyfin playlist the song was played from (its menu can remove it there). */
  playlistId?: string | null;
};

export type RepeatMode = 'none' | 'all' | 'single';

type PlayerState = {
  queue: QueueItem[];
  index: number;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  repeat: RepeatMode;
  shuffle: boolean;
  playTracks: (tracks: LibraryTrack[], start?: number, options?: { shuffle?: boolean; playlistId?: string | null }) => void;
  playPreview: (track: CatalogTrack) => void;
  playNext: (track: LibraryTrack) => void;
  addToQueue: (track: LibraryTrack) => void;
  removeAt: (index: number) => void;
  skipTo: (index: number) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  stop: () => void;
  /** A playlist entry was removed: its queue items no longer offer the removal. */
  forgetPlaylistEntry: (entryId: string) => void;
  /** Brings back the last session's queue, paused, so the mini player shows the last song (like Apple Music). */
  restore: () => void;
};

let playlist: AudioPlaylist | null = null;
let lockScreenActive = false;
/** Position of a restored song, applied on the first play (the native player is not loaded before). */
let pendingSeek: number | null = null;
/** A restored queue has not played yet: the first play starts the lock screen and the history entry. */
let restoredIdle = false;
let keySeq = 0;

function nextKey() {
  keySeq += 1;
  return `q${keySeq}`;
}

function fromLibrary(track: LibraryTrack, order: number, playlistId?: string | null): QueueItem {
  const offline = useOffline.getState().tracks[track.id];
  return {
    key: nextKey(),
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumId: track.album_id,
    artistId: track.artist_id,
    duration: track.duration_sec,
    cover: absoluteUrl(track.cover_url),
    coverFallback: albumCoverPath(track.album_id),
    coverLocal: offline ? localCoverUri(offline) : null,
    kind: 'library',
    library: track,
    order,
    playlistId: playlistId ?? null,
  };
}

/** Downloaded tracks play from disk; everything else streams from the server. */
function sourceFor(item: QueueItem): AudioSource {
  if (item.kind === 'preview') return { uri: item.library?.stream_url ?? '', name: item.title };
  const offline = useOffline.getState().tracks[item.id];
  if (offline) return { uri: localAudioUri(offline), name: item.title };
  return { uri: absoluteUrl(streamPath(item.library!)), headers: authHeaders(), name: item.title };
}

let audioModeReady: Promise<void> | null = null;
function ensureAudioMode() {
  audioModeReady ??= setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  }).catch(() => undefined);
  return audioModeReady;
}

function getPlaylist() {
  if (!playlist) {
    playlist = createAudioPlaylist({ loop: 'none', updateInterval: 500 });
    playlist.addListener('playlistStatusUpdate', (status) => {
      tracker.tick(status.currentTime, status.playing);
      crossfade.check(status.currentTime, status.duration, status.playing, status.isBuffering, status.currentIndex);
      usePlayer.setState({
        playing: status.playing,
        buffering: status.isBuffering,
        // A restored song reports 0 until it plays; keep showing where it stopped.
        position: pendingSeek ?? status.currentTime,
        duration: status.duration || usePlayer.getState().queue[status.currentIndex]?.duration || 0,
        index: status.currentIndex,
      });
    });
    playlist.addListener('trackChanged', ({ currentIndex }) => {
      pendingSeek = null;
      restoredIdle = false;
      usePlayer.setState({ index: currentIndex, position: 0 });
      onTrackStart();
    });
  }
  return playlist;
}

// --- Crossfade -------------------------------------------------------------

/** Starts the outgoing tail this many seconds before the fade, so the second player has loaded. */
const PRELOAD_SECONDS = 10;
const FADE_STEP_MS = 50;

/**
 * Crossfade with the single-queue native player: near the end of a song a second player loads the same
 * source, takes over its last seconds and fades out while the queue moves to the next song and fades in.
 */
const crossfade = {
  tail: null as AudioPlayer | null,
  tailKey: null as string | null,
  timer: null as ReturnType<typeof setInterval> | null,
  starting: false,

  get active() {
    return this.starting || this.timer !== null;
  },

  seconds() {
    return usePreferences.getState().prefs?.crossfade_seconds ?? 0;
  },

  /** Called on every status update of the queue player. */
  check(time: number, duration: number, playing: boolean, buffering: boolean, index: number) {
    // Paused during a fade (lock screen, headphones): stop the tail with it.
    if (this.timer !== null && !playing && !buffering) return this.dispose();
    if (this.active || !playlist) return;
    const seconds = this.seconds();
    const { queue, repeat } = usePlayer.getState();
    const item = queue[index];
    const hasNext = index < queue.length - 1 || (repeat === 'all' && queue.length > 1);
    if (!seconds || !playing || !item || item.kind !== 'library' || repeat === 'single' || !hasNext || duration < seconds * 3) {
      if (this.tail && this.tailKey !== item?.key) this.dispose();
      return;
    }
    const remaining = duration - time;
    if (remaining > seconds + PRELOAD_SECONDS) {
      if (this.tail) this.dispose();
      return;
    }
    if (this.tailKey !== item.key) {
      this.dispose();
      this.tail = createAudioPlayer(sourceFor(item), { updateInterval: 1000, keepAudioSessionActive: true });
      this.tailKey = item.key;
    }
    if (remaining <= seconds && remaining > 0.5) this.start(item.key, remaining);
  },

  async start(key: string, remaining: number) {
    const tail = this.tail;
    const pl = playlist;
    if (!tail || !pl || !tail.isLoaded) return;
    this.starting = true;
    try {
      // Seek a little ahead, then start the tail when the queue player reaches that spot.
      const target = pl.currentTime + 0.3;
      tail.volume = 1;
      await tail.seekTo(target);
      if (!this.starting || this.tail !== tail || usePlayer.getState().queue[pl.currentIndex]?.key !== key || !pl.playing) {
        this.starting = false;
        return;
      }
      const wait = (target - pl.currentTime) * 1000;
      if (wait > 0 && wait < 1000) await new Promise((resolve) => setTimeout(resolve, wait));
      if (!this.starting || this.tail !== tail) return;
      tail.play();
      pl.volume = 0;
      pl.next();
    } catch {
      this.starting = false;
      this.dispose();
      return;
    }
    this.starting = false;
    const fade = Math.max(1, remaining - 0.3) * 1000;
    const began = Date.now();
    this.timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - began) / fade);
      // Equal power: the overall loudness holds through the fade.
      tail.volume = Math.cos((progress * Math.PI) / 2);
      if (playlist) playlist.volume = Math.sin((progress * Math.PI) / 2);
      if (progress >= 1) this.dispose();
    }, FADE_STEP_MS);
  },

  /** Ends any fade at once: the queue player back at full volume, the tail stopped and released. */
  dispose() {
    this.starting = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.tail) {
      try {
        this.tail.pause();
        this.tail.remove();
      } catch {
        // Already released.
      }
    }
    this.tail = null;
    this.tailKey = null;
    if (playlist) playlist.volume = 1;
  },
};

// --- Lock screen artwork ---------------------------------------------------

const artDir = new Directory(Paths.cache, 'art');

/** Songs whose server artwork is missing; asked once per launch. */
const noArtwork = new Set<string>();

/**
 * The lock screen loads artwork without auth headers, so server covers are cached to disk first.
 */
async function artworkFor(item: QueueItem): Promise<string | undefined> {
  if (item.coverLocal) return item.coverLocal;
  if (!item.cover || noArtwork.has(item.id)) return undefined;
  if (item.kind === 'preview') return item.cover;
  try {
    if (!artDir.exists) artDir.create({ intermediates: true });
    const file = new File(artDir, `${item.id}.jpg`);
    if (!file.exists && !(await saveArtwork([item.cover, item.coverFallback], file))) {
      noArtwork.add(item.id);
      return undefined;
    }
    return file.uri;
  } catch {
    return undefined;
  }
}

async function updateLockScreen() {
  const { queue, index } = usePlayer.getState();
  const item = queue[index];
  if (!item || !playlist) return;
  const metadata = { title: item.title, artist: item.artist, albumTitle: item.album };
  if (!lockScreenActive) {
    playlist.setActiveForLockScreen(true, metadata, { showNextTrack: true, showPreviousTrack: true });
    lockScreenActive = true;
  } else {
    playlist.updateLockScreenMetadata(metadata);
  }
  const artworkUrl = await artworkFor(item);
  if (artworkUrl && usePlayer.getState().queue[usePlayer.getState().index]?.key === item.key) {
    playlist.updateLockScreenMetadata({ ...metadata, artworkUrl });
  }
}

// --- Listening history (best effort; skipped offline) ---------------------

const tracker = {
  playId: null as number | null,
  listened: 0,
  lastTime: 0,
  lastSent: 0,
  duration: 0,
  tick(time: number, playing: boolean) {
    const delta = time - this.lastTime;
    // Count heard seconds only; seeks jump more than one update interval.
    if (playing && delta > 0 && delta < 2) this.listened += delta;
    this.lastTime = time;
    if (this.playId && this.listened - this.lastSent >= 15) this.flush();
  },
  flush() {
    if (!this.playId || this.listened <= 0) return;
    this.lastSent = this.listened;
    api(`/api/history/plays/${this.playId}/progress`, {
      method: 'POST',
      body: { listened: Math.round(this.listened), duration: Math.round(this.duration) },
    }).catch(() => undefined);
  },
  async start(item: QueueItem) {
    this.flush();
    this.playId = null;
    this.listened = 0;
    this.lastSent = 0;
    this.lastTime = 0;
    this.duration = item.duration;
    const source = item.kind === 'preview' ? 'preview' : useOffline.getState().tracks[item.id] ? 'downloaded' : 'jellyfin';
    try {
      const res = await api<{ id: number | null }>('/api/history/plays', {
        method: 'POST',
        body: {
          source,
          track: {
            id: item.id,
            title: item.title,
            artist: item.artist,
            album: item.album,
            duration: item.duration,
            cover_url: item.kind === 'preview' ? item.cover : `/api/jellyfin/image/${item.id}`,
          },
        },
        timeoutMs: 6000,
      });
      this.playId = res.id;
    } catch {
      this.playId = null;
    }
  },
};

function onTrackStart() {
  const { queue, index } = usePlayer.getState();
  const item = queue[index];
  if (!item) return;
  updateLockScreen();
  tracker.start(item);
}

// --- Queue editing ---------------------------------------------------------

function load(items: QueueItem[], start: number) {
  crossfade.dispose();
  const pl = getPlaylist();
  pl.pause();
  pl.clear();
  for (const item of items) pl.add(sourceFor(item));
  usePlayer.setState({ queue: items, index: start, position: 0, duration: items[start]?.duration ?? 0 });
  ensureAudioMode().then(() => {
    pl.skipTo(start);
    pl.play();
    onTrackStart();
  });
}

/** Replaces the entries after the current one, keeping playback untouched. */
function replaceUpcoming(upcoming: QueueItem[]) {
  const pl = getPlaylist();
  const { queue, index } = usePlayer.getState();
  for (let i = queue.length - 1; i > index; i--) pl.remove(i);
  for (const item of upcoming) pl.add(sourceFor(item));
  usePlayer.setState({ queue: [...queue.slice(0, index + 1), ...upcoming] });
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  repeat: 'none',
  shuffle: false,

  playTracks: (tracks, start = 0, options) => {
    if (!tracks.length) return;
    let items = tracks.map((track, order) => fromLibrary(track, order, options?.playlistId));
    let first = Math.max(0, Math.min(start, items.length - 1));
    const shuffle = options?.shuffle ?? false;
    if (shuffle) {
      const picked = options?.shuffle && start === 0 ? Math.floor(Math.random() * items.length) : first;
      const head = items[picked];
      items = [head, ...shuffled(items.filter((_, i) => i !== picked))];
      first = 0;
    }
    set({ shuffle });
    load(items, first);
  },

  playPreview: (track) => {
    if (!track.preview_url) return;
    const item: QueueItem = {
      key: nextKey(),
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: 30,
      cover: track.cover_url ?? null,
      coverLocal: null,
      kind: 'preview',
      library: {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration_sec: 30,
        stream_url: track.preview_url,
        cover_url: track.cover_url ?? '',
      },
      order: 0,
    };
    set({ shuffle: false });
    load([item], 0);
  },

  playNext: (track) => {
    const { queue, index } = get();
    if (!queue.length) return get().playTracks([track]);
    const item = fromLibrary(track, queue.length);
    getPlaylist().insert(sourceFor(item), index + 1);
    set({ queue: [...queue.slice(0, index + 1), item, ...queue.slice(index + 1)] });
  },

  addToQueue: (track) => {
    const { queue } = get();
    if (!queue.length) return get().playTracks([track]);
    const item = fromLibrary(track, queue.length);
    getPlaylist().add(sourceFor(item));
    set({ queue: [...queue, item] });
  },

  removeAt: (i) => {
    const { queue, index } = get();
    if (i === index || i < 0 || i >= queue.length) return;
    getPlaylist().remove(i);
    set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index });
  },

  skipTo: (i) => {
    crossfade.dispose();
    const pl = getPlaylist();
    pl.skipTo(i);
    pl.play();
  },

  toggle: () => {
    const pl = getPlaylist();
    if (!get().queue.length) return;
    if (pl.playing) {
      crossfade.dispose();
      pl.pause();
      tracker.flush();
      saveSession();
    } else {
      ensureAudioMode().then(() => {
        pl.play();
        if (pendingSeek !== null) {
          // First play of a restored session: jump to where it stopped.
          pl.seekTo(pendingSeek);
          pendingSeek = null;
        }
        if (restoredIdle) {
          restoredIdle = false;
          onTrackStart();
        }
      });
    }
  },

  next: () => {
    // During a fade the queue already moved on: just finish the fade.
    if (crossfade.active) return crossfade.dispose();
    getPlaylist().next();
  },

  previous: () => {
    crossfade.dispose();
    const pl = getPlaylist();
    if (pl.currentTime > 3 || pl.currentIndex === 0) pl.seekTo(0);
    else pl.previous();
  },

  seek: (seconds) => {
    // Not loaded yet (restored, never played): remember the new spot for the first play.
    if (pendingSeek !== null) {
      pendingSeek = seconds;
      set({ position: seconds });
      return;
    }
    crossfade.dispose();
    tracker.lastTime = seconds;
    getPlaylist().seekTo(seconds);
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['none', 'all', 'single'];
    const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
    getPlaylist().loop = repeat;
    set({ repeat });
  },

  toggleShuffle: () => {
    const { queue, index, shuffle } = get();
    const upcoming = queue.slice(index + 1);
    if (upcoming.length) replaceUpcoming(shuffle ? [...upcoming].sort((a, b) => a.order - b.order) : shuffled(upcoming));
    set({ shuffle: !shuffle });
  },

  stop: () => {
    crossfade.dispose();
    tracker.flush();
    if (playlist) {
      playlist.pause();
      playlist.clear();
      playlist.clearLockScreenControls();
      lockScreenActive = false;
    }
    pendingSeek = null;
    restoredIdle = false;
    set({ queue: [], index: 0, playing: false, position: 0, duration: 0 });
  },

  forgetPlaylistEntry: (entryId) => {
    const { queue } = get();
    if (!queue.some((item) => item.playlistId && item.library?.playlist_entry_id === entryId)) return;
    set({ queue: queue.map((item) => (item.playlistId && item.library?.playlist_entry_id === entryId ? { ...item, playlistId: null } : item)) });
  },

  restore: () => {
    if (get().queue.length) return;
    const saved = readSession();
    if (!saved) return;
    let order = 0;
    const items = saved.tracks.map((track, i) => fromLibrary(track, order++, saved.playlists?.[i]));
    const index = Math.min(saved.index, items.length - 1);
    const pl = getPlaylist();
    for (const item of items) pl.add(sourceFor(item));
    pl.skipTo(index);
    pl.loop = saved.repeat;
    pendingSeek = saved.position > 0 ? saved.position : null;
    restoredIdle = true;
    set({
      queue: items,
      index,
      position: saved.position,
      duration: items[index]?.duration ?? 0,
      repeat: saved.repeat,
      shuffle: saved.shuffle,
      playing: false,
    });
  },
}));

// A song that finishes downloading while it waits in the queue switches to the local file, so it never streams.
useOffline.subscribe((state, prev) => {
  if (!playlist || state.tracks === prev.tracks) return;
  const { queue, index } = usePlayer.getState();
  for (let i = index + 1; i < queue.length; i++) {
    const item = queue[i];
    if (item.kind !== 'library' || !state.tracks[item.id] || prev.tracks[item.id]) continue;
    playlist.remove(i);
    playlist.insert(sourceFor(item), i);
  }
});

// --- Last session (restored at launch) --------------------------------------

type SavedSession = {
  tracks: LibraryTrack[];
  /** Playlist each song was played from, by position in `tracks`. */
  playlists?: (string | null)[];
  index: number;
  position: number;
  repeat: RepeatMode;
  shuffle: boolean;
};

const sessionFile = new File(supportDir, 'player.json');

/** Saves the queue of library songs (previews expire, so they are left out) and where playback is. */
function saveSession() {
  try {
    const { queue, index, position, repeat, shuffle } = usePlayer.getState();
    const current = queue[index];
    const tracks: LibraryTrack[] = [];
    const playlists: (string | null)[] = [];
    let savedIndex = 0;
    for (const item of queue) {
      if (item.kind !== 'library' || !item.library) continue;
      if (item.key === current?.key) savedIndex = tracks.length;
      tracks.push(item.library);
      playlists.push(item.playlistId ?? null);
    }
    if (!tracks.length) {
      if (sessionFile.exists) sessionFile.delete();
      return;
    }
    const session: SavedSession = {
      tracks,
      playlists,
      index: savedIndex,
      position: current?.kind === 'library' ? Math.floor(position) : 0,
      repeat,
      shuffle,
    };
    if (!supportDir.exists) supportDir.create({ intermediates: true });
    sessionFile.writeSync(JSON.stringify(session));
  } catch (error) {
    console.warn('[player] could not save the session', error);
  }
}

function readSession(): SavedSession | null {
  try {
    if (!sessionFile.exists) return null;
    const session = JSON.parse(sessionFile.textSync()) as SavedSession;
    return session.tracks?.length ? session : null;
  } catch {
    return null;
  }
}

// Save when the queue or the current song changes, and every 10 seconds of playback.
let lastSave = 0;
usePlayer.subscribe((state, prev) => {
  const now = Date.now();
  if (state.queue !== prev.queue || state.index !== prev.index || state.repeat !== prev.repeat || now - lastSave > 10000) {
    lastSave = now;
    saveSession();
  }
});

export function useCurrentItem() {
  return usePlayer((s) => s.queue[s.index]);
}
