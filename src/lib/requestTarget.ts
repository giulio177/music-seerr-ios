import { create } from 'zustand';

/**
 * Playlist that songs requested from the Search tab join once downloaded (like the web app's "Add to playlist"
 * selector). Null keeps them in the library only. Kept for the app session.
 */
export type RequestTarget = { id: string; name: string };

export const useRequestTarget = create<{ target: RequestTarget | null; set: (target: RequestTarget | null) => void }>((set) => ({
  target: null,
  set: (target) => set({ target }),
}));
