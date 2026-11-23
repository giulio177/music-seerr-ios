import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTime } from '@/lib/format';
import { useCurrentItem, usePlayer } from '@/lib/player';
import { colors, useAccent, withAlpha } from '@/lib/theme';
import type { CatalogTrack, DownloadJob } from '@/lib/types';

export type ReleaseTrack = CatalogTrack & { track_number?: number | null; disc_number?: number | null };

const ACTIVE = new Set(['pending', 'downloading', 'tagging', 'moving', 'jellyfin_sync']);

/** Plays a catalog song: the library copy when there is one, else its 30 second preview. */
export function playCatalogTrack(track: ReleaseTrack) {
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
}

/**
 * Album row of a song the library does not have (like the web app): dimmed, its track number,
 * a tap plays the preview, and the trailing button requests the download.
 */
export function MissingRow({ track, job, onRequest }: { track: ReleaseTrack; job?: DownloadJob; onRequest: () => void }) {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const current = useCurrentItem();
  const playing = current?.id === track.id || (!!track.jellyfin_id && current?.id === track.jellyfin_id);
  const owned = track.in_jellyfin || job?.status === 'completed';
  const failed = job?.status === 'failed' || job?.status === 'interrupted';

  let trailing: React.ReactNode;
  if (owned) {
    trailing = <Text style={styles.duration}>{formatTime(track.duration)}</Text>;
  } else if (job && ACTIVE.has(job.status)) {
    trailing = (
      <View style={styles.status}>
        <ActivityIndicator size="small" color={accent} />
        <Text style={[styles.statusText, { color: accent }]}>
          {job.status === 'downloading' && job.progress ? `${job.progress}%` : t(`search.status.${job.status}`, { defaultValue: job.status })}
        </Text>
      </View>
    );
  } else {
    trailing = (
      <Pressable
        onPress={onRequest}
        hitSlop={8}
        style={[styles.request, { borderColor: withAlpha(failed ? colors.danger : accent, 0.6) }]}
        accessibilityLabel={t('search.request')}
      >
        <Ionicons name={failed ? 'refresh' : 'add'} size={15} color={failed ? colors.danger : accent} />
        <Text style={[styles.requestText, { color: failed ? colors.danger : accent }]}>{t(failed ? 'common.retry' : 'search.request')}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => playCatalogTrack(track)}
      disabled={!owned && !track.preview_url}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: 'rgba(255,255,255,0.05)' }]}
    >
      <View style={styles.lead}>
        {playing ? (
          <Ionicons name="volume-high" size={15} color={accent} />
        ) : (
          <Text style={[styles.number, !owned && styles.dim]}>{track.track_number ?? '·'}</Text>
        )}
      </View>
      <View style={[styles.meta, !owned && styles.dim]}>
        <Text numberOfLines={1} style={[styles.title, playing && { color: accent }]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={styles.sub}>
          {owned ? track.artist : `${t('detail.notInLibrary')}${track.preview_url ? ` · ${t('detail.preview')}` : ''}`}
        </Text>
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12, minHeight: 60 },
  lead: { width: 28, alignItems: 'center' },
  number: { color: colors.textSecondary, fontSize: 15, fontVariant: ['tabular-nums'] },
  dim: { opacity: 0.45 },
  meta: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, fontWeight: '500' },
  sub: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
  duration: { color: colors.textTertiary, fontSize: 13, fontVariant: ['tabular-nums'] },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 12, fontWeight: '700' },
  request: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  requestText: { fontSize: 13, fontWeight: '700' },
});
