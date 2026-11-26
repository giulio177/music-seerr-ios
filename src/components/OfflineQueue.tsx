import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { albumCoverPath } from '@/lib/api';
import { useOffline } from '@/lib/offline';
import { colors, useAccent } from '@/lib/theme';
import { Cover } from './Cover';

/** Songs being saved to this iPhone, with their progress; failed ones can be retried or cleared. */
export function OfflineQueue() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const active = useOffline((s) => s.active);
  const pending = useOffline((s) => s.pending);
  const ids = Object.keys(active).filter((id) => pending[id]);
  if (!ids.length) return null;
  const failed = ids.filter((id) => active[id] === 'error').length;
  const running = ids.length - failed;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('offlineQueue.title')}</Text>
        {running ? <Text style={styles.count}>{t('offlineQueue.running', { count: running })}</Text> : null}
      </View>
      {failed ? (
        <View style={styles.failedBar}>
          <Text style={styles.failedText}>{t('offlineQueue.failed', { count: failed })}</Text>
          <Pressable hitSlop={8} onPress={() => useOffline.getState().retryFailed()}>
            <Text style={[styles.link, { color: accent }]}>{t('offlineQueue.retry')}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => useOffline.getState().clearFailed()}>
            <Text style={styles.link}>{t('offlineQueue.clear')}</Text>
          </Pressable>
        </View>
      ) : null}
      {ids.map((id) => {
        const track = pending[id];
        const state = active[id];
        const progress = typeof state === 'number' ? Math.round(state * 100) : 0;
        return (
          <View key={id} style={styles.row}>
            <Cover path={track.cover_url} fallback={albumCoverPath(track.album_id)} size={44} />
            <View style={styles.meta}>
              <Text numberOfLines={1} style={styles.song}>
                {track.title}
              </Text>
              <Text numberOfLines={1} style={[styles.status, state === 'error' && { color: colors.danger }]}>
                {track.artist} ·{' '}
                {state === 'error' ? t('offlineQueue.error') : state === 'queued' ? t('offlineQueue.queued') : `${progress}%`}
              </Text>
              {state !== 'error' ? (
                <View style={styles.bar}>
                  <View style={[styles.barFill, { backgroundColor: accent, width: `${progress}%` }]} />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 4, paddingBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  count: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  failedBar: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 6 },
  failedText: { flex: 1, color: colors.danger, fontSize: 14 },
  link: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 60 },
  meta: { flex: 1, minWidth: 0 },
  song: { color: colors.text, fontSize: 16, fontWeight: '500' },
  status: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  bar: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', marginTop: 6, overflow: 'hidden' },
  barFill: { height: 3, borderRadius: 2 },
});
