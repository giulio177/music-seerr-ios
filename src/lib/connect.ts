import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { useAuth } from './auth';
import { usePreferences } from './preferences';
import { usePlayer, setRemoteSender, type PlaybackSnapshot, type QueueItem, type RemoteAction, type RepeatMode } from './player';
import type { LibraryTrack } from './types';

/**
 * Playback shared with the account's other open clients (web app tabs, other iPhones) through
 * `/api/playback/ws` (backend `services/remote_playback.py`). One device plays the audio; the others mirror
 * its state in the player and their controls send commands to it. "Play on this iPhone" claims the audio.
 *
 * Background: while a song plays the app keeps running, so the socket stays open and this iPhone stays the
 * playing device. Paused in the background, iOS suspends the app soon, so the socket is closed first and the
 * other devices can take over; it reconnects on return to the foreground.
 */

export type Device = { id: string; name: string; kind: 'web' | 'ios' };

type ServerState = {
  index: number;
  position: number;
  duration: number;
  playing: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  active: string | null;
} | null;

type ConnectState = {
  connected: boolean;
  deviceId: string | null;
  devices: Device[];
  active: string | null;
};

export const useConnect = create<ConnectState>(() => ({ connected: false, deviceId: null, devices: [], active: null }));

const DEVICE_KEY = 'playback_device_id';
const PUBLISH_EVERY_MS = 5000;

let socket: WebSocket | null = null;
let deviceId: string | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
let wanted = false;
/** A Siri or Shortcuts action keeps the socket open until then, even in the background (`connectBriefly`). */
let holdUntil = 0;
/** Waiting for the next state from the server (`connectBriefly`). */
let stateWaiters: (() => void)[] = [];
/** A state arrived since the socket opened. */
let stateReceived = false;

/** Last state from the server and when it arrived (the position moves on from there while it plays). */
let serverState: ServerState = null;
let serverQueue: (LibraryTrack & { playlist_id?: string | null })[] = [];
let receivedAt = 0;

async function loadDeviceId() {
  if (deviceId) return deviceId;
  let id = await SecureStore.getItemAsync(DEVICE_KEY).catch(() => null);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = `ios-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
    await SecureStore.setItemAsync(DEVICE_KEY, id).catch(() => undefined);
  }
  deviceId = id;
  useConnect.setState({ deviceId: id });
  return id;
}

function send(message: Record<string, unknown>) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function deviceName(id: string | null) {
  return useConnect.getState().devices.find((d) => d.id === id)?.name ?? '';
}

/** Another device holds the audio. */
export function playingElsewhere() {
  const { active, connected } = useConnect.getState();
  return connected && !!active && active !== deviceId;
}

function snapshot(): PlaybackSnapshot | null {
  if (!serverState || !serverQueue.length) return null;
  const elapsed = serverState.playing ? (Date.now() - receivedAt) / 1000 : 0;
  return {
    tracks: serverQueue,
    index: serverState.index,
    position: serverState.position + elapsed,
    playing: serverState.playing,
    repeat: serverState.repeat,
    shuffle: serverState.shuffle,
  };
}

/** A local preview plays over the mirror; the shared state comes back when it ends. */
function previewPlaying() {
  const { queue, index, playing, buffering } = usePlayer.getState();
  return queue[index]?.kind === 'preview' && (playing || buffering);
}

/** Shows the shared state: mirrored when another device plays, loaded here paused when nobody does. */
function applyServerState() {
  const snap = snapshot();
  const active = useConnect.getState().active;
  if (active === deviceId || previewPlaying()) return;
  if (active) {
    if (snap) usePlayer.getState().mirror(snap, deviceName(active));
    else usePlayer.setState({ remote: deviceName(active) });
    return;
  }
  const local = usePlayer.getState();
  if (local.playing || local.buffering) return;
  if (snap) usePlayer.getState().adopt({ ...snap, playing: false });
  else usePlayer.setState({ remote: null });
}

// --- Publishing (this iPhone plays) ---------------------------------------

let lastQueue: QueueItem[] | null = null;
let lastPublish = 0;
let lastSent = { index: -1, playing: false, repeat: '', shuffle: false, position: 0, at: 0 };

function trackOf(item: QueueItem) {
  return { ...item.library!, playlist_id: item.playlistId ?? null };
}

function publish(force = false) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const s = usePlayer.getState();
  if (s.remote !== null && !previewPlaying()) return;
  const active = useConnect.getState().active;
  const playing = s.playing || s.buffering;
  // Only the playing device describes the playback (a device starting to play takes the audio).
  if (active !== deviceId && !playing) return;
  const library = s.queue.every((item) => item.kind === 'library' && item.library);
  const message: Record<string, unknown> = {
    type: 'state',
    index: library ? s.index : 0,
    position: library ? s.position : 0,
    duration: library ? s.duration : 0,
    playing: library ? playing : false,
    repeat: s.repeat,
    shuffle: s.shuffle,
  };
  if (force || s.queue !== lastQueue) {
    message.queue = library ? s.queue.map(trackOf) : [];
    lastQueue = s.queue;
  }
  lastPublish = Date.now();
  lastSent = { index: s.index, playing, repeat: s.repeat, shuffle: s.shuffle, position: s.position, at: Date.now() };
  send(message);
}

usePlayer.subscribe((s, prev) => {
  if (!socket || s.remote !== null) return;
  const playing = s.playing || s.buffering;
  const expected = lastSent.position + (lastSent.playing ? (Date.now() - lastSent.at) / 1000 : 0);
  const changed =
    s.queue !== lastQueue ||
    s.index !== lastSent.index ||
    playing !== lastSent.playing ||
    s.repeat !== lastSent.repeat ||
    s.shuffle !== lastSent.shuffle ||
    // A seek.
    Math.abs(s.position - expected) > 2.5;
  if (changed || (playing && Date.now() - lastPublish > PUBLISH_EVERY_MS)) publish();
  // A preview over the mirror ended: show the other device again.
  if (prev.queue[prev.index]?.kind === 'preview' && (prev.playing || prev.buffering) && !playing) applyServerState();
});

// --- Mirror position ---------------------------------------------------------

let ticker: ReturnType<typeof setInterval> | null = null;

function updateTicker() {
  const run = playingElsewhere() && !!serverState?.playing;
  if (run && !ticker) {
    ticker = setInterval(() => {
      const snap = snapshot();
      const s = usePlayer.getState();
      if (!snap || s.remote === null || previewPlaying()) return;
      usePlayer.setState({ position: Math.min(snap.position, s.duration || snap.position) });
    }, 500);
  } else if (!run && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

// --- Commands from the other devices (this iPhone plays) ------------------

function runCommand(action: RemoteAction, args: Record<string, any>) {
  const player = usePlayer.getState();
  switch (action) {
    case 'play':
      if (!player.playing) player.toggle();
      break;
    case 'pause':
      if (player.playing) player.toggle();
      break;
    case 'toggle':
      player.toggle();
      break;
    case 'next':
      player.next();
      break;
    case 'previous':
      player.previous();
      break;
    case 'seek':
      player.seek(Number(args.position) || 0);
      break;
    case 'skipTo':
      player.skipTo(Number(args.index) || 0);
      break;
    case 'playTracks':
      player.playTracks(args.tracks ?? [], Number(args.index) || 0, { shuffle: !!args.shuffle, playlistId: args.playlist_id ?? null });
      break;
    case 'playNext':
      if (args.track) player.playNext(args.track);
      break;
    case 'addToQueue':
      if (args.track) player.addToQueue(args.track);
      break;
    case 'removeAt':
      player.removeAt(Number(args.index));
      break;
    case 'repeat':
      player.setRepeat(args.mode);
      break;
    case 'shuffle':
      player.setShuffle(!!args.on);
      break;
  }
}

// --- Socket ------------------------------------------------------------------

function onMessage(raw: string) {
  let message: any;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  switch (message.type) {
    case 'devices': {
      const before = useConnect.getState().active;
      useConnect.setState({ devices: message.devices ?? [], active: message.active ?? null });
      if (before !== message.active) applyServerState();
      else if (usePlayer.getState().remote !== null && message.active) usePlayer.setState({ remote: deviceName(message.active) });
      updateTicker();
      break;
    }
    case 'state':
      if (Array.isArray(message.queue)) serverQueue = message.queue;
      serverState = message.state ?? null;
      receivedAt = Date.now();
      if (serverState) useConnect.setState({ active: serverState.active ?? null });
      applyServerState();
      updateTicker();
      stateReceived = true;
      stateWaiters.splice(0).forEach((resolve) => resolve());
      break;
    case 'command':
      // Only the playing device runs commands; a late one after a hand-over is dropped.
      if (useConnect.getState().active === deviceId || usePlayer.getState().remote === null) runCommand(message.action, message.args ?? {});
      break;
    case 'no_active':
      // Nobody plays any more: run it here (this iPhone then takes the audio).
      usePlayer.setState({ remote: null });
      runCommand(message.action, message.args ?? {});
      break;
    case 'release': {
      const active = useConnect.getState().active;
      usePlayer.getState().release(deviceName(active && active !== deviceId ? active : null));
      break;
    }
    case 'welcome':
    case 'preferences':
      // Changed on another device (crossfade, accent), or possibly while this iPhone was away.
      usePreferences.getState().sync();
      break;
    case 'granted': {
      if (Array.isArray(message.queue)) serverQueue = message.queue;
      if (message.state) serverState = { ...message.state, position: message.position, active: deviceId };
      receivedAt = Date.now();
      useConnect.setState({ active: deviceId });
      updateTicker();
      const snap = snapshot();
      if (snap) {
        usePlayer.getState().takeOver(snap);
      } else {
        usePlayer.setState({ remote: null });
      }
      break;
    }
  }
}

function scheduleRetry() {
  if (!wanted || retry) return;
  retry = setTimeout(() => {
    retry = null;
    open();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30000);
}

async function open() {
  if (socket || !wanted) return;
  const { serverUrl, token } = useAuth.getState();
  if (!serverUrl || !token) return;
  const id = await loadDeviceId();
  if (socket || !wanted) return;
  const url = `${serverUrl.replace(/^http/i, 'ws')}/api/playback/ws`;
  // React Native's WebSocket takes headers as a third argument (not in the DOM typings).
  const Ctor = WebSocket as unknown as new (url: string, protocols: string[] | null, options: { headers: Record<string, string> }) => WebSocket;
  const ws = new Ctor(url, null, { headers: { Authorization: `Bearer ${token}`, 'X-Sonalis-Client': 'ios' } });
  socket = ws;
  ws.onopen = () => {
    retryDelay = 1000;
    stateReceived = false;
    useConnect.setState({ connected: true });
    const s = usePlayer.getState();
    send({ type: 'hello', device_id: id, name: 'iPhone', kind: 'ios', playing: s.remote === null && (s.playing || s.buffering) });
    lastQueue = null;
    // Still playing after a reconnect: describe the playback again.
    if (s.remote === null && (s.playing || s.buffering)) publish(true);
  };
  ws.onmessage = (event) => onMessage(String(event.data));
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    // Unreachable: actions waiting for the state go on with what this iPhone knows.
    stateWaiters.splice(0).forEach((resolve) => resolve());
    useConnect.setState({ connected: false, devices: [], active: null });
    updateTicker();
    // Without the server, controls act on this iPhone again.
    if (usePlayer.getState().remote !== null) usePlayer.setState({ remote: null, playing: false });
    scheduleRetry();
  };
  ws.onerror = () => undefined;
}

function close() {
  if (retry) clearTimeout(retry);
  retry = null;
  const ws = socket;
  socket = null;
  ws?.close();
  useConnect.setState({ connected: false, devices: [], active: null });
  updateTicker();
  if (usePlayer.getState().remote !== null) usePlayer.setState({ remote: null, playing: false });
}

function shouldConnect() {
  const { status, user, token } = useAuth.getState();
  if (status !== 'signedIn' || !token || !user || user.is_guest) return false;
  if (AppState.currentState === 'active' || Date.now() < holdUntil) return true;
  // In the background only while this iPhone plays.
  const s = usePlayer.getState();
  return s.remote === null && (s.playing || s.buffering);
}

let closing: ReturnType<typeof setTimeout> | null = null;

function sync() {
  if (closing) clearTimeout(closing);
  closing = null;
  if (shouldConnect()) {
    wanted = true;
    open();
    return;
  }
  const { status, token } = useAuth.getState();
  if (status === 'signedIn' && token && socket) {
    // Paused in the background: wait a moment (a song change also pauses briefly), then let go.
    closing = setTimeout(() => {
      closing = null;
      wanted = shouldConnect();
      if (!wanted) close();
    }, 5000);
    return;
  }
  wanted = false;
  close();
}

/**
 * Opens the socket for a moment (a Siri or Shortcuts action, maybe in the background) and waits for the shared
 * state, so the action knows which device plays and steers it. Resolves at once when already connected.
 */
export function connectBriefly(timeoutMs = 4000): Promise<void> {
  const { status, user, token } = useAuth.getState();
  if (status !== 'signedIn' || !token || !user || user.is_guest) return Promise.resolve();
  holdUntil = Date.now() + 20000;
  setTimeout(sync, 20500);
  if (socket?.readyState === WebSocket.OPEN && stateReceived) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      stateWaiters = stateWaiters.filter((waiter) => waiter !== done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    stateWaiters.push(done);
    sync();
  });
}

/** The device that plays the audio: this iPhone, another device (name and kind), or none. */
export function activeDevice(): { here: boolean; device: Device | null } {
  const { active, devices, connected } = useConnect.getState();
  if (!connected || !active) return { here: false, device: null };
  return { here: active === deviceId, device: devices.find((d) => d.id === active) ?? null };
}

/** Asks for the audio here ("Play on this iPhone"). */
export function playHere() {
  send({ type: 'claim' });
}

let started = false;

/** Starts following the session, the app state, and playback; called once at launch. */
export function startConnect() {
  if (started) return;
  started = true;
  setRemoteSender((action, args) => send({ type: 'command', action, args: args ?? {} }));
  useAuth.subscribe((s, prev) => {
    if (s.token !== prev.token || s.serverUrl !== prev.serverUrl) close();
    sync();
  });
  AppState.addEventListener('change', sync);
  // Paused in the background: let the other devices take over before iOS suspends the app.
  usePlayer.subscribe((s, prev) => {
    if ((s.playing || s.buffering) !== (prev.playing || prev.buffering) || s.remote !== prev.remote) sync();
  });
  sync();
}
