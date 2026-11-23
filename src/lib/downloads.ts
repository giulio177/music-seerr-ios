import { localCoverUri, type OfflineTrack } from './offline';

export type DownloadedAlbum = {
  key: string;
  id: string | null;
  name: string;
  artist: string;
  cover: string | null;
  count: number;
  /** Newest download of the album (ms), for Recently Downloaded. */
  addedAt: number;
};

export type DownloadedArtist = { key: string; id: string | null; name: string; cover: string | null; count: number };

/** Downloaded songs grouped by album, newest download first. */
export function downloadedAlbums(tracks: OfflineTrack[]): DownloadedAlbum[] {
  const albums = new Map<string, DownloadedAlbum>();
  for (const track of tracks) {
    const key = track.album_id || `${track.artist}|${track.album}`;
    const album = albums.get(key);
    if (album) {
      album.count += 1;
      album.addedAt = Math.max(album.addedAt, track.added_at);
      album.cover ??= localCoverUri(track);
    } else {
      albums.set(key, {
        key,
        id: track.album_id,
        name: track.album,
        artist: track.artist,
        cover: localCoverUri(track),
        count: 1,
        addedAt: track.added_at,
      });
    }
  }
  return [...albums.values()].sort((a, b) => b.addedAt - a.addedAt);
}

/** Downloaded songs grouped by artist, by name. */
export function downloadedArtists(tracks: OfflineTrack[]): DownloadedArtist[] {
  const artists = new Map<string, DownloadedArtist>();
  for (const track of tracks) {
    const key = track.artist_id || track.artist;
    const artist = artists.get(key);
    if (artist) {
      artist.count += 1;
      artist.cover ??= localCoverUri(track);
    } else {
      artists.set(key, { key, id: track.artist_id, name: track.artist, cover: localCoverUri(track), count: 1 });
    }
  }
  return [...artists.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Downloaded songs in library order: artist, album, track number. */
export function sortDownloaded(tracks: OfflineTrack[]) {
  return [...tracks].sort(
    (a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || (a.index_number ?? 0) - (b.index_number ?? 0),
  );
}
