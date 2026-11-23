import type { TFunction } from 'i18next';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Cover } from '@/components/Cover';
import { Tile } from '@/components/Shelf';
import { TrackRow } from '@/components/TrackRow';
import { AccentButton, EmptyState, ErrorState, Loading } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { downloadedAlbums, downloadedArtists, sortDownloaded } from '@/lib/downloads';
import { offlineToLibrary, useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { colors } from '@/lib/theme';
import type { Album, Artist, LibraryTrack, Playlist } from '@/lib/types';

type Kind = 'playlists' | 'artists' | 'albums' | 'songs';
type Entry = {
  key: string;
  title: string;
  sub?: string;
  cover?: string | null;
  local?: string | null;
  track?: LibraryTrack;
  open?: () => void;
};
const PAGE = 100;
const KINDS: Kind[] = ['playlists', 'artists', 'albums', 'songs'];

async function fetchPage(kind: Kind, offset: number, q: string, t: TFunction): Promise<{ items: Entry[]; total: number }> {
  if (kind === 'playlists') {
    const list = await api<Playlist[]>('/api/jellyfin/playlists');
    const filtered = q ? list.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : list;
    return {
      items: filtered.map((p) => ({
        key: p.id,
        title: p.name,
        sub: t('common.tracks', { count: p.track_count ?? 0 }),
        cover: p.cover_url ?? `/api/jellyfin/image/${p.id}`,
        open: () => router.push(`/playlist/${p.id}`),
      })),
      total: filtered.length,
    };
  }
  if (kind === 'albums') {
    const res = await api<{ total: number; albums: Album[] }>('/api/jellyfin/albums', { query: { q, limit: PAGE, offset } });
    return {
      items: res.albums.map((a) => ({ key: a.id, title: a.name, sub: a.artist, cover: a.cover_url, open: () => router.push(`/album/${a.id}`) })),
      total: res.total,
    };
  }
  if (kind === 'artists') {
    const res = await api<{ total: number; artists: Artist[] }>('/api/jellyfin/artists', { query: { q, limit: PAGE, offset } });
    return {
      items: res.artists.map((a) => ({ key: a.id, title: a.name, cover: a.cover_url, open: () => router.push(`/artist/${a.id}`) })),
      total: res.total,
    };
  }
  const res = await api<{ total: number; tracks: LibraryTrack[] }>('/api/jellyfin/library/tracks', { query: { q, limit: PAGE, offset } });
  return { items: res.tracks.map((tr) => ({ key: tr.id, title: tr.title, track: tr })), total: res.total };
}

/**
 * Playlists, Artists, Albums, or Songs of the library (`source` unset) or of the downloads (`source=downloads`),
 * with a search field in the navigation bar. Downloaded songs can be narrowed to one artist or album by name.
 */
export default function Browse() {
  const params = useLocalSearchParams<{ kind: string; source?: string; artist?: string; album?: string }>();
  const kind: Kind = KINDS.includes(params.kind as Kind) ? (params.kind as Kind) : 'songs';
  const downloads = params.source === 'downloads';
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const title = params.album || params.artist || t(`library.${kind}`);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title,
          headerLargeTitle: !params.album && !params.artist,
          headerSearchBarOptions: {
            placeholder: t('library.filter'),
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            hideWhenScrolling: true,
            autoCapitalize: 'none',
          },
        }}
      />
      {downloads ? (
        <DownloadedList kind={kind} query={query.trim()} artist={params.artist} album={params.album} />
      ) : (
        <ServerList kind={kind} query={query.trim()} />
      )}
    </View>
  );
}

function ServerList({ kind, query }: { kind: Kind; query: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (mode: 'reset' | 'refresh' | 'more', offset = 0) => {
      const id = ++seq.current;
      if (mode === 'reset') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const page = await fetchPage(kind, offset, query, t);
        if (id !== seq.current) return;
        setItems((prev) => (mode === 'more' ? [...prev, ...page.items] : page.items));
        setTotal(page.total);
        setError(null);
      } catch (e) {
        if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(500, String(e)));
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [kind, query, t],
  );

  useEffect(() => {
    const timer = setTimeout(() => load('reset'), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  if (loading && !items.length) return <Loading />;
  if (error && !items.length) return <ErrorState error={error} onRetry={() => load('reset')} />;

  return (
    <EntryList
      kind={kind}
      items={items}
      refreshing={refreshing}
      onRefresh={() => load('refresh')}
      onEndReached={() => {
        if (!loading && kind !== 'playlists' && items.length < total) load('more', items.length);
      }}
    />
  );
}

function DownloadedList({ kind, query, artist, album }: { kind: Kind; query: string; artist?: string; album?: string }) {
  const { t } = useTranslation();
  const saved = useOffline((s) => s.tracks);
  const items = useMemo(() => {
    const q = query.toLowerCase();
    const match = (...values: (string | null | undefined)[]) => !q || values.some((v) => v?.toLowerCase().includes(q));
    let tracks = Object.values(saved);
    if (artist) tracks = tracks.filter((tr) => tr.artist === artist);
    if (album) tracks = tracks.filter((tr) => tr.album === album);
    if (kind === 'artists') {
      return downloadedArtists(tracks)
        .filter((a) => match(a.name))
        .map<Entry>((a) => ({
          key: a.key,
          title: a.name,
          local: a.cover,
          sub: t('common.tracks', { count: a.count }),
          open: () =>
            router.push(a.id ? `/artist/${a.id}?downloaded=1` : `/browse/songs?source=downloads&artist=${encodeURIComponent(a.name)}`),
        }));
    }
    if (kind === 'albums') {
      return downloadedAlbums(tracks)
        .filter((a) => match(a.name, a.artist))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map<Entry>((a) => ({
          key: a.key,
          title: a.name,
          sub: a.artist,
          local: a.cover,
          open: () =>
            router.push(a.id ? `/album/${a.id}?downloaded=1` : `/browse/songs?source=downloads&album=${encodeURIComponent(a.name)}`),
        }));
    }
    return sortDownloaded(tracks)
      .filter((tr) => match(tr.title, tr.artist, tr.album))
      .map<Entry>((tr) => ({ key: tr.id, title: tr.title, track: offlineToLibrary(tr) }));
  }, [saved, kind, query, artist, album, t]);

  if (!items.length) return <EmptyState icon="arrow-down-circle-outline" body={t(query ? 'search.noResults' : 'offline.empty')} />;
  return <EntryList kind={kind} items={items} />;
}

function EntryList({
  kind,
  items,
  refreshing,
  onRefresh,
  onEndReached,
}: {
  kind: Kind;
  items: Entry[];
  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const tile = (width - 16 * 3) / 2;
  const grid = kind === 'albums';
  const tracks = useMemo(() => items.flatMap((item) => (item.track ? [item.track] : [])), [items]);

  return (
    <FlatList
      key={grid ? 'grid' : 'list'}
      data={items}
      numColumns={grid ? 2 : 1}
      keyExtractor={(item) => item.key}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      columnWrapperStyle={grid ? { gap: 16, paddingHorizontal: 16 } : undefined}
      contentContainerStyle={{ paddingBottom: 140, gap: grid ? 18 : 0, paddingTop: grid ? 8 : 0 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} /> : undefined}
      onEndReachedThreshold={0.6}
      onEndReached={onEndReached}
      ListHeaderComponent={
        kind === 'songs' && tracks.length ? (
          <View style={styles.actions}>
            <AccentButton label={t('common.play')} icon="play" onPress={() => usePlayer.getState().playTracks(tracks)} style={{ flex: 1 }} />
            <AccentButton
              label={t('common.shuffle')}
              icon="shuffle"
              variant="glass"
              onPress={() => usePlayer.getState().playTracks(tracks, 0, { shuffle: true })}
              style={{ flex: 1 }}
            />
          </View>
        ) : undefined
      }
      renderItem={({ item, index }) => {
        if (item.track) return <TrackRow track={item.track} onPress={() => usePlayer.getState().playTracks(tracks, index)} />;
        if (grid) return <Tile item={{ key: item.key, title: item.title, sub: item.sub, cover: item.cover, local: item.local, onPress: item.open! }} size={tile} />;
        return (
          <Pressable onPress={item.open} style={({ pressed }) => [styles.row, pressed && { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
            <Cover path={item.cover} local={item.local} size={kind === 'artists' ? 52 : 56} round={kind === 'artists'} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.name}>
                {item.title}
              </Text>
              {item.sub ? (
                <Text numberOfLines={1} style={styles.sub}>
                  {item.sub}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 7 },
  name: { color: colors.text, fontSize: 17, fontWeight: '500' },
  sub: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
});
