import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Cover } from '@/components/Cover';
import { EmptyState, ErrorState, Loading } from '@/components/ui';
import { openInLibrary } from '@/lib/locate';
import { colors, useAccent } from '@/lib/theme';
import type { CatalogTrack } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** A row of `/api/history/downloads` (this account's requests, newest first). */
type Request = {
  job_id: string;
  status: string;
  created_at: number;
  playlist_name?: string | null;
  track: CatalogTrack;
};

/** Every song this account requested, with its outcome (like the web app's download history). */
export default function Requests() {
  const { t, i18n } = useTranslation();
  const { accent } = useAccent();
  const history = useApi<Request[]>('/api/history/downloads', { limit: 300 });

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: t('requests.title') }} />
      {history.loading && !history.data ? (
        <Loading />
      ) : history.error ? (
        <ErrorState error={history.error} onRetry={history.reload} />
      ) : (
        <FlatList
          data={history.data ?? []}
          keyExtractor={(row) => row.job_id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={history.refreshing} onRefresh={history.refresh} tintColor={colors.textSecondary} />}
          ListEmptyComponent={<EmptyState icon="time-outline" body={t('requests.empty')} />}
          renderItem={({ item }) => {
            const failed = item.status === 'failed' || item.status === 'interrupted';
            const done = item.status === 'completed';
            const date = new Date(item.created_at * 1000).toLocaleString(i18n.language, {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <Pressable
                // Songs now in the library open in their album.
                disabled={!done}
                onPress={() => openInLibrary({ jellyfinId: item.track.jellyfin_id, title: item.track.title, artist: item.track.artist })}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: 'rgba(255,255,255,0.05)' }]}
              >
                <Cover path={item.track.cover_url} size={48} />
                <View style={styles.meta}>
                  <Text numberOfLines={1} style={styles.title}>
                    {item.track.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.sub}>
                    {item.track.artist}
                    {item.playlist_name ? ` · ${item.playlist_name}` : ''}
                  </Text>
                </View>
                <View style={styles.side}>
                  <Text style={[styles.status, failed && { color: colors.danger }, done && { color: accent }]}>
                    {t(`search.status.${item.status}`, { defaultValue: item.status })}
                  </Text>
                  <Text style={styles.date}>{date}</Text>
                </View>
                {done ? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 64 },
  meta: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, fontWeight: '500' },
  sub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  side: { alignItems: 'flex-end', maxWidth: 120 },
  status: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  date: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
});
