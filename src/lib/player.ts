import { createAudioPlaylist, setAudioModeAsync, type AudioPlaylist, type AudioSource } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { create } from 'zustand';
import { absoluteUrl, api, authHeaders } from './api';
import { localAudioUri, localCoverUri, streamPath, useOffline } from './offline';
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
  /** Local artwork file for downloaded tracks. */
  coverLocal: string | null;
  kind: 'library' | 'preview';
  library?: LibraryTrack;
  /** Original position, used to undo shuffle. */
  order: number;
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
  playTracks: (tracks: LibraryTrack[], start?: number, options?: { shuffle?: boolean }) => void;
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
};

let playlist: AudioPlaylist | null = null;
let lockScreenActive = false;
let keySeq = 0;

function nextKey() {
  keySeq += 1;
  return `q${keySeq}`;
}

function fromLibrary(track: LibraryTrack, order: number): QueueItem {
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
    coverLocal: offline ? localCoverUri(offline) : null,
    kind: 'library',
    library: track,
    order,
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
      usePlayer.setState({
        playing: status.playing,
        buffering: status.isBuffering,
        position: status.currentTime,
        duration: status.duration || usePlayer.getState().queue[status.currentIndex]?.duration || 0,
        index: status.currentIndex,
      });
    });
    playlist.addListener('trackChanged', ({ currentIndex }) => {
      usePlayer.setState({ index: currentIndex, position: 0 });
      onTrackStart();
    });
  }
  return playlist;
}

// --- Lock screen artwork ---------------------------------------------------

const artDir = new Directory(Paths.cache, 'art');

/** Songs whose server artwork is missing; asked once per launch. */
const noArtwork = new Set<string>();

/**
 * The lock screen loads artwork without auth headers, so server covers are cached to disk first.
 * Fetched with `fetch` (the file download API dropped the Authorization header, which the server answered with 401).
 */
async function artworkFor(item: QueueItem): Promise<string | undefined> {
  if (item.coverLocal) return item.coverLocal;
  if (!item.cover || noArtwork.has(item.id)) return undefined;
  if (item.kind === 'preview') return item.cover;
  try {
    if (!artDir.exists) artDir.create({ intermediates: true });
    const file = new File(artDir, `${item.id}.jpg`);
    if (!file.exists) {
      const res = await fetch(item.cover, { headers: authHeaders(), credentials: 'omit' });
      if (!res.ok) {
        if (res.status === 404) noArtwork.add(item.id);
        return undefined;
      }
      file.write(new Uint8Array(await res.arrayBuffer()));
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
    let items = tracks.map(fromLibrary);
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
    const pl = getPlaylist();
    pl.skipTo(i);
    pl.play();
  },

  toggle: () => {
    const pl = getPlaylist();
    if (!get().queue.length) return;
    if (pl.playing) {
      pl.pause();
      tracker.flush();
    } else {
      ensureAudioMode().then(() => pl.play());
    }
  },

  next: () => getPlaylist().next(),

  previous: () => {
    const pl = getPlaylist();
    if (pl.currentTime > 3 || pl.currentIndex === 0) pl.seekTo(0);
    else pl.previous();
  },

  seek: (seconds) => {
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
    tracker.flush();
    if (playlist) {
      playlist.pause();
      playlist.clear();
      playlist.clearLockScreenControls();
      lockScreenActive = false;
    }
    set({ queue: [], index: 0, playing: false, position: 0, duration: 0 });
  },
}));

export function useCurrentItem() {
  return usePlayer((s) => s.queue[s.index]);
}
