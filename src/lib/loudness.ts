import { File } from 'expo-file-system';
import { create } from 'zustand';
import { readKey, writeKey } from './keychain';
import { supportDir } from './offline';
import type { LibraryTrack } from './types';

/**
 * Volume stabilizer (Settings > Playback, per iPhone). Jellyfin's Audio Normalization task measures every song and
 * reports `normalization_gain`: the dB that bring it to -18 LUFS. The player cannot go above full volume, so songs are
 * played at `REFERENCE_GAIN` relative loudness: louder songs are turned down to it, quieter ones stay at full volume.
 * With the stabilizer on the whole library plays a little lower, so the iPhone volume is raised once.
 */
const REFERENCE_GAIN = -4;
/** Songs Jellyfin has not measured yet: the library median, so they sit with the rest. */
const UNKNOWN_GAIN = -9;
const KEY = 'volume_normalization';
/** Created on first use: `offline.ts` imports this module, so `supportDir` is not ready at load time. */
const gainsFile = () => new File(supportDir, 'loudness.json');

type LoudnessState = {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  load: () => Promise<void>;
};

export const useLoudness = create<LoudnessState>((set) => ({
  enabled: false,
  setEnabled: (on) => {
    set({ enabled: on });
    writeKey(KEY, on ? '1' : '0').catch(() => undefined);
  },
  load: async () => {
    const value = await readKey(KEY).catch(() => null);
    if (value !== null) set({ enabled: value === '1' });
  },
}));

/** Gains seen online, kept so downloaded songs keep their level offline. */
let gains: Record<string, number> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function known() {
  if (!gains) {
    try {
      const file = gainsFile();
      gains = file.exists ? (JSON.parse(file.textSync()) as Record<string, number>) : {};
    } catch {
      gains = {};
    }
  }
  return gains;
}

/** Remembers the gain of library songs as they are played or downloaded. */
export function rememberGain(track: LibraryTrack) {
  const gain = track.normalization_gain;
  if (typeof gain !== 'number' || !Number.isFinite(gain)) return;
  const map = known();
  if (map[track.id] === gain) return;
  map[track.id] = gain;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!supportDir.exists) supportDir.create({ intermediates: true });
      gainsFile().writeSync(JSON.stringify(map));
    } catch (error) {
      console.warn('[loudness] could not save', error);
    }
  }, 2000);
}

/** Player volume (0 to 1) for a song: 1 with the stabilizer off. */
export function volumeFor(id: string | undefined, gain?: number | null) {
  if (!useLoudness.getState().enabled || !id) return 1;
  const db = typeof gain === 'number' && Number.isFinite(gain) ? gain : (known()[id] ?? UNKNOWN_GAIN);
  return Math.max(0.05, Math.min(1, Math.pow(10, (db - REFERENCE_GAIN) / 20)));
}
