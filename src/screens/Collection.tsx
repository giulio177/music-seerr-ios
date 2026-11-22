import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Cover } from '@/components/Cover';
import { TrackRow } from '@/components/TrackRow';
import { AccentButton, Backdrop, ErrorState, Loading } from '@/components/ui';
import { offlineToLibrary, useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { colors, useAccent } from '@/lib/theme';
import type { LibraryTrack } from '@/lib/types';
import { useApi } from '@/lib/useApi';

type Kind = 'album' | 'artist' | 'playlist';
type Info = { id?: string; name?: string; artist?: string; artist_id?: string | null; year?: number | null; cover_url?: string };
type Response = { album?: Info | null; artist?: Info | null; playlist?: Info | null; tracks: LibraryTrack[] };

const PATHS: Record<Kind, (id: string) => string> = {
  album: (id) => `/api/jellyfin/album/${id}/tracks`,
  artist: (id) => `/api/jellyfin/artist/${id}/tracks`,
  playlist: (id) => `/api/jellyfin/playlist/${id}/tracks`,
};

/** Album, artist, and playlist pages. Offline, albums and artists fall back to their downloaded songs. */
export function CollectionScreen({ kind, id }: { kind: Kind; id: string }) {
  const { t } = useTranslation();
  const { data, error, loading, refreshing, refresh, reload } = useApi<Response>(PATHS[kind](id));
  const savedTracks = useOffline((s) => s.tracks);
  const active = useOffline((s) => s.active);
  const { accent } = useAccent();

  const fallback = useMemo(() => {
    if (!error?.offline) return null;
    const rows = Object.values(savedTracks).filter((tr) => (kind === 'album' ? tr.album_id === id : kind === 'artist' ? tr.artist_id === id : false));
    if (!rows.length) return null;
    rows.sort((a, b) => (a.index_number ?? 0) - (b.index_number ?? 0));
    const tracks = rows.map(offlineToLibrary);
    const info: Info = kind === 'album' ? { name: rows[0].album, artist: rows[0].artist } : { name: rows[0].artist };
    return { tracks, info };
  }, [error, savedTracks, kind, id]);

  const info: Info | null | undefined = fallback?.info ?? (data ? data[kind] : null);
  const tracks = fallback?.tracks ?? data?.tracks ?? [];
  const isAlbum = kind === 'album';

  const savedCount = tracks.filter((tr) => savedTracks[tr.id]).length;
  const pending = tracks.filter((tr) => active[tr.id] !== undefined && active[tr.id] !== 'error').length;
  const allSaved = tracks.length > 0 && savedCount === tracks.length;

  const play = (index: number, shuffle = false) => usePlayer.getState().playTracks(tracks, index, { shuffle });

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <Backdrop />
        <Stack.Screen options={{ title: '', headerLargeTitle: false }} />
        <Loading />
      </View>
    );
  }
  if (error && !fallback) {
    return (
      <View style={{ flex: 1 }}>
        <Backdrop />
        <Stack.Screen options={{ title: '', headerLargeTitle: false }} />
        <ErrorState error={error} onRetry={reload} />
      </View>
    );
  }

  const coverPath = info?.cover_url ?? (kind !== 'artist' ? `/api/jellyfin/image/${id}` : undefined);
  const subtitle =
    kind === 'album'
      ? [info?.artist, info?.year].filter(Boolean).join(' · ')
      : t('common.tracks', { count: tracks.length });

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Stack.Screen options={{ title: info?.name ?? '', headerLargeTitle: false }} />
      <FlatList
        data={tracks}
        keyExtractor={(item, index) => `${item.id}:${index}`}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textSecondary} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Cover path={coverPath} size={230} round={kind === 'artist'} shadow />
            <Text style={styles.title}>{info?.name}</Text>
            {kind === 'album' && info?.artist_id ? (
              <Pressable onPress={() => router.push(`/artist/${info.artist_id}`)}>
                <Text style={[styles.subtitle, { color: accent }]}>{subtitle}</Text>
              </Pressable>
            ) : (
              <Text style={styles.subtitle}>{subtitle}</Text>
            )}
            <View style={styles.actions}>
              <AccentButton label={t('common.play')} icon="play" onPress={() => play(0)} style={{ flex: 1 }} disabled={!tracks.length} />
              <AccentButton label={t('common.shuffle')} icon="shuffle" variant="glass" onPress={() => play(0, true)} style={{ flex: 1 }} disabled={!tracks.length} />
            </View>
            <Pressable
              disabled={allSaved || pending > 0 || !tracks.length}
              onPress={() => useOffline.getState().download(tracks)}
              style={styles.download}
            >
              <Ionicons name={allSaved ? 'checkmark-circle' : 'arrow-down-circle-outline'} size={20} color={allSaved ? accent : colors.textSecondary} />
              <Text style={styles.downloadLabel}>
                {allSaved
                  ? t('detail.downloaded')
                  : pending > 0
                    ? t('detail.downloading', { done: savedCount, total: tracks.length })
                    : t('detail.downloadAll')}
              </Text>
            </Pressable>
          </View>
        }
        renderItem={({ item, index }) => <TrackRow track={item} showNumber={isAlbum} onPress={() => play(index)} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 18 },
  subtitle: { color: colors.textSecondary, fontSize: 16, marginTop: 4, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginTop: 18 },
  download: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingVertical: 6 },
  downloadLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
});
