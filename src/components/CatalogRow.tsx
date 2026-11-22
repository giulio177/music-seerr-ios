import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePlayer, useCurrentItem } from '@/lib/player';
import { colors, useAccent, withAlpha } from '@/lib/theme';
import type { CatalogTrack, DownloadJob } from '@/lib/types';
import { Cover } from './Cover';

/** Catalog song: plays from the library when it is there, else the preview; Request downloads it. */
export function CatalogRow({ track, job, onRequest }: { track: CatalogTrack; job?: DownloadJob; onRequest: () => void }) {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const current = useCurrentItem();
  const playing = current?.id === track.id;
  const inLibrary = track.in_jellyfin || job?.status === 'completed';

  const onPress = () => {
    if (track.in_jellyfin && track.jellyfin_id) {
      usePlayer.getState().playTracks([
        {
          id: track.jellyfin_id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration_sec: track.duration,
          stream_url: `/api/jellyfin/stream/${track.jellyfin_id}`,
          cover_url: `/api/jellyfin/image/${track.jellyfin_id}`,
        },
      ]);
    } else if (track.preview_url) {
      usePlayer.getState().playPreview(track);
    }
  };

  let right: React.ReactNode;
  if (inLibrary) {
    right = (
      <View style={[styles.badge, { backgroundColor: withAlpha(accent, 0.18) }]}>
        <Text style={[styles.badgeText, { color: accent }]}>{t('search.inLibraryBadge')}</Text>
      </View>
    );
  } else if (job) {
    const failed = job.status === 'failed' || job.status === 'interrupted';
    right = (
      <Pressable disabled={!failed} onPress={onRequest} style={styles.badge}>
        <Text style={[styles.badgeText, { color: failed ? colors.danger : colors.textSecondary }]}>
          {t(`search.status.${job.status}`, { defaultValue: job.status })}
          {job.status === 'downloading' && job.progress ? ` ${job.progress}%` : ''}
        </Text>
      </Pressable>
    );
  } else {
    right = (
      <Pressable onPress={onRequest} hitSlop={8} style={[styles.request, { borderColor: withAlpha(accent, 0.6) }]} accessibilityLabel={t('search.request')}>
        <Ionicons name="add" size={16} color={accent} />
        <Text style={[styles.requestText, { color: accent }]}>{t('search.request')}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
      <View>
        <Cover path={track.cover_url} size={48} />
        {!track.in_jellyfin && track.preview_url ? (
          <View style={styles.previewDot}>
            <Ionicons name={playing ? 'volume-high' : 'play'} size={11} color="#fff" />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.title, playing && { color: accent }]}>{track.title}</Text>
        <Text numberOfLines={1} style={styles.sub}>
          {track.artist}
          {track.album ? ` · ${track.album}` : ''}
        </Text>
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 60 },
  title: { color: colors.text, fontSize: 16, fontWeight: '500' },
  sub: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  request: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  requestText: { fontSize: 13, fontWeight: '700' },
  previewDot: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
