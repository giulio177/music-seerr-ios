import { create } from 'zustand';
import { readKey, writeKey } from './keychain';

/** Beta features, switched on per iPhone in Settings > Beta. */
type BetaState = {
  /** Lyrics editor in the full player (needs the account's lyrics permission). */
  lyricsEditor: boolean;
  setLyricsEditor: (on: boolean) => void;
  load: () => Promise<void>;
};

const KEY = 'beta_lyrics_editor';

export const useBeta = create<BetaState>((set) => ({
  lyricsEditor: false,
  setLyricsEditor: (on) => {
    set({ lyricsEditor: on });
    writeKey(KEY, on ? '1' : '0').catch(() => undefined);
  },
  load: async () => {
    const value = await readKey(KEY).catch(() => null);
    if (value !== null) set({ lyricsEditor: value === '1' });
  },
}));
