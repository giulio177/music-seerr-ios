export type User = {
  id?: string;
  name: string;
  is_admin?: boolean;
  is_guest?: boolean;
};

/** A track of the Jellyfin library, as returned by the backend's `_format_track_item`. */
export type LibraryTrack = {
  id: string;
  title: string;
  artist: string;
  artist_id?: string | null;
  album: string;
  album_id?: string | null;
  duration_sec: number;
  index_number?: number | null;
  disc_number?: number | null;
  has_lyrics?: boolean;
  is_favorite?: boolean;
  path?: string;
  stream_url: string;
  cover_url: string;
};

export type Album = { id: string; name: string; artist: string; artist_id?: string | null; year?: number | null; cover_url: string };
export type Artist = { id: string; name: string; cover_url: string };
export type Playlist = { id: string; name: string; track_count?: number; cover_url?: string | null };

/** A catalog (Deezer / iTunes) search result. */
export type CatalogTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url?: string | null;
  preview_url?: string | null;
  isrc?: string | null;
  source: string;
  in_jellyfin?: boolean;
  jellyfin_id?: string | null;
};

export type DownloadJob = {
  job_id: string;
  track: CatalogTrack;
  status: 'pending' | 'downloading' | 'tagging' | 'moving' | 'jellyfin_sync' | 'completed' | 'failed' | 'interrupted' | string;
  progress: number;
  message?: string | null;
};

export type Lyrics = { found: boolean; synced?: string | null; plain?: string | null };
