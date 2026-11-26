import { router, Stack } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { OfflineQueue } from '@/components/OfflineQueue';
import { NavList, Shelf, TileGrid, type NavItem } from '@/components/Shelf';
import { TabHeader, TopFade } from '@/components/TabHeader';
import { AccentButton, EmptyState } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { downloadedAlbums, sortDownloaded } from '@/lib/downloads';
import { formatBytes } from '@/lib/format';
import { offlineToLibrary, useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { usePlaylists } from '@/lib/playlists';
import { colors } from '@/lib/theme';

/** Downloads, laid out like the Library: Artists, Albums, Songs, then Recently Downloaded. Works without the server. */
export default function Offline() {
  const { t } = useTranslation();
  const saved = useOffline((s) => s.tracks);
  const downloadsOnly = useAuth((s) => s.status === 'offline');
  const downloading = useOffline((s) => Object.keys(s.active).length > 0);

  const all = useMemo(() => Object.values(saved), [saved]);
  const hasPlaylists = usePlaylists((s) => s.playlists.some((p) => p.track_ids.some((id) => saved[id])));
  const albums = useMemo(() => downloadedAlbums(all).slice(0, 24), [all]);
  const size = all.reduce((sum, tr) => sum + (tr.size || 0), 0);
  const play = (shuffle: boolean) => usePlayer.getState().playTracks(sortDownloaded(all).map(offlineToLibrary), 0, { shuffle });

  const items: NavItem[] = [
    ...(hasPlaylists
      ? [
          {
            key: 'playlists',
            title: t('library.playlists'),
            symbol: 'music.note.list',
            fallback: 'list',
            onPress: () => router.push('/browse/playlists?source=downloads'),
          } satisfies NavItem,
        ]
      : []),
    {
      key: 'artists',
      title: t('library.artists'),
      symbol: 'music.microphone',
      fallback: 'mic-outline',
      onPress: () => router.push('/browse/artists?source=downloads'),
    },
    {
      key: 'albums',
      title: t('library.albums'),
      symbol: 'square.stack',
      fallback: 'albums-outline',
      onPress: () => router.push('/browse/albums?source=downloads'),
    },
    {
      key: 'songs',
      title: t('library.songs'),
      symbol: 'music.note',
      fallback: 'musical-note',
      onPress: () => router.push('/browse/songs?source=downloads'),
    },
  ];

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}>
        <TabHeader title={t('offline.title')} />
        {downloadsOnly ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{t('offline.downloadsOnly')}</Text>
            <AccentButton label={t('offline.signIn')} variant="glass" onPress={() => useAuth.getState().leaveDownloadsOnly()} />
          </View>
        ) : null}
        <OfflineQueue />
        {all.length ? (
          <>
            <NavList items={items} />
            <Text style={styles.meta}>
              {t('common.tracks', { count: all.length })} · {t('offline.size', { size: formatBytes(size) })}
            </Text>
            <View style={styles.actions}>
              <AccentButton label={t('offline.playAll')} icon="play" onPress={() => play(false)} style={{ flex: 1 }} />
              <AccentButton label={t('common.shuffle')} icon="shuffle" variant="glass" onPress={() => play(true)} style={{ flex: 1 }} />
            </View>
            <Shelf title={t('offline.recent')}>
              <TileGrid
                items={albums.map((album) => ({
                  key: album.key,
                  title: album.name,
                  sub: album.artist,
                  local: album.cover,
                  onPress: () =>
                    router.push(
                      album.id ? `/album/${album.id}?downloaded=1` : `/browse/songs?source=downloads&album=${encodeURIComponent(album.name)}`,
                    ),
                }))}
              />
            </Shelf>
          </>
        ) : (
          downloading ? null : <EmptyState icon="arrow-down-circle-outline" body={t('offline.empty')} />
        )}
      </ScrollView>
      <TopFade />
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { color: colors.textSecondary, fontSize: 14, paddingHorizontal: 16, marginTop: 16 },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginTop: 12 },
  banner: { backgroundColor: 'rgba(251, 191, 36, 0.1)', padding: 12, borderRadius: 12, gap: 10, marginHorizontal: 16, marginBottom: 8 },
  bannerText: { color: colors.warning, fontSize: 14, lineHeight: 19 },
});
