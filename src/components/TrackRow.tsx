import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTime } from '@/lib/format';
import { albumCoverPath, authHeaders } from '@/lib/api';
import { localCoverUri, useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { colors, useAccent } from '@/lib/theme';
import type { LibraryTrack } from '@/lib/types';
import { Cover, coverCandidateUrls } from './Cover';
import { ContextMenu, hasNativeContextMenu, showActionSheet, type MenuItem } from './Menu';
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

/** Menu items of a library song (rows and the full player share them). */
export function trackMenuItems(
  track: LibraryTrack,
  t: (key: string) => string,
  options: { queue?: boolean; navigate?: (path: string) => void } = {},
): MenuItem[] {
  const { queue = true, navigate = (path: string) => router.push(path as never) } = options;
  const offline = useOffline.getState();
  const saved = !!offline.tracks[track.id];
  const items: MenuItem[] = [];
  if (queue) {
    items.push(
      {
        id: 'playNext',
        title: t('track.playNext'),
        systemImage: 'text.line.first.and.arrowtriangle.forward',
        run: () => {
          usePlayer.getState().playNext(track);
          toast(t('track.playingNext'));
        },
      },
      {
        id: 'addToQueue',
        title: t('track.addToQueue'),
        systemImage: 'text.line.last.and.arrowtriangle.forward',
        run: () => {
          usePlayer.getState().addToQueue(track);
          toast(t('track.addedToQueue'));
        },
      },
    );
  }
  if (track.album_id) {
    items.push({ id: 'album', title: t('track.goToAlbum'), systemImage: 'square.stack', group: 1, run: () => navigate(`/album/${track.album_id}`) });
  }
  if (track.artist_id) {
    items.push({ id: 'artist', title: t('track.goToArtist'), systemImage: 'music.microphone', group: 1, run: () => navigate(`/artist/${track.artist_id}`) });
  }
  items.push(
    saved
      ? { id: 'remove', title: t('track.removeDownload'), systemImage: 'xmark.circle', destructive: true, group: 2, run: () => offline.remove(track.id) }
      : { id: 'download', title: t('track.download'), systemImage: 'arrow.down.circle', group: 2, run: () => offline.download([track]) },
  );
  return items;
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
  const localCover = offline ? localCoverUri(offline) : null;
  const fallbackCover = albumCoverPath(track.album_id);
  const items = trackMenuItems(track, t);
  const previewImages = coverCandidateUrls(track.cover_url, localCover, fallbackCover);

  return (
    <ContextMenu
      items={items}
      previewTitle={track.title}
      previewSubtitle={track.artist}
      previewImages={previewImages}
      previewHeaders={authHeaders()}
      onPreviewPress={onPress}
    >
      <Pressable
        onPress={onPress}
        onLongPress={
          hasNativeContextMenu ? undefined : () => showActionSheet(items, t('common.cancel'), track.title, track.artist)
        }
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {showNumber ? (
          <Text style={[styles.number, current && { color: accent }]}>{track.index_number ?? '·'}</Text>
        ) : (
          <Cover path={track.cover_url} local={localCover} fallback={fallbackCover} size={48} />
        )}
        <View style={styles.meta}>
          <Text numberOfLines={1} style={[styles.title, current && { color: accent }]}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={styles.artist}>
            {track.artist}
            {showNumber ? '' : track.album ? ` · ${track.album}` : ''}
          </Text>
        </View>
        <View style={styles.trailing}>
          <DownloadBadge id={track.id} />
          <Text style={styles.duration}>{formatTime(track.duration_sec)}</Text>
        </View>
      </Pressable>
    </ContextMenu>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12, minHeight: 60 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  number: { width: 28, textAlign: 'center', color: colors.textSecondary, fontSize: 15, fontVariant: ['tabular-nums'] },
  meta: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, fontWeight: '500' },
  artist: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  duration: { color: colors.textTertiary, fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 36, textAlign: 'right' },
  progress: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
