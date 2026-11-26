import { router } from 'expo-router';
import { File } from 'expo-file-system';
import { AppState } from 'react-native';
import { ShortcutsNative, type ShortcutRequest } from '../../modules/system-audio';
import { api, ApiError } from './api';
import { useAuth } from './auth';
import { activeDevice, connectBriefly, playHere } from './connect';
import { useDownloadQueue, isRunning } from './downloadQueue';
import { downloadedAlbums, downloadedArtists, sortDownloaded } from './downloads';
import i18n from './i18n';
import { offlineToLibrary, supportDir, useOffline, type OfflineTrack } from './offline';
import { usePlayer, type RepeatMode } from './player';
import { usePlaylists } from './playlists';
import type { Album, Artist, CatalogTrack, DownloadJob, LibraryTrack } from './types';

/**
 * Siri, Shortcuts, Control Center, and Spotlight actions (App Intents in `targets/widget/_shared`). The native
 * `IntentBridge` sends each request here; the answer is a JSON object whose `text` Siri says. Errors are thrown as
 * `ShortcutFailure` with a localized sentence.
 *
 * Pickers in Shortcuts read `shortcuts.json` (playlists, albums, artists), written here whenever they change, so
 * they work while the app is not running.
 */

class ShortcutFailure extends Error {}

type Args = Record<string, any>;
type Answer = Record<string, unknown> & { text?: string };
type Kind = 'playlist' | 'album' | 'artist';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(`shortcuts.${key}`, options ?? {});
const fail = (key: string, options?: Record<string, unknown>) => new ShortcutFailure(t(key, options));

// --- Session ----------------------------------------------------------------

/** Waits for the saved session to load (the app may have just started for this request). */
function sessionLoaded() {
  if (useAuth.getState().status !== 'loading') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const unsubscribe = useAuth.subscribe((s) => {
      if (s.status === 'loading') return;
      unsubscribe();
      resolve();
    });
  });
}

function requireAccount() {
  const { status, user } = useAuth.getState();
  if (status === 'locked') throw fail('locked');
  if (status === 'signedOut') throw fail('signIn');
  return { online: status === 'signedIn', guest: !!user?.is_guest };
}

/** Calls the server; an unreachable server becomes a sentence Siri can say. */
async function server<T>(path: string, options?: Parameters<typeof api>[1]): Promise<T> {
  if (useAuth.getState().status !== 'signedIn') throw fail('offline');
  try {
    return await api<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && error.offline) throw fail('offline');
    if (error instanceof ApiError && error.detail) throw new ShortcutFailure(error.detail);
    throw error;
  }
}

// --- Songs ------------------------------------------------------------------

function downloads() {
  return Object.values(useOffline.getState().tracks);
}

/** The downloaded songs of a playlist (in its order), album (track order), or artist. */
function downloadedOf(kind: Kind, id: string): OfflineTrack[] {
  if (kind === 'playlist') {
    const saved = usePlaylists.getState().playlists.find((p) => p.id === id);
    const tracks = useOffline.getState().tracks;
    return (saved?.track_ids ?? []).map((trackId) => tracks[trackId]).filter((tr): tr is OfflineTrack => !!tr);
  }
  const local = id.startsWith('local:') ? id.slice(6) : null;
  const matches = downloads().filter((tr) =>
    kind === 'album'
      ? local !== null
        ? `${tr.artist}|${tr.album}` === local
        : tr.album_id === id
      : local !== null
        ? tr.artist === local
        : tr.artist_id === id,
  );
  return kind === 'album' ? matches.sort((a, b) => (a.index_number ?? 0) - (b.index_number ?? 0)) : sortDownloaded(matches);
}

function catalogName(kind: Kind, id: string) {
  const list = kind === 'playlist' ? catalog.playlists : kind === 'album' ? catalog.albums : catalog.artists;
  return list.find((item) => item.id === id)?.name ?? '';
}

type Collection = { name: string; tracks: LibraryTrack[]; fromServer: boolean; offlineFallback: boolean };

/** Songs of a playlist, album, or artist: from the server, or the downloaded ones (asked for, or offline). */
async function collection(kind: Kind, id: string, downloadedOnly: boolean): Promise<Collection> {
  const local = () => downloadedOf(kind, id).map(offlineToLibrary);
  if (downloadedOnly || id.startsWith('local:') || useAuth.getState().status !== 'signedIn') {
    return { name: catalogName(kind, id), tracks: local(), fromServer: false, offlineFallback: false };
  }
  type Response = { album?: { name?: string } | null; artist?: { name?: string } | null; playlist?: { name?: string } | null; tracks: LibraryTrack[] };
  try {
    const res = await api<Response>(`/api/jellyfin/${kind}/${id}/tracks`);
    const name = res[kind]?.name || catalogName(kind, id);
    return { name, tracks: res.tracks ?? [], fromServer: true, offlineFallback: false };
  } catch (error) {
    if (error instanceof ApiError && error.offline) {
      return { name: catalogName(kind, id), tracks: local(), fromServer: false, offlineFallback: true };
    }
    throw error instanceof ApiError && error.detail ? new ShortcutFailure(error.detail) : error;
  }
}

/** Library search for a song; downloads when the server cannot be reached. */
async function findSong(query: string): Promise<LibraryTrack> {
  const q = query.trim();
  if (!q) throw fail('noSong');
  if (useAuth.getState().status === 'signedIn') {
    try {
      const res = await api<{ tracks: LibraryTrack[] }>('/api/jellyfin/library/tracks', { query: { q, limit: 5 } });
      if (res.tracks?.[0]) return res.tracks[0];
      throw fail('songNotFound', { query: q });
    } catch (error) {
      if (!(error instanceof ApiError && error.offline)) throw error;
    }
  }
  const needle = q.toLocaleLowerCase();
  const match = downloads().find((tr) => `${tr.title} ${tr.artist}`.toLocaleLowerCase().includes(needle));
  if (!match) throw fail('songNotFound', { query: q });
  return offlineToLibrary(match);
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// --- Actions ------------------------------------------------------------------

async function play(args: Args): Promise<Answer> {
  const kind = args.kind as Kind;
  const id = String(args.id);
  const downloadedOnly = !!args.downloaded;
  const result = await collection(kind, id, downloadedOnly);
  if (!result.tracks.length) throw fail(downloadedOnly || result.offlineFallback ? 'noDownloaded' : 'noSongs', { name: result.name });
  await connectBriefly();
  usePlayer.getState().playTracks(result.tracks, 0, { shuffle: !!args.shuffle, playlistId: kind === 'playlist' && result.fromServer ? id : null });
  const text = t('playing', { name: result.name, count: result.tracks.length });
  return { text: result.offlineFallback ? `${t('offlineDownloads')} ${text}` : text };
}

async function playDownloads(args: Args): Promise<Answer> {
  const tracks = sortDownloaded(downloads()).map(offlineToLibrary);
  if (!tracks.length) throw fail('noDownloads');
  await connectBriefly();
  usePlayer.getState().playTracks(tracks, 0, { shuffle: !!args.shuffle });
  return { text: t('playingDownloads', { count: tracks.length }) };
}

async function playSong(args: Args): Promise<Answer> {
  const track = await findSong(String(args.query ?? ''));
  await connectBriefly();
  usePlayer.getState().playTracks([track]);
  return { text: t('playingSong', { title: track.title, artist: track.artist }) };
}

async function playRecent(args: Args): Promise<Answer> {
  if (args.source === 'downloads') {
    const tracks = [...downloads()].sort((a, b) => b.added_at - a.added_at).slice(0, 50).map(offlineToLibrary);
    if (!tracks.length) throw fail('noDownloads');
    await connectBriefly();
    usePlayer.getState().playTracks(tracks);
    return { text: t('playingRecentDownloads', { count: tracks.length }) };
  }
  const res = await server<{ albums: Album[] }>('/api/jellyfin/albums', { query: { sort: 'recent', limit: 1 } });
  const album = res.albums?.[0];
  if (!album) throw fail('emptyLibrary');
  return play({ kind: 'album', id: album.id });
}

async function shuffleLibrary(): Promise<Answer> {
  if (useAuth.getState().status !== 'signedIn') return playDownloads({ shuffle: true });
  let tracks: LibraryTrack[] = [];
  try {
    const first = await api<{ total: number; tracks: LibraryTrack[] }>('/api/jellyfin/library/tracks', { query: { limit: 1 } });
    const total = first.total ?? 0;
    const page = 20;
    // A few random pages: a mix from the whole library without loading all of it.
    const offsets = new Set<number>();
    for (let i = 0; i < 6 && total > 0; i++) offsets.add(Math.floor((Math.random() * Math.max(1, total - page)) / page) * page);
    const pages = await Promise.all(
      [...offsets].map((offset) => api<{ tracks: LibraryTrack[] }>('/api/jellyfin/library/tracks', { query: { limit: page, offset } })),
    );
    const seen = new Set<string>();
    tracks = pages.flatMap((p) => p.tracks ?? []).filter((tr) => !seen.has(tr.id) && !!seen.add(tr.id));
  } catch (error) {
    if (error instanceof ApiError && error.offline) return playDownloads({ shuffle: true });
    throw error;
  }
  if (!tracks.length) throw fail('emptyLibrary');
  await connectBriefly();
  usePlayer.getState().playTracks(shuffled(tracks), 0, { shuffle: true });
  return { text: t('shufflingLibrary', { count: tracks.length }) };
}

async function resume(): Promise<Answer> {
  await connectBriefly();
  const player = usePlayer.getState();
  if (!player.queue.length) player.restore();
  const state = usePlayer.getState();
  const item = state.queue[state.index];
  if (!item) throw fail('nothingToResume');
  if (state.playing || state.buffering) return { text: t('alreadyPlaying', { title: item.title }) };
  state.toggle();
  return { text: t('resumed', { title: item.title, artist: item.artist }) };
}

async function control(args: Args): Promise<Answer> {
  await connectBriefly();
  const player = usePlayer.getState();
  if (!player.queue.length) player.restore();
  const state = usePlayer.getState();
  const playing = state.playing || state.buffering;
  switch (args.action) {
    case 'play':
      if (!playing) state.toggle();
      break;
    case 'pause':
      if (playing) state.toggle();
      break;
    case 'toggle':
      state.toggle();
      break;
    case 'next':
      state.next();
      break;
    case 'previous':
      state.previous();
      break;
  }
  return {};
}

async function playHereAction(): Promise<Answer> {
  await connectBriefly();
  const where = activeDevice();
  if (where.here) return { text: t('alreadyHere') };
  if (!where.device) {
    const state = usePlayer.getState();
    if (!state.queue.length) state.restore();
    const restored = usePlayer.getState();
    if (!restored.queue.length) throw fail('nothingToResume');
    if (!restored.playing) restored.toggle();
    return { text: t('playingHere') };
  }
  playHere();
  return { text: t('movedHere', { device: where.device.name }) };
}

async function setRepeat(args: Args): Promise<Answer> {
  await connectBriefly();
  const mode = (['none', 'all', 'single'].includes(args.mode) ? args.mode : 'all') as RepeatMode;
  usePlayer.getState().setRepeat(mode);
  return {};
}

async function setShuffle(args: Args): Promise<Answer> {
  await connectBriefly();
  usePlayer.getState().setShuffle(!!args.on);
  return {};
}

async function queueSong(args: Args): Promise<Answer> {
  const track = await findSong(String(args.query ?? ''));
  await connectBriefly();
  const player = usePlayer.getState();
  if (args.next) player.playNext(track);
  else player.addToQueue(track);
  return { text: t(args.next ? 'queuedNext' : 'queuedLast', { title: track.title, artist: track.artist }) };
}

async function queueAlbum(args: Args): Promise<Answer> {
  const result = await collection('album', String(args.id), false);
  if (!result.tracks.length) throw fail('noSongs', { name: result.name });
  await connectBriefly();
  const player = usePlayer.getState();
  if (args.next) {
    // Each one goes right after the current song, so insert them last to first.
    for (const track of [...result.tracks].reverse()) usePlayer.getState().playNext(track);
  } else {
    for (const track of result.tracks) player.addToQueue(track);
  }
  return { text: t(args.next ? 'albumQueuedNext' : 'albumQueuedLast', { name: result.name, count: result.tracks.length }) };
}

async function nowPlaying(): Promise<Answer> {
  await connectBriefly();
  const state = usePlayer.getState();
  const item = state.queue[state.index];
  const where = activeDevice();
  const elsewhere = !where.here && where.device ? where.device : null;
  const device = elsewhere ? elsewhere.name : t('thisIPhone');
  const playing = state.playing || state.buffering;
  if (!item) return { text: t('nothingPlaying'), title: '', artist: '', album: '', playing: false, device: '', onThisIPhone: false, onWebApp: false };
  return {
    text: t(playing ? 'nowPlaying' : 'nowPaused', { title: item.title, artist: item.artist, device }),
    title: item.title,
    artist: item.artist,
    album: item.album,
    playing,
    device,
    onThisIPhone: !elsewhere,
    onWebApp: elsewhere?.kind === 'web',
  };
}

async function requestSong(args: Args): Promise<Answer> {
  const { guest } = requireAccount();
  if (guest) throw fail('needsAccount');
  const q = String(args.query ?? '').trim();
  if (!q) throw fail('noSong');
  const res = await server<{ results: CatalogTrack[] }>('/api/search', { query: { q, limit: 10 } });
  const track = res.results?.[0];
  if (!track) throw fail('songNotFound', { query: q });
  if (track.in_jellyfin) return { text: t('alreadyInLibrary', { title: track.title, artist: track.artist }) };
  await server<DownloadJob>('/api/download', { method: 'POST', body: { track } });
  useDownloadQueue.getState().refresh();
  return { text: t('requested', { title: track.title, artist: track.artist }) };
}

async function downloadQueue(): Promise<Answer> {
  const jobs = await server<DownloadJob[]>('/api/download/jobs');
  const running = jobs.filter(isRunning);
  const failed = jobs.filter((job) => !isRunning(job));
  if (!running.length && !failed.length) return { text: t('queueEmpty') };
  const names = (list: DownloadJob[]) =>
    list
      .slice(0, 3)
      .map((job) => t('songBy', { title: job.track.title, artist: job.track.artist }))
      .join(', ');
  const parts: string[] = [];
  if (running.length) parts.push(t('queueRunning', { count: running.length, names: names(running) }));
  if (failed.length) parts.push(t('queueFailed', { count: failed.length, names: names(failed) }));
  return { text: parts.join(' ') };
}

function currentLibrarySong() {
  const { queue, index } = usePlayer.getState();
  const item = queue[index];
  if (!item) throw fail('nothingPlaying');
  if (item.kind !== 'library' || !item.library) throw fail('previewOnly');
  return item;
}

async function addToPlaylist(args: Args): Promise<Answer> {
  await connectBriefly();
  const item = currentLibrarySong();
  const id = String(args.id);
  await server(`/api/jellyfin/playlist/${id}/add-items`, { method: 'POST', body: { item_ids: [item.id] } });
  usePlaylists.getState().refresh();
  return { text: t('addedToPlaylist', { title: item.title, name: catalogName('playlist', id) }) };
}

async function downloadCurrent(): Promise<Answer> {
  await connectBriefly();
  const item = currentLibrarySong();
  if (useOffline.getState().tracks[item.id]) return { text: t('alreadyDownloaded', { title: item.title }) };
  useOffline.getState().download([item.library!]);
  return { text: t('downloadingSong', { title: item.title }) };
}

async function download(args: Args): Promise<Answer> {
  const kind = args.kind as Kind;
  const result = await collection(kind, String(args.id), false);
  if (!result.fromServer) throw fail('offline');
  const saved = useOffline.getState().tracks;
  const missing = result.tracks.filter((tr) => !saved[tr.id]);
  if (!missing.length) return { text: t('allDownloaded', { name: result.name }) };
  useOffline.getState().download(missing);
  return { text: t('downloadingCollection', { name: result.name, count: missing.length }) };
}

/** Spotlight result: show the page and play it. */
async function open(args: Args): Promise<Answer> {
  const kind = args.kind as Kind;
  const id = String(args.id);
  const reachable = useAuth.getState().status === 'signedIn' && !useAuth.getState().unreachable;
  const albumId = id.startsWith('local:') ? downloadedOf('album', id)[0]?.album_id : id;
  const path = kind === 'album' ? (albumId ? `/album/${albumId}` : null) : `/${kind}/${id}`;
  if (path) setTimeout(() => router.push(`${path}${reachable ? '' : '?downloaded=1'}`), 300);
  return play({ kind, id, downloaded: !reachable });
}

const ACTIONS: Record<string, (args: Args) => Promise<Answer>> = {
  play,
  playDownloads,
  playSong,
  playRecent,
  shuffleLibrary,
  resume,
  control,
  playHere: playHereAction,
  setRepeat,
  setShuffle,
  queueSong,
  queueAlbum,
  nowPlaying,
  requestSong,
  downloadQueue,
  addToPlaylist,
  downloadCurrent,
  download,
  open,
};

async function handle(request: ShortcutRequest) {
  const native = ShortcutsNative!;
  try {
    await sessionLoaded();
    requireAccount();
    const action = ACTIONS[request.action];
    if (!action) throw fail('unknown');
    const answer = await action(request.args ?? {});
    native.respond(request.id, JSON.stringify(answer), null);
  } catch (error) {
    const message = error instanceof ShortcutFailure ? error.message : t('failed');
    if (!(error instanceof ShortcutFailure)) console.warn('[shortcuts]', request.action, error);
    native.respond(request.id, null, message);
  }
}

// --- Catalog for pickers, Siri phrases, and Spotlight ----------------------

type Item = { id: string; name: string; subtitle?: string | null };
type LibraryCache = { albums: Pick<Album, 'id' | 'name' | 'artist'>[]; artists: Pick<Artist, 'id' | 'name'>[]; at: number };
/** What Swift reads (Entities.swift), plus the library lists behind it so they survive a launch offline. */
type Catalog = { playlists: Item[]; albums: Item[]; artists: Item[]; library?: LibraryCache };

const catalogFile = new File(supportDir, 'shortcuts.json');
let catalog: Catalog = { playlists: [], albums: [], artists: [] };
let written = '';
let library: LibraryCache = { albums: [], artists: [], at: 0 };
const LIBRARY_MAX = 3000;
const LIBRARY_REFRESH_MS = 60 * 60 * 1000;

function readCatalog() {
  try {
    if (catalogFile.exists) {
      written = catalogFile.textSync();
      catalog = JSON.parse(written) as Catalog;
      if (catalog.library) library = catalog.library;
    }
  } catch {
    written = '';
  }
}

function buildCatalog(): Catalog {
  const { status, user } = useAuth.getState();
  if (status === 'signedOut' || user?.is_guest) return { playlists: [], albums: [], artists: [] };
  const offline = useOffline.getState().tracks;
  const offlineList = Object.values(offline);
  const playlists = usePlaylists.getState().playlists.map((p) => {
    const downloaded = p.track_ids.filter((id) => offline[id]).length;
    return { id: p.id, name: p.name, subtitle: t('playlistSubtitle', { count: p.track_ids.length, downloaded }) };
  });

  const albumCounts = new Map<string, number>();
  for (const tr of offlineList) if (tr.album_id) albumCounts.set(tr.album_id, (albumCounts.get(tr.album_id) ?? 0) + 1);
  const albums: Item[] = library.albums.map((a) => {
    const downloaded = albumCounts.get(a.id) ?? 0;
    return { id: a.id, name: a.name, subtitle: downloaded ? t('withDownloaded', { name: a.artist, count: downloaded }) : a.artist };
  });
  const albumIds = new Set(albums.map((a) => a.id));
  for (const a of downloadedAlbums(offlineList)) {
    const id = a.id ?? `local:${a.key}`;
    if (!albumIds.has(id)) albums.push({ id, name: a.name, subtitle: t('withDownloaded', { name: a.artist, count: a.count }) });
  }

  const artists: Item[] = library.artists.map((a) => ({ id: a.id, name: a.name }));
  const artistIds = new Set(artists.map((a) => a.id));
  for (const a of downloadedArtists(offlineList)) {
    const id = a.id ?? `local:${a.name}`;
    if (!artistIds.has(id)) artists.push({ id, name: a.name, subtitle: t('downloadedCount', { count: a.count }) });
  }
  const byName = (x: Item, y: Item) => x.name.localeCompare(y.name);
  return { playlists: playlists.sort(byName), albums: albums.sort(byName), artists: artists.sort(byName), library };
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Rewrites `shortcuts.json` (soon, changes come in bursts) and tells the app target when it changed. */
function scheduleCatalog() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    // The session is not known yet: keep the saved catalog instead of emptying it.
    if (useAuth.getState().status === 'locked') return;
    catalog = buildCatalog();
    const json = JSON.stringify(catalog);
    if (json === written) return;
    try {
      if (!supportDir.exists) supportDir.create({ intermediates: true });
      catalogFile.writeSync(json);
      written = json;
      ShortcutsNative?.catalogChanged();
    } catch (error) {
      console.warn('[shortcuts] could not save the catalog', error);
    }
  }, 1500);
}

/** Library albums and artists for the pickers (at most once an hour). */
async function refreshLibrary(force = false) {
  const { status, user } = useAuth.getState();
  if (status !== 'signedIn' || !user || user.is_guest) return;
  if (!force && Date.now() - library.at < LIBRARY_REFRESH_MS) return;
  try {
    const page = 500;
    const albums: Album[] = [];
    const artists: Artist[] = [];
    for (let offset = 0; offset < LIBRARY_MAX; offset += page) {
      const res = await api<{ total: number; albums: Album[] }>('/api/jellyfin/albums', { query: { limit: page, offset } });
      albums.push(...(res.albums ?? []));
      if ((res.albums ?? []).length < page || albums.length >= (res.total ?? 0)) break;
    }
    for (let offset = 0; offset < LIBRARY_MAX; offset += page) {
      const res = await api<{ total: number; artists: Artist[] }>('/api/jellyfin/artists', { query: { limit: page, offset } });
      artists.push(...(res.artists ?? []));
      if ((res.artists ?? []).length < page || artists.length >= (res.total ?? 0)) break;
    }
    library = {
      albums: albums.map((a) => ({ id: a.id, name: a.name, artist: a.artist })),
      artists: artists.map((a) => ({ id: a.id, name: a.name })),
      at: Date.now(),
    };
    scheduleCatalog();
  } catch {
    // Offline: keep the saved catalog.
  }
}

let started = false;

/** Answers App Intents and keeps `shortcuts.json` current; called once at launch. */
export function startShortcuts() {
  if (started || !ShortcutsNative) return;
  started = true;
  const native = ShortcutsNative;
  readCatalog();
  native.addListener('onRequest', (request) => {
    handle(request);
  });
  native.ready();

  usePlaylists.subscribe((s, prev) => {
    if (s.playlists !== prev.playlists) scheduleCatalog();
  });
  useOffline.subscribe((s, prev) => {
    if (s.tracks !== prev.tracks) scheduleCatalog();
  });
  useAuth.subscribe((s, prev) => {
    if (s.status === prev.status && s.user === prev.user && s.unreachable === prev.unreachable) return;
    if (s.status !== prev.status || s.user?.id !== prev.user?.id) library = { albums: [], artists: [], at: 0 };
    scheduleCatalog();
    if (!s.unreachable) refreshLibrary();
  });
  i18n.on('languageChanged', () => scheduleCatalog());
  AppState.addEventListener('change', (state) => {
    if (state === 'active') refreshLibrary();
  });
  sessionLoaded().then(() => {
    scheduleCatalog();
    refreshLibrary(true);
  });
}
