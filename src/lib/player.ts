import { createAudioPlayer, createAudioPlaylist, setAudioModeAsync, type AudioPlayer, type AudioPlaylist, type AudioSource } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { create } from 'zustand';
import { absoluteUrl, albumCoverPath, api, authHeaders } from './api';
import { rememberGain, useLoudness, volumeFor } from './loudness';
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
  /** Name of the device that plays the audio when it is not this iPhone (the player then mirrors it). */
  remote: string | null;
  setRepeat: (mode: RepeatMode) => void;
  setShuffle: (on: boolean) => void;
  /** Shows another device's playback; no audio here. */
  mirror: (snapshot: PlaybackSnapshot, deviceName: string) => void;
  /** No device plays: loads the shared state here, paused. */
  adopt: (snapshot: PlaybackSnapshot) => void;
  /** Takes the audio from the other device and plays from where it was. */
  takeOver: (snapshot: PlaybackSnapshot) => void;
  /** Another device took the audio: stops here. */
  release: (deviceName: string) => void;
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
  rememberGain(track);
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

/** Player volume of a queue entry: the volume stabilizer's level for library songs, full for previews. */
function itemVolume(item: QueueItem | undefined) {
  return item?.kind === 'library' ? volumeFor(item.id, item.library?.normalization_gain) : 1;
}

/** Sets the queue player to the current song's level (not during a crossfade, which ramps it itself). */
function applyVolume() {
  if (!playlist || crossfade.state !== 'idle') return;
  const volume = itemVolume(usePlayer.getState().queue[playlist.currentIndex]);
  if (Math.abs(playlist.volume - volume) > 0.001) playlist.volume = volume;
}

useLoudness.subscribe((state, previous) => {
  if (state.enabled !== previous.enabled) applyVolume();
});

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
      applyVolume();
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
      applyVolume();
      onTrackStart();
    });
  }
  return playlist;
}

// --- Crossfade -------------------------------------------------------------

/** Seconds before the fade at which the tail starts syncing (it needs time to load and line up). */
const CROSSFADE_LEAD = 8;
const TICK_MS = 40;
/** Offset under which the two players count as aligned: the swap is then inaudible. */
const ALIGNED = 0.02;

/**
 * Crossfade, same logic as the web app: a few seconds before a queue song ends, a second player starts the
 * same source muted and is aligned to the queue player with small playback rate nudges. Once aligned, the
 * players swap at once (same audio, so it is not heard): the tail carries the song's last seconds and fades
 * out while the queue moves to the next song and fades in. Lock screen, history, and lyrics follow the queue.
 */
const crossfade = {
  tail: null as AudioPlayer | null,
  state: 'idle' as 'idle' | 'syncing' | 'fading',
  key: null as string | null,
  rate: 1,
  timer: null as ReturnType<typeof setInterval> | null,
  endTimer: null as ReturnType<typeof setTimeout> | null,

  get fading() {
    return this.state === 'fading';
  },

  seconds() {
    return usePreferences.getState().prefs?.crossfade_seconds ?? 0;
  },

  nextIndex() {
    const { queue, index, repeat } = usePlayer.getState();
    if (repeat === 'single' || !queue.length) return -1;
    if (index + 1 < queue.length) return index + 1;
    return repeat === 'all' && queue.length > 1 ? 0 : -1;
  },

  /** Called on every status update of the queue player (like the web app's `timeupdate`). */
  check(time: number, duration: number, playing: boolean, buffering: boolean, index: number) {
    // Paused during a fade (lock screen, headphones): stop the tail with it.
    if (this.state === 'fading' && !playing && !buffering) return this.abort();
    if (this.state !== 'idle' || !playlist || !playing) return;
    const seconds = this.seconds();
    const item = usePlayer.getState().queue[index];
    if (!seconds || !item || item.kind !== 'library' || !duration || duration < seconds * 2 + 10) return;
    const remaining = duration - time;
    if (remaining > seconds + CROSSFADE_LEAD || remaining < seconds + 1) return;
    if (this.nextIndex() < 0) return;
    this.startSync(item);
  },

  startSync(item: QueueItem) {
    const pl = playlist!;
    this.state = 'syncing';
    this.key = item.key;
    this.rate = 1;
    const tail = createAudioPlayer(sourceFor(item), { updateInterval: 1000, keepAudioSessionActive: true });
    this.tail = tail;
    tail.volume = 0;
    tail.seekTo(pl.currentTime + 0.3, 0, 0).catch(() => undefined);
    tail.play();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  },

  tick() {
    const pl = playlist;
    const tail = this.tail;
    if (this.state !== 'syncing' || !pl || !tail) return;
    const duration = pl.duration;
    if ((!pl.playing && !pl.isBuffering) || !duration || usePlayer.getState().queue[pl.currentIndex]?.key !== this.key) return this.abort();
    const remaining = duration - pl.currentTime;
    let aligned = false;
    if (tail.isLoaded && tail.playing) {
      const offset = tail.currentTime - pl.currentTime;
      if (Math.abs(offset) > 2) {
        tail.seekTo(pl.currentTime + 0.3, 0, 0).catch(() => undefined);
        return;
      }
      aligned = Math.abs(offset) < ALIGNED;
      this.setRate(aligned ? 1 : offset > 0 ? 0.9 : 1.1);
    }
    const seconds = this.seconds();
    // Swap on time when aligned; otherwise a little late rather than not at all.
    if ((remaining <= seconds && aligned) || (remaining <= seconds - 1.5 && tail.playing)) this.swap();
    else if (remaining <= 1) this.abort();
  },

  setRate(rate: number) {
    if (!this.tail || rate === this.rate) return;
    this.rate = rate;
    this.tail.setPlaybackRate(rate);
  },

  swap() {
    const pl = playlist;
    const tail = this.tail;
    if (!pl || !tail || this.nextIndex() < 0) return this.abort();
    const fade = Math.max(1, Math.min(this.seconds(), pl.duration - pl.currentTime));
    if (this.timer !== null) clearInterval(this.timer);
    const { queue } = usePlayer.getState();
    // Each song keeps its own level (volume stabilizer) through the fade.
    const tailVolume = itemVolume(queue[pl.currentIndex]);
    const nextVolume = itemVolume(queue[this.nextIndex()]);
    this.state = 'fading';
    this.setRate(1);
    tail.volume = tailVolume;
    pl.volume = 0;
    pl.next();
    const began = Date.now();
    this.timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - began) / (fade * 1000));
      tail.volume = (1 - progress) * tailVolume;
      if (playlist) playlist.volume = progress * nextVolume;
      if (progress >= 1 && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, TICK_MS);
    this.endTimer = setTimeout(() => this.finish(), fade * 1000 + 300);
  },

  /** The fade-out has finished: the tail is released; the new song is at its own level. */
  finish() {
    if (this.state !== 'fading') return;
    this.release();
    applyVolume();
  },

  release() {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.endTimer !== null) clearTimeout(this.endTimer);
    this.timer = null;
    this.endTimer = null;
    if (this.tail) {
      try {
        this.tail.pause();
        this.tail.remove();
      } catch {
        // Already released.
      }
    }
    this.tail = null;
    this.key = null;
    this.state = 'idle';
  },

  /** Cancels a crossfade in progress (pause, seek, manual song change) and restores the song's level. */
  abort() {
    if (this.state === 'idle') return;
    this.release();
    applyVolume();
  },

  dispose() {
    this.abort();
  },
};

// --- Lock screen artwork ---------------------------------------------------

const artDir = new Directory(Paths.cache, 'art');

/** Songs whose server artwork was missing, and when: asked again after a while (new songs get it later). */
const noArtwork = new Map<string, number>();
const ARTWORK_RETRY_MS = 2 * 60 * 1000;

/**
 * The lock screen loads artwork without auth headers, so server covers are cached to disk first.
 */
async function artworkFor(item: QueueItem): Promise<string | undefined> {
  if (item.coverLocal) return item.coverLocal;
  if (!item.cover || Date.now() - (noArtwork.get(item.id) ?? 0) < ARTWORK_RETRY_MS) return undefined;
  if (item.kind === 'preview') return item.cover;
  try {
    if (!artDir.exists) artDir.create({ intermediates: true });
    const file = new File(artDir, `${item.id}.jpg`);
    if (!file.exists && !(await saveArtwork([item.cover, item.coverFallback], file))) {
      noArtwork.set(item.id, Date.now());
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

// --- Shared playback with the account's other devices (see connect.ts) ------

/** A playback state shared between devices: library songs only. */
export type PlaybackSnapshot = {
  tracks: (LibraryTrack & { playlist_id?: string | null })[];
  index: number;
  position: number;
  playing: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
};

export type RemoteAction =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'next'
  | 'previous'
  | 'seek'
  | 'skipTo'
  | 'playTracks'
  | 'playNext'
  | 'addToQueue'
  | 'removeAt'
  | 'repeat'
  | 'shuffle';

/** Sends a command to the device that plays the audio; set by connect.ts. */
let sendRemote: ((action: RemoteAction, args?: Record<string, unknown>) => void) | null = null;

export function setRemoteSender(sender: typeof sendRemote) {
  sendRemote = sender;
}

/** True while another device plays the audio: the controls here steer it (a local preview stays local). */
function remoteControlled() {
  const { remote, queue, index } = usePlayer.getState();
  return !!sendRemote && remote !== null && queue[index]?.kind !== 'preview';
}

function remote(action: RemoteAction, args?: Record<string, unknown>) {
  sendRemote?.(action, args);
}

/** The native player holds the queue (false while mirroring another device). */
let nativeLoaded = false;

/** Stops the local audio and empties the native queue; the shown state is left as it is. */
function unloadNative() {
  crossfade.dispose();
  tracker.flush();
  if (playlist) {
    playlist.pause();
    playlist.clear();
    if (lockScreenActive) playlist.clearLockScreenControls();
    lockScreenActive = false;
  }
  nativeLoaded = false;
  pendingSeek = null;
  restoredIdle = false;
}

function snapshotItems(snapshot: PlaybackSnapshot) {
  return snapshot.tracks.map((track, order) => fromLibrary(track, order, track.playlist_id));
}

function sameQueue(items: QueueItem[], tracks: LibraryTrack[]) {
  return items.length === tracks.length && items.every((item, i) => item.kind === 'library' && item.id === tracks[i].id);
}

/** Loads a queue paused at a position; the first play starts there (like a restored session). */
function loadPaused(items: QueueItem[], index: number, position: number, repeat: RepeatMode, shuffle: boolean) {
  unloadNative();
  const pl = getPlaylist();
  for (const item of items) pl.add(sourceFor(item));
  if (items.length) pl.skipTo(index);
  pl.loop = repeat;
  nativeLoaded = items.length > 0;
  pendingSeek = position > 0 ? position : null;
  restoredIdle = true;
  usePlayer.setState({
    queue: items,
    index,
    position,
    duration: items[index]?.duration ?? 0,
    repeat,
    shuffle,
    playing: false,
    buffering: false,
  });
}

// --- Queue editing ---------------------------------------------------------

function load(items: QueueItem[], start: number, startAt = 0) {
  crossfade.dispose();
  const pl = getPlaylist();
  pl.pause();
  pl.clear();
  for (const item of items) pl.add(sourceFor(item));
  nativeLoaded = items.length > 0;
  pendingSeek = null;
  restoredIdle = false;
  usePlayer.setState({ queue: items, index: start, position: startAt, duration: items[start]?.duration ?? 0, remote: null });
  ensureAudioMode().then(() => {
    pl.skipTo(start);
    pl.play();
    if (startAt > 0) pl.seekTo(startAt);
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

const REPEAT_ORDER: RepeatMode[] = ['none', 'all', 'single'];

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  repeat: 'none',
  shuffle: false,
  remote: null,

  playTracks: (tracks, start = 0, options) => {
    if (!tracks.length) return;
    if (remoteControlled()) {
      return remote('playTracks', { tracks, index: start, shuffle: !!options?.shuffle, playlist_id: options?.playlistId ?? null });
    }
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
    // A preview always plays here, even while another device plays the queue (connect.ts mirrors it again after).
    const remoteName = get().remote;
    set({ shuffle: false });
    load([item], 0);
    set({ remote: remoteName });
  },

  playNext: (track) => {
    if (remoteControlled()) return remote('playNext', { track });
    const { queue, index } = get();
    if (!queue.length) return get().playTracks([track]);
    const item = fromLibrary(track, queue.length);
    getPlaylist().insert(sourceFor(item), index + 1);
    set({ queue: [...queue.slice(0, index + 1), item, ...queue.slice(index + 1)] });
  },

  addToQueue: (track) => {
    if (remoteControlled()) return remote('addToQueue', { track });
    const { queue } = get();
    if (!queue.length) return get().playTracks([track]);
    const item = fromLibrary(track, queue.length);
    getPlaylist().add(sourceFor(item));
    set({ queue: [...queue, item] });
  },

  removeAt: (i) => {
    const { queue, index } = get();
    if (i === index || i < 0 || i >= queue.length) return;
    if (remoteControlled()) {
      // Shown at once; the other device confirms with its next state.
      set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index });
      return remote('removeAt', { index: i });
    }
    getPlaylist().remove(i);
    set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index });
  },

  skipTo: (i) => {
    if (remoteControlled()) return remote('skipTo', { index: i });
    crossfade.dispose();
    const pl = getPlaylist();
    pl.skipTo(i);
    pl.play();
  },

  toggle: () => {
    if (remoteControlled()) {
      set({ playing: !get().playing });
      return remote('toggle');
    }
    const pl = getPlaylist();
    const { queue, index, position } = get();
    if (!queue.length) return;
    if (!nativeLoaded) {
      // The shown queue came from another device that has left: play it here from the same spot.
      load(queue, index, position);
      return;
    }
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
    if (remoteControlled()) return remote('next');
    // During a fade the queue already moved on: just finish the fade.
    if (crossfade.fading) return crossfade.dispose();
    crossfade.dispose();
    getPlaylist().next();
  },

  previous: () => {
    if (remoteControlled()) return remote('previous');
    crossfade.dispose();
    const pl = getPlaylist();
    if (pl.currentTime > 3 || pl.currentIndex === 0) pl.seekTo(0);
    else pl.previous();
  },

  seek: (seconds) => {
    if (remoteControlled()) {
      set({ position: seconds });
      return remote('seek', { position: seconds });
    }
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
    const repeat = REPEAT_ORDER[(REPEAT_ORDER.indexOf(get().repeat) + 1) % REPEAT_ORDER.length];
    get().setRepeat(repeat);
  },

  setRepeat: (repeat) => {
    if (remoteControlled()) {
      set({ repeat });
      return remote('repeat', { mode: repeat });
    }
    getPlaylist().loop = repeat;
    set({ repeat });
  },

  toggleShuffle: () => get().setShuffle(!get().shuffle),

  setShuffle: (on) => {
    if (remoteControlled()) {
      set({ shuffle: on });
      return remote('shuffle', { on });
    }
    const { queue, index, shuffle } = get();
    if (on === shuffle) return;
    const upcoming = queue.slice(index + 1);
    if (upcoming.length) replaceUpcoming(shuffle ? [...upcoming].sort((a, b) => a.order - b.order) : shuffled(upcoming));
    set({ shuffle: on });
  },

  stop: () => {
    unloadNative();
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
    loadPaused(items, Math.min(saved.index, items.length - 1), saved.position, saved.repeat, saved.shuffle);
  },

  mirror: (snapshot, deviceName) => {
    // Another device plays: no audio here, the controls steer that device.
    if (nativeLoaded) unloadNative();
    const { queue } = get();
    const items = sameQueue(queue, snapshot.tracks)
      ? queue.map((item, i) => ({ ...item, playlistId: snapshot.tracks[i].playlist_id ?? null }))
      : snapshotItems(snapshot);
    const index = Math.max(0, Math.min(snapshot.index, items.length - 1));
    set({
      queue: items,
      index,
      position: snapshot.position,
      duration: items[index]?.duration ?? 0,
      playing: snapshot.playing,
      buffering: false,
      repeat: snapshot.repeat,
      shuffle: snapshot.shuffle,
      remote: deviceName,
    });
  },

  adopt: (snapshot) => {
    // Nobody plays: keep the last shared state here, paused, so play continues it on this device.
    set({ remote: null });
    const { queue, index } = get();
    if (nativeLoaded && sameQueue(queue, snapshot.tracks) && index === snapshot.index) {
      if (pendingSeek !== null || !get().playing) {
        pendingSeek = snapshot.position > 0 ? snapshot.position : null;
        set({ position: snapshot.position });
      }
      return;
    }
    loadPaused(snapshotItems(snapshot), Math.max(0, Math.min(snapshot.index, snapshot.tracks.length - 1)), snapshot.position, snapshot.repeat, snapshot.shuffle);
  },

  takeOver: (snapshot) => {
    // "Play on this iPhone": the audio moves here and continues where the other device was.
    const items = snapshotItems(snapshot);
    if (!items.length) {
      set({ remote: null });
      return;
    }
    const index = Math.max(0, Math.min(snapshot.index, items.length - 1));
    getPlaylist().loop = snapshot.repeat;
    set({ repeat: snapshot.repeat, shuffle: snapshot.shuffle });
    load(items, index, snapshot.position);
  },

  release: (deviceName) => {
    // Another device took the audio: stop here and mirror it.
    unloadNative();
    set({ remote: deviceName, playing: false, buffering: false });
  },
}));

// A song that finishes downloading while it waits in the queue switches to the local file, so it never streams.
useOffline.subscribe((state, prev) => {
  if (!playlist || !nativeLoaded || state.tracks === prev.tracks) return;
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

/** The playback time right now (the store's `position` updates only twice a second), for the lyrics editor. */
export function exactPosition() {
  const { position, remote } = usePlayer.getState();
  if (remote || !playlist) return position;
  return playlist.currentTime;
}

export function useCurrentItem() {
  return usePlayer((s) => s.queue[s.index]);
}
