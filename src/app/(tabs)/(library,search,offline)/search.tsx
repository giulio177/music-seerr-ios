import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Cover } from '@/components/Cover';
import { toast } from '@/components/Toast';
import { TrackRow } from '@/components/TrackRow';
import { Backdrop, EmptyState, ErrorState, OfflineState } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePlayer, useCurrentItem } from '@/lib/player';
import { colors, useAccent, withAlpha } from '@/lib/theme';
import type { CatalogTrack, DownloadJob, LibraryTrack } from '@/lib/types';

const TERMINAL = new Set(['completed', 'failed', 'interrupted']);

type Results = { library: LibraryTrack[]; catalog: CatalogTrack[] };

export default function Search() {
  const { t } = useTranslation();
  const isGuest = useAuth((s) => !!s.user?.is_guest);
  const unreachable = useAuth((s) => s.unreachable);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [jobs, setJobs] = useState<Record<string, DownloadJob>>({});
  const seq = useRef(0);

  const run = async (q: string) => {
    const id = ++seq.current;
    if (!q.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [catalog, library] = await Promise.all([
        api<{ results: CatalogTrack[] }>('/api/search', { query: { q, limit: 25 } }),
        isGuest
          ? Promise.resolve({ tracks: [] as LibraryTrack[] })
          : api<{ tracks: LibraryTrack[] }>('/api/jellyfin/library/tracks', { query: { q, limit: 8 } }).catch(() => ({ tracks: [] as LibraryTrack[] })),
      ]);
      if (id !== seq.current) return;
      setResults({ library: library.tracks, catalog: catalog.results });
      setError(null);
    } catch (e) {
      if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(500, String(e)));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (unreachable) return;
    const timer = setTimeout(() => run(query), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, unreachable]);

  // Follow requested downloads until they finish.
  const pendingIds = Object.values(jobs).filter((j) => !TERMINAL.has(j.status)).map((j) => j.job_id);
  const pendingKey = pendingIds.join(',');
  useEffect(() => {
    if (!pendingKey) return;
    const timer = setInterval(async () => {
      for (const jobId of pendingKey.split(',')) {
        try {
          const job = await api<DownloadJob>(`/api/download/job/${jobId}`);
          setJobs((prev) => ({ ...prev, [job.track.id]: job }));
        } catch {
          // Keep the last known state.
        }
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [pendingKey]);

  const request = async (track: CatalogTrack) => {
    try {
      const job = await api<DownloadJob>('/api/download', { method: 'POST', body: { track } });
      setJobs((prev) => ({ ...prev, [track.id]: job }));
      toast(t('search.requested'));
    } catch (e) {
      toast(e instanceof ApiError && e.detail ? e.detail : t('search.requestFailed'));
    }
  };

  const sections = results
    ? [
        ...(results.library.length ? [{ key: 'library', title: t('search.inLibrary'), data: results.library as (LibraryTrack | CatalogTrack)[] }] : []),
        ...(results.catalog.length ? [{ key: 'catalog', title: t('search.catalog'), data: results.catalog as (LibraryTrack | CatalogTrack)[] }] : []),
      ]
    : [];

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Stack.Screen
        options={{
          title: t('tabs.search'),
          headerSearchBarOptions: unreachable ? undefined : {
            placeholder: t('search.placeholder'),
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            hideWhenScrolling: false,
            autoCapitalize: 'none',
          },
        }}
      />
      {unreachable ? (
        <OfflineState />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, index) => `${item.id}:${index}`}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
          ListHeaderComponent={loading ? <ActivityIndicator style={{ marginTop: 16 }} color={colors.textSecondary} /> : undefined}
          ListEmptyComponent={
            loading ? undefined : error ? (
              <ErrorState error={error} onRetry={() => run(query)} />
            ) : (
              <EmptyState icon="search" body={results ? t('search.noResults') : t('search.hint')} />
            )
          }
          renderItem={({ item, section, index }) =>
            section.key === 'library' ? (
              <TrackRow
                track={item as LibraryTrack}
                onPress={() => usePlayer.getState().playTracks(section.data as LibraryTrack[], index)}
              />
            ) : (
              <CatalogRow track={item as CatalogTrack} job={jobs[item.id]} canRequest onRequest={() => request(item as CatalogTrack)} />
            )
          }
        />
      )}
    </View>
  );
}

function CatalogRow({ track, job, onRequest }: { track: CatalogTrack; job?: DownloadJob; canRequest: boolean; onRequest: () => void }) {
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
  section: { color: colors.text, fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
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
