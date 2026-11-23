import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';
import { NavList, Shelf, TileGrid, type NavItem } from '@/components/Shelf';
import { TabHeader, TopFade } from '@/components/TabHeader';
import { EmptyState, Loading, OfflineState } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import type { Album } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Library, laid out like Apple Music: Playlists, Artists, Albums, Songs, then Recently Added. */
export default function Library() {
  const { t } = useTranslation();
  const isGuest = useAuth((s) => !!s.user?.is_guest);
  const unreachable = useAuth((s) => s.unreachable);
  const recent = useApi<{ total: number; albums: Album[] }>(isGuest || unreachable ? null : '/api/jellyfin/albums', {
    sort: 'recent',
    limit: 24,
  });

  const header = <Stack.Screen options={{ headerShown: false }} />;

  if (isGuest || unreachable) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
          <TabHeader title={t('tabs.library')} />
          {unreachable ? (
            <OfflineState />
          ) : (
            <EmptyState icon="lock-closed-outline" title={t('library.guestTitle')} body={t('library.guestBody')} />
          )}
        </ScrollView>
        <TopFade />
      </View>
    );
  }

  const items: NavItem[] = [
    { key: 'playlists', title: t('library.playlists'), symbol: 'music.note.list', fallback: 'list', onPress: () => router.push('/browse/playlists') },
    { key: 'artists', title: t('library.artists'), symbol: 'music.microphone', fallback: 'mic-outline', onPress: () => router.push('/browse/artists') },
    { key: 'albums', title: t('library.albums'), symbol: 'square.stack', fallback: 'albums-outline', onPress: () => router.push('/browse/albums') },
    { key: 'songs', title: t('library.songs'), symbol: 'music.note', fallback: 'musical-note', onPress: () => router.push('/browse/songs') },
  ];

  return (
    <View style={{ flex: 1 }}>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={recent.refreshing} onRefresh={recent.refresh} tintColor={colors.textSecondary} />}
      >
        <TabHeader title={t('tabs.library')} />
        <NavList items={items} />
        <Shelf title={t('library.recentlyAdded')}>
          {recent.loading ? (
            <View style={{ height: 200 }}>
              <Loading />
            </View>
          ) : (
            <TileGrid
              items={(recent.data?.albums ?? []).map((album) => ({
                key: album.id,
                title: album.name,
                sub: album.artist,
                cover: album.cover_url,
                onPress: () => router.push(`/album/${album.id}`),
              }))}
            />
          )}
        </Shelf>
      </ScrollView>
      <TopFade />
    </View>
  );
}
