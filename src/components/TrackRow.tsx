import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionSheetIOS, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTime } from '@/lib/format';
import { localCoverUri, useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { colors, useAccent } from '@/lib/theme';
import type { LibraryTrack } from '@/lib/types';
import { Cover } from './Cover';
import { toast } from './Toast';

/** Download state badge: progress ring while downloading, check mark when saved. */
export function DownloadBadge({ id }: { id: string }) {
  const saved = useOffline((s) => !!s.tracks[id]);
  const state = useOffline((s) => s.active[id]);
  const { accent } = useAccent();
  if (saved) return <Ionicons name="arrow-down-circle" size={16} color={accent} />;
  if (state === 'error') return <Ionicons name="alert-circle" size={16} color={colors.danger} />;
  if (state === undefined) return null;
  const pct = typeof state === 'number' ? Math.round(state * 100) : 0;
  return <Text style={[styles.progress, { color: accent }]}>{pct}%</Text>;
}

export function openTrackMenu(track: LibraryTrack, t: (key: string) => string) {
  const offline = useOffline.getState();
  const saved = !!offline.tracks[track.id];
  const actions: { label: string; run: () => void; destructive?: boolean }[] = [
    {
      label: t('track.playNext'),
      run: () => {
        usePlayer.getState().playNext(track);
        toast(t('track.playingNext'));
      },
    },
    {
      label: t('track.addToQueue'),
      run: () => {
        usePlayer.getState().addToQueue(track);
        toast(t('track.addedToQueue'));
      },
    },
    saved
      ? { label: t('track.removeDownload'), run: () => offline.remove(track.id), destructive: true }
      : { label: t('track.download'), run: () => offline.download([track]) },
  ];
  if (track.album_id) actions.push({ label: t('track.goToAlbum'), run: () => router.push(`/album/${track.album_id}`) });
  if (track.artist_id) actions.push({ label: t('track.goToArtist'), run: () => router.push(`/artist/${track.artist_id}`) });
  const options = [...actions.map((a) => a.label), t('common.cancel')];
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: track.title,
      message: track.artist,
      options,
      cancelButtonIndex: options.length - 1,
      destructiveButtonIndex: actions.findIndex((a) => a.destructive),
      userInterfaceStyle: 'dark',
    },
    (index) => actions[index]?.run(),
  );
}

type Props = {
  track: LibraryTrack;
  onPress: () => void;
  /** Album lists show the track number instead of the cover. */
  showNumber?: boolean;
};

export const TrackRow = memo(function TrackRow({ track, onPress, showNumber }: Props) {
  const { t } = useTranslation();
  const current = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const offline = useOffline((s) => s.tracks[track.id]);
  const { accent } = useAccent();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => openTrackMenu(track, t)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {showNumber ? (
        <Text style={[styles.number, current && { color: accent }]}>{track.index_number ?? '·'}</Text>
      ) : (
        <Cover path={track.cover_url} local={offline ? localCoverUri(offline) : null} size={48} />
      )}
      <View style={styles.meta}>
        <Text numberOfLines={1} style={[styles.title, current && { color: accent }]}>
          {track.title}
        </Text>
        <View style={styles.subRow}>
          <DownloadBadge id={track.id} />
          <Text numberOfLines={1} style={styles.artist}>
            {track.artist}
            {showNumber ? '' : track.album ? ` · ${track.album}` : ''}
          </Text>
        </View>
      </View>
      <Text style={styles.duration}>{formatTime(track.duration_sec)}</Text>
      <Pressable hitSlop={12} onPress={() => openTrackMenu(track, t)} accessibilityLabel="More">
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
      </Pressable>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12, minHeight: 60 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  number: { width: 28, textAlign: 'center', color: colors.textSecondary, fontSize: 15, fontVariant: ['tabular-nums'] },
  meta: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, fontWeight: '500' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  artist: { color: colors.textSecondary, fontSize: 14, flexShrink: 1 },
  duration: { color: colors.textTertiary, fontSize: 13, fontVariant: ['tabular-nums'] },
  progress: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
