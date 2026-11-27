import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isRunning, useDownloadQueue } from '@/lib/downloadQueue';
import { openInLibrary } from '@/lib/locate';
import { colors, useAccent, withAlpha } from '@/lib/theme';
import { openAddToPlaylist } from '@/lib/playlistPicker';
import type { DownloadJob } from '@/lib/types';
import { Cover } from './Cover';
import { ContextMenu, hasNativeContextMenu, showActionSheet, type MenuItem } from './Menu';
import { Symbol } from './Symbol';
import { toast } from './Toast';

const FAST_MS = 3000;
const SLOW_MS = 15000;

/** Reloads the queue while the screen is shown: every 3 s while something downloads, else every 15 s. */
function usePolling() {
  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      const tick = async () => {
        await useDownloadQueue.getState().refresh();
        if (stopped) return;
        const busy = useDownloadQueue.getState().jobs.some(isRunning);
        timer = setTimeout(tick, busy ? FAST_MS : SLOW_MS);
      };
      tick();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    }, []),
  );
}

/** The account's download requests (like the web app's Activity queue), shown on the Search tab. */
export function DownloadQueue() {
  const { t } = useTranslation();
  usePolling();
  const jobs = useDownloadQueue((s) => s.jobs);
  const finished = useDownloadQueue((s) => s.finished);
  const rows = [...jobs, ...finished];
  if (!rows.length) return null;
  const running = jobs.filter(isRunning).length;
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('queue.title')}</Text>
        {running ? <Text style={styles.count}>{t('queue.running', { count: running })}</Text> : null}
      </View>
      {rows.map((job) => (
        <JobRow key={job.job_id} job={job} />
      ))}
    </View>
  );
}

function JobRow({ job }: { job: DownloadJob }) {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const failed = job.status === 'failed' || job.status === 'interrupted';
  const running = isRunning(job);
  const done = job.status === 'completed';
  const progress = job.status === 'downloading' ? Math.max(0, Math.min(100, job.progress || 0)) : null;
  const status = t(`search.status.${job.status}`, { defaultValue: job.status });

  const act = async (action: 'cancel' | 'retry' | 'dismiss') => {
    try {
      await useDownloadQueue.getState()[action](job.job_id);
    } catch (error) {
      toast(error instanceof ApiError && !error.offline ? error.detail : t('queue.actionFailed'));
    }
  };

  const canCancel = running && (job.status === 'pending' || job.status === 'downloading');
  const user = useAuth((st) => st.user);
  const items: MenuItem[] = [];
  // Running songs go in the playlist when their download finishes; finished ones at once.
  if (user && !user.is_guest && (running || done)) {
    items.push({
      id: 'addToPlaylist',
      title: t('track.addToPlaylist'),
      systemImage: 'text.badge.plus',
      run: () => openAddToPlaylist({ kind: 'job', job }),
    });
  }
  if (canCancel) items.push({ id: 'cancel', title: t('queue.cancel'), systemImage: 'xmark.circle', destructive: true, group: 1, run: () => act('cancel') });
  if (failed) {
    items.push({ id: 'retry', title: t('queue.retry'), systemImage: 'arrow.clockwise', group: 1, run: () => act('retry') });
    items.push({ id: 'dismiss', title: t('queue.dismiss'), systemImage: 'trash', destructive: true, group: 1, run: () => act('dismiss') });
  }

  return (
    <ContextMenu items={items} previewTitle={job.track.title} previewSubtitle={job.track.artist} previewImages={job.track.cover_url ? [job.track.cover_url] : []}>
    <Pressable
      // A finished request opens its song in the library.
      onPress={done ? () => openInLibrary({ jellyfinId: job.track.jellyfin_id, title: job.track.title, artist: job.track.artist }) : undefined}
      onLongPress={hasNativeContextMenu || !items.length ? undefined : () => showActionSheet(items, t('common.cancel'), job.track.title, job.track.artist)}
      style={styles.row}
    >
      <Cover path={job.track.cover_url} size={44} />
      <View style={styles.meta}>
        <Text numberOfLines={1} style={styles.song}>
          {job.track.title}
        </Text>
        <Text numberOfLines={1} style={[styles.status, failed && { color: colors.danger }, done && { color: accent }]}>
          {job.track.artist ? `${job.track.artist} · ` : ''}
          {status}
          {progress !== null && progress > 0 ? ` ${progress}%` : ''}
        </Text>
        {running ? (
          <View style={styles.bar}>
            <View style={[styles.barFill, { backgroundColor: accent, width: `${progress ?? (job.status === 'pending' ? 0 : 100)}%` }]} />
          </View>
        ) : null}
      </View>
      {canCancel ? (
        <IconAction symbol="xmark.circle" fallback="close-circle-outline" label={t('queue.cancel')} onPress={() => act('cancel')} />
      ) : null}
      {failed ? (
        <>
          <IconAction symbol="arrow.clockwise" fallback="refresh" label={t('queue.retry')} color={accent} onPress={() => act('retry')} />
          <IconAction symbol="trash" fallback="trash-outline" label={t('queue.dismiss')} onPress={() => act('dismiss')} />
        </>
      ) : null}
      {done ? (
        <View style={[styles.done, { backgroundColor: withAlpha(accent, 0.18) }]}>
          <Symbol name="checkmark" fallback="checkmark" size={14} color={accent} />
        </View>
      ) : null}
    </Pressable>
    </ContextMenu>
  );
}

function IconAction({
  symbol,
  fallback,
  label,
  color = colors.textSecondary,
  onPress,
}: {
  symbol: 'xmark.circle' | 'arrow.clockwise' | 'trash';
  fallback: 'close-circle-outline' | 'refresh' | 'trash-outline';
  label: string;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.action, pressed && { opacity: 0.5 }]}>
      <Symbol name={symbol} fallback={fallback} size={20} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 8, paddingBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  count: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 60 },
  meta: { flex: 1, minWidth: 0 },
  song: { color: colors.text, fontSize: 16, fontWeight: '500' },
  status: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  bar: { height: 3, borderRadius: 2, marginTop: 6, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)' },
  barFill: { height: '100%', borderRadius: 2 },
  action: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  done: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
