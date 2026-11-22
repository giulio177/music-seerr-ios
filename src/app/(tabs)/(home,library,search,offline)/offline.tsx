import { Stack } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { TrackRow } from '@/components/TrackRow';
import { TabHeader, TopFade } from '@/components/TabHeader';
import { AccentButton, EmptyState } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatBytes } from '@/lib/format';
import { offlineToLibrary, useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { colors } from '@/lib/theme';

export default function Offline() {
  const { t } = useTranslation();
  const saved = useOffline((s) => s.tracks);
  const downloadsOnly = useAuth((s) => s.status === 'offline');

  const tracks = useMemo(
    () =>
      Object.values(saved)
        .sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || (a.index_number ?? 0) - (b.index_number ?? 0))
        .map(offlineToLibrary),
    [saved],
  );
  const size = Object.values(saved).reduce((sum, tr) => sum + (tr.size || 0), 0);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={{ marginHorizontal: -16 }}>
              <TabHeader title={t('offline.title')} />
            </View>
            {downloadsOnly ? (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{t('offline.downloadsOnly')}</Text>
                <AccentButton label={t('offline.signIn')} variant="glass" onPress={() => useAuth.getState().leaveDownloadsOnly()} />
              </View>
            ) : null}
            {tracks.length ? (
              <>
                <Text style={styles.meta}>
                  {t('common.tracks', { count: tracks.length })} · {t('offline.size', { size: formatBytes(size) })}
                </Text>
                <View style={styles.actions}>
                  <AccentButton label={t('offline.playAll')} icon="play" onPress={() => usePlayer.getState().playTracks(tracks)} style={{ flex: 1 }} />
                  <AccentButton
                    label={t('common.shuffle')}
                    icon="shuffle"
                    variant="glass"
                    onPress={() => usePlayer.getState().playTracks(tracks, 0, { shuffle: true })}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={<EmptyState icon="arrow-down-circle-outline" body={t('offline.empty')} />}
        renderItem={({ item, index }) => <TrackRow track={item} onPress={() => usePlayer.getState().playTracks(tracks, index)} />}
      />
      <TopFade />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  meta: { color: colors.textSecondary, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 12 },
  banner: { backgroundColor: 'rgba(251, 191, 36, 0.1)', padding: 12, borderRadius: 12, gap: 10 },
  bannerText: { color: colors.warning, fontSize: 14, lineHeight: 19 },
});
