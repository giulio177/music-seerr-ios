import { router, Stack } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CatalogRow } from '@/components/CatalogRow';
import { Cover, coverCandidateUrls } from '@/components/Cover';
import { ContextMenu } from '@/components/Menu';
import { trackMenuItems } from '@/components/TrackRow';
import { TabHeader, TopFade } from '@/components/TabHeader';
import { Loading, OfflineState } from '@/components/ui';
import { albumCoverPath, authHeaders } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localCoverUri, useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { useRequests } from '@/lib/requests';
import { colors } from '@/lib/theme';
import type { CatalogTrack, LibraryTrack, Playlist } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** A row of `/api/history/plays`. */
type Play = {
  id: number;
  track_id: string;
  title: string;
  artist: string;
  album: string;
  source: string;
  duration: number;
  cover_url: string;
};

const JELLYFIN_ID = /^[0-9a-f]{32}$/;
const TILE = 148;

export default function Home() {
  const { t } = useTranslation();
  const unreachable = useAuth((s) => s.unreachable);
  const isGuest = useAuth((s) => !!s.user?.is_guest);
  const plays = useApi<Play[]>(unreachable || isGuest ? null : '/api/history/plays', { limit: 60 });
  const playlists = useApi<Playlist[]>(unreachable || isGuest ? null : '/api/jellyfin/playlists');
  const picks = useApi<{ tracks: CatalogTrack[] }>(unreachable ? null : '/api/recommendations', { limit: 12 });
  const { jobs, request } = useRequests();

  // Library songs only (previews cannot be replayed), newest first, each song once.
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const tracks: LibraryTrack[] = [];
    for (const play of plays.data ?? []) {
      if (play.source === 'preview' || !JELLYFIN_ID.test(play.track_id) || seen.has(play.track_id)) continue;
      seen.add(play.track_id);
      tracks.push({
        id: play.track_id,
        title: play.title,
        artist: play.artist,
        album: play.album,
        duration_sec: play.duration,
        stream_url: `/api/jellyfin/stream/${play.track_id}`,
        cover_url: play.cover_url || `/api/jellyfin/image/${play.track_id}`,
      });
      if (tracks.length >= 20) break;
    }
    return tracks;
  }, [plays.data]);

  const header = <Stack.Screen options={{ headerShown: false }} />;

  if (unreachable) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
          <TabHeader title={t('tabs.home')} />
          <OfflineState />
        </ScrollView>
        <TopFade />
      </View>
    );
  }

  const loading = plays.loading || playlists.loading || picks.loading;
  const refresh = async () => {
    await Promise.all([plays.refresh(), playlists.refresh(), picks.refresh()]);
  };

  return (
    <View style={{ flex: 1 }}>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={plays.refreshing || picks.refreshing} onRefresh={refresh} tintColor={colors.textSecondary} />}
      >
        <TabHeader title={t('tabs.home')} />
        {loading && !recent.length && !picks.data ? (
          <View style={{ height: 300 }}>
            <Loading />
          </View>
        ) : null}

        {recent.length ? (
          <Shelf title={t('home.recent')}>
            <FlatList
              horizontal
              data={recent}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.shelf}
              renderItem={({ item, index }) => (
                <RecentTrackTile track={item} onPress={() => usePlayer.getState().playTracks(recent, index)} />
              )}
            />
          </Shelf>
        ) : null}

        {playlists.data?.length ? (
          <Shelf title={t('home.playlists')}>
            <FlatList
              horizontal
              data={playlists.data}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.shelf}
              renderItem={({ item }) => (
                <Tile
                  title={item.name}
                  sub={t('common.tracks', { count: item.track_count ?? 0 })}
                  cover={item.cover_url ?? `/api/jellyfin/image/${item.id}`}
                  onPress={() => router.push(`/playlist/${item.id}`)}
                />
              )}
            />
          </Shelf>
        ) : null}

        {picks.data?.tracks.length ? (
          <Shelf title={t('home.picks')}>
            {picks.data.tracks.map((track) => (
              <CatalogRow key={track.id} track={track} job={jobs[track.id]} onRequest={() => request(track)} />
            ))}
          </Shelf>
        ) : null}

        {!loading && !recent.length && !playlists.data?.length && !picks.data?.tracks.length ? (
          <Text style={styles.empty}>{t('home.empty')}</Text>
        ) : null}
      </ScrollView>
      <TopFade />
    </View>
  );
}

function Shelf({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.shelfTitle}>{title}</Text>
      {children}
    </View>
  );
}

function RecentTrackTile({ track, onPress }: { track: LibraryTrack; onPress: () => void }) {
  const { t } = useTranslation();
  const offline = useOffline((s) => s.tracks[track.id]);
  const localCover = offline ? localCoverUri(offline) : null;
  const fallbackCover = albumCoverPath(track.album_id);
  return (
    <ContextMenu
      items={trackMenuItems(track, t)}
      previewTitle={track.title}
      previewSubtitle={track.artist}
      previewImages={coverCandidateUrls(track.cover_url, localCover, fallbackCover)}
      previewHeaders={authHeaders()}
      onPreviewPress={onPress}
    >
      <Tile title={track.title} sub={track.artist} cover={track.cover_url} local={localCover} fallback={fallbackCover} onPress={onPress} />
    </ContextMenu>
  );
}

function Tile({
  title,
  sub,
  cover,
  local,
  fallback,
  onPress,
}: {
  title: string;
  sub?: string;
  cover?: string | null;
  local?: string | null;
  fallback?: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ width: TILE, opacity: pressed ? 0.75 : 1 })}>
      <Cover path={cover} local={local} fallback={fallback} size={TILE} />
      <Text numberOfLines={1} style={styles.tileTitle}>
        {title}
      </Text>
      {sub ? (
        <Text numberOfLines={1} style={styles.tileSub}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shelfTitle: { color: colors.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },
  shelf: { paddingHorizontal: 16, gap: 14 },
  tileTitle: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
  tileSub: { color: colors.textSecondary, fontSize: 13, marginTop: 1 },
  empty: { color: colors.textSecondary, fontSize: 15, textAlign: 'center', padding: 32 },
});
