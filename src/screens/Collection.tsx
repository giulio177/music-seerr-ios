import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Cover } from '@/components/Cover';
import { Symbol } from '@/components/Symbol';
import { MissingRow, type ReleaseTrack } from '@/components/MissingRow';
import { Shelf, TileRow, type TileItem } from '@/components/Shelf';
import { TrackRow } from '@/components/TrackRow';
import { AccentButton, ErrorState, Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { localCoverUri, offlineToLibrary, useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { usePlaylists } from '@/lib/playlists';
import { useRequests } from '@/lib/requests';
import { colors, useAccent, withAlpha } from '@/lib/theme';
import type { LibraryTrack } from '@/lib/types';
import { useApi } from '@/lib/useApi';

type Kind = 'album' | 'artist' | 'playlist';
type Info = { id?: string; name?: string; artist?: string; artist_id?: string | null; year?: number | null; cover_url?: string };
type Response = { album?: Info | null; artist?: Info | null; playlist?: Info | null; tracks: LibraryTrack[] };
type Release = { id: string; title: string; cover_url?: string | null; year?: string | null; record_type: string };
type Row = { type: 'track'; track: LibraryTrack; index: number } | { type: 'missing'; track: ReleaseTrack } | { type: 'songsTitle' };

const PATHS: Record<Kind, (id: string) => string> = {
  album: (id) => `/api/jellyfin/album/${id}/tracks`,
  artist: (id) => `/api/jellyfin/artist/${id}/tracks`,
  playlist: (id) => `/api/jellyfin/playlist/${id}/tracks`,
};

/**
 * Album, artist, and playlist pages.
 * - Albums list the release's songs missing from the library in their place, dimmed (preview and request them).
 * - Artists show their library albums and the releases the library lacks, then every song.
 * - `downloaded` (from the Downloads tab) and offline: only the downloaded songs (playlists in their order, from `usePlaylists`).
 */
export function CollectionScreen({ kind, id, downloaded }: { kind: Kind; id: string; downloaded?: boolean }) {
  const { t } = useTranslation();
  const unreachable = useAuth((s) => s.unreachable);
  const localOnly = !!downloaded;
  const { data, error, loading, refreshing, refresh, reload } = useApi<Response>(localOnly ? null : PATHS[kind](id));
  const revision = usePlaylists((s) => (kind === 'playlist' ? (s.revisions[id] ?? 0) : 0));
  const catalogPath = !localOnly && !unreachable && data && kind !== 'playlist' ? `/api/jellyfin/${kind}/${id}/catalog` : null;
  const catalog = useApi<{ missing?: ReleaseTrack[]; releases?: Release[] }>(catalogPath);
  const savedTracks = useOffline((s) => s.tracks);
  const savedPlaylist = usePlaylists((s) => (kind === 'playlist' ? s.playlists.find((p) => p.id === id) : undefined));
  const active = useOffline((s) => s.active);
  const { jobs, request, requestAll } = useRequests();
  const { accent } = useAccent();

  const local = useMemo(() => {
    if (!localOnly && !error?.offline) return null;
    if (kind === 'playlist') {
      // Playlist order, downloaded songs only (the playlist itself is remembered from the last online check).
      const songs = (savedPlaylist?.track_ids ?? []).flatMap((trackId) => (savedTracks[trackId] ? [savedTracks[trackId]] : []));
      return songs.length ? { tracks: songs.map(offlineToLibrary), info: { name: savedPlaylist!.name } as Info } : null;
    }
    const rows = Object.values(savedTracks).filter((tr) => (kind === 'album' ? tr.album_id === id : kind === 'artist' ? tr.artist_id === id : false));
    if (!rows.length) return null;
    rows.sort((a, b) => a.album.localeCompare(b.album) || (a.index_number ?? 0) - (b.index_number ?? 0));
    const info: Info = kind === 'album' ? { name: rows[0].album, artist: rows[0].artist, artist_id: rows[0].artist_id } : { name: rows[0].artist };
    return { tracks: rows.map(offlineToLibrary), info };
  }, [localOnly, error, savedTracks, savedPlaylist, kind, id]);

  // A song removed from this playlist (here or in the player) reloads the page.
  useEffect(() => {
    if (revision) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  useEffect(() => {
    if (kind === 'playlist' && data?.playlist?.name) {
      usePlaylists.getState().remember({ id, name: data.playlist.name, cover_url: data.playlist.cover_url, track_ids: data.tracks.map((tr) => tr.id) });
    }
  }, [kind, id, data]);

  const info: Info | null | undefined = local?.info ?? (data ? data[kind] : null);
  const tracks = useMemo(() => local?.tracks ?? data?.tracks ?? [], [local, data]);
  const missing = useMemo(() => (local ? [] : (catalog.data?.missing ?? [])), [local, catalog.data]);
  const pendingMissing = missing.filter((tr) => !tr.in_jellyfin && !jobs[tr.id]);

  const albums = useMemo<TileItem[]>(() => {
    if (kind !== 'artist') return [];
    const seen = new Map<string, TileItem & { count: number }>();
    for (const tr of tracks) {
      const key = tr.album_id || tr.album;
      if (!key) continue;
      const album = seen.get(key);
      if (album) album.count += 1;
      else
        seen.set(key, {
          key,
          title: tr.album,
          cover: tr.album_id ? `/api/jellyfin/image/${tr.album_id}` : tr.cover_url,
          count: 1,
          onPress: () => tr.album_id && router.push(`/album/${tr.album_id}${local ? '?downloaded=1' : ''}`),
        });
    }
    return [...seen.values()].map((album) => ({ ...album, sub: t('common.tracks', { count: album.count }) }));
  }, [kind, tracks, local, t]);

  const releases = useMemo<TileItem[]>(
    () =>
      (local ? [] : (catalog.data?.releases ?? [])).map((release) => ({
        key: release.id,
        title: release.title,
        sub: release.year ?? undefined,
        cover: release.cover_url,
        badge: release.record_type === 'single' ? t('detail.single') : release.record_type === 'ep' ? t('detail.ep') : undefined,
        onPress: () => router.push(`/catalog/${encodeURIComponent(release.id)}`),
      })),
    [local, catalog.data, t],
  );

  // Missing album songs take their place in the track order (disc, then number), like the web app.
  const rows = useMemo<Row[]>(() => {
    const own: Row[] = tracks.map((track, index) => ({ type: 'track', track, index }));
    if (kind === 'artist') return albums.length || releases.length ? [{ type: 'songsTitle' }, ...own] : own;
    if (kind !== 'album' || !missing.length) return own;
    const keyed = [
      ...own.map((row, order) => {
        const tr = (row as { track: LibraryTrack }).track;
        return { row, disc: tr.disc_number || 1, number: tr.index_number || order + 1, order };
      }),
      ...missing.map((tr, i) => ({ row: { type: 'missing', track: tr } as Row, disc: tr.disc_number || 1, number: tr.track_number || 999, order: 10000 + i })),
    ];
    keyed.sort((a, b) => a.disc - b.disc || a.number - b.number || a.order - b.order);
    return keyed.map((k) => k.row);
  }, [tracks, missing, kind, albums.length, releases.length]);

  const savedCount = tracks.filter((tr) => savedTracks[tr.id]).length;
  const pending = tracks.filter((tr) => active[tr.id] !== undefined && active[tr.id] !== 'error').length;
  const allSaved = tracks.length > 0 && savedCount === tracks.length;

  const editablePlaylist = kind === 'playlist' && !local ? id : null;
  const play = (index: number, shuffle = false) => usePlayer.getState().playTracks(tracks, index, { shuffle, playlistId: editablePlaylist });

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ title: '', headerLargeTitle: false }} />
        <Loading />
      </View>
    );
  }
  if ((error || localOnly) && !local) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ title: '', headerLargeTitle: false }} />
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
      </View>
    );
  }

  const firstSaved = (kind === 'album' || (kind === 'playlist' && local)) && tracks[0] ? savedTracks[tracks[0].id] : undefined;
  const headerLocal = firstSaved ? localCoverUri(firstSaved) : null;
  const coverPath = info?.cover_url ?? (kind !== 'artist' ? `/api/jellyfin/image/${id}` : undefined);
  const subtitle =
    kind === 'album'
      ? [info?.artist, info?.year].filter(Boolean).join(' · ')
      : kind === 'artist' && albums.length
        ? `${t('detail.albums', { count: albums.length })} · ${t('common.tracks', { count: tracks.length })}`
        : t('common.tracks', { count: tracks.length });

  const header = (
    <View>
      <View style={styles.header}>
        <Cover path={coverPath} local={headerLocal} size={230} round={kind === 'artist'} shadow />
        <Text style={styles.title}>{info?.name}</Text>
        {kind === 'album' && info?.artist_id ? (
          <Pressable onPress={() => router.push(`/artist/${info.artist_id}${local ? '?downloaded=1' : ''}`)}>
            <Text style={[styles.subtitle, { color: accent }]}>{subtitle}</Text>
          </Pressable>
        ) : (
          <Text style={styles.subtitle}>{subtitle}</Text>
        )}
        {local ? (
          <View style={[styles.partial, { borderColor: withAlpha(accent, 0.35), backgroundColor: withAlpha(accent, 0.1) }]}>
            <View style={styles.partialInfo}>
              <Symbol name="arrow.down.circle.fill" fallback="arrow-down-circle" size={18} color={accent} />
              <Text style={styles.partialText} numberOfLines={2}>
                {kind === 'playlist' && savedPlaylist
                  ? t('detail.downloadedOnlyOf', { count: tracks.length, total: savedPlaylist.track_ids.length })
                  : t('detail.downloadedOnly')}
              </Text>
            </View>
            {unreachable ? null : (
              <Pressable
                onPress={() => router.push(`/${kind}/${id}`)}
                hitSlop={6}
                style={({ pressed }) => [styles.partialLink, pressed && { opacity: 0.6 }]}
                accessibilityRole="link"
              >
                <Text style={[styles.partialLinkText, { color: accent }]}>{t(`detail.showFull.${kind}`)}</Text>
                <Symbol name="chevron.right" fallback="chevron-forward" size={12} color={accent} />
              </Pressable>
            )}
          </View>
        ) : null}
        <View style={styles.actions}>
          <AccentButton label={t('common.play')} icon="play" onPress={() => play(0)} style={{ flex: 1 }} disabled={!tracks.length} />
          <AccentButton label={t('common.shuffle')} icon="shuffle" variant="glass" onPress={() => play(0, true)} style={{ flex: 1 }} disabled={!tracks.length} />
        </View>
        <View style={styles.links}>
          {local ? null : (
            <Pressable disabled={allSaved || pending > 0 || !tracks.length} onPress={() => useOffline.getState().download(tracks)} style={styles.link}>
              <Ionicons name={allSaved ? 'checkmark-circle' : 'arrow-down-circle-outline'} size={20} color={allSaved ? accent : colors.textSecondary} />
              <Text style={styles.linkLabel}>
                {allSaved
                  ? t('detail.downloaded')
                  : pending > 0
                    ? t('detail.downloading', { done: savedCount, total: tracks.length })
                    : t('detail.downloadAll')}
              </Text>
            </Pressable>
          )}
          {pendingMissing.length ? (
            <Pressable onPress={() => requestAll(pendingMissing)} style={styles.link}>
              <Ionicons name="add-circle-outline" size={20} color={accent} />
              <Text style={[styles.linkLabel, { color: accent }]}>{t('detail.requestMissing', { count: pendingMissing.length })}</Text>
            </Pressable>
          ) : null}
        </View>
        {kind === 'album' && catalog.loading ? (
          <View style={styles.searching}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.searchingText}>{t('detail.searchingCatalog')}</Text>
          </View>
        ) : null}
      </View>
      {albums.length ? (
        <Shelf title={t('library.albums')} count={albums.length}>
          <TileRow items={albums} />
        </Shelf>
      ) : null}
      {releases.length ? (
        <Shelf title={t('detail.notInLibraryTitle')} count={releases.length}>
          <TileRow items={releases} />
        </Shelf>
      ) : kind === 'artist' && catalog.loading ? (
        <View style={styles.searching}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={styles.searchingText}>{t('detail.searchingReleases')}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: info?.name ?? '', headerLargeTitle: false }} />
      <FlatList
        data={rows}
        keyExtractor={(row, index) => (row.type === 'songsTitle' ? 'songs' : `${row.type}:${row.track.id}:${index}`)}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          local ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                await Promise.all([refresh(), catalog.refresh()]);
              }}
              tintColor={colors.textSecondary}
            />
          )
        }
        ListHeaderComponent={header}
        renderItem={({ item: row }) =>
          row.type === 'songsTitle' ? (
            <Text style={styles.sectionTitle}>{t('library.songs')}</Text>
          ) : row.type === 'missing' ? (
            <MissingRow track={row.track} job={jobs[row.track.id]} onRequest={() => request(row.track)} />
          ) : (
            <TrackRow track={row.track} showNumber={kind === 'album'} playlistId={editablePlaylist} onPress={() => play(row.index)} />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 18 },
  subtitle: { color: colors.textSecondary, fontSize: 16, marginTop: 4, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginTop: 18 },
  partial: { alignSelf: 'stretch', marginTop: 16, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  partialInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  partialText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '500' },
  partialLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 26 },
  partialLinkText: { fontSize: 14, fontWeight: '600' },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 20, marginTop: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  linkLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  searching: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 },
  searchingText: { color: colors.textSecondary, fontSize: 13 },
  sectionTitle: { color: colors.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, marginTop: 18, marginBottom: 6 },
});
