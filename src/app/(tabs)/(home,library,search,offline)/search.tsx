import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from 'react-native';
import { CatalogRow } from '@/components/CatalogRow';
import { DownloadQueue } from '@/components/DownloadQueue';
import { RequestTargetPicker } from '@/components/RequestTarget';
import { NavList } from '@/components/Shelf';
import { TrackRow } from '@/components/TrackRow';
import { AccentButton, EmptyState, ErrorState, OfflineState } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDownloadQueue } from '@/lib/downloadQueue';
import { usePlayer } from '@/lib/player';
import { useRequests } from '@/lib/requests';
import { useRequestTarget } from '@/lib/requestTarget';
import { colors } from '@/lib/theme';
import type { CatalogTrack, LibraryTrack } from '@/lib/types';
import { isYouTubeLink, openYouTubeLink } from '@/lib/youtube';

type Results = { library: LibraryTrack[]; catalog: CatalogTrack[] };

export default function Search() {
  const { t } = useTranslation();
  const isGuest = useAuth((s) => !!s.user?.is_guest);
  const unreachable = useAuth((s) => s.unreachable);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const { jobs, request } = useRequests();
  const seq = useRef(0);
  const queueShown = useDownloadQueue((s) => s.jobs.length + s.finished.length > 0);

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

  const sections = results
    ? [
        ...(results.library.length ? [{ key: 'library', title: t('search.inLibrary'), data: results.library as (LibraryTrack | CatalogTrack)[] }] : []),
        ...(results.catalog.length ? [{ key: 'catalog', title: t('search.catalog'), data: results.catalog as (LibraryTrack | CatalogTrack)[] }] : []),
      ]
    : [];

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: t('tabs.search'),
          headerSearchBarOptions: unreachable ? undefined : {
            placeholder: t('search.placeholder'),
            onChangeText: (e) => {
              const text = e.nativeEvent.text;
              // A pasted YouTube link is not a search: open it in the link screen instead.
              if (!isGuest && isYouTubeLink(text)) openYouTubeLink(text);
              else setQuery(text);
            },
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
          ListHeaderComponent={
            <>
              {/* Where requested songs go: the library only, or a playlist they join once downloaded. */}
              {isGuest ? null : <RequestTargetPicker />}
              {loading ? (
                <ActivityIndicator style={{ marginTop: 16 }} color={colors.textSecondary} />
              ) : !results && !isGuest ? (
                // Before a search: this account's download requests and their progress, and the full history.
                <>
                  <NavList
                    items={[
                      {
                        key: 'requests',
                        title: t('requests.title'),
                        symbol: 'clock.arrow.circlepath',
                        fallback: 'time-outline',
                        onPress: () => router.push('/requests'),
                      },
                      {
                        key: 'youtube',
                        title: t('youtube.title'),
                        symbol: 'link',
                        fallback: 'link-outline',
                        onPress: () => openYouTubeLink(),
                      },
                    ]}
                  />
                  <DownloadQueue />
                </>
              ) : null}
            </>
          }
          ListEmptyComponent={
            loading ? undefined : error ? (
              <ErrorState error={error} onRetry={() => run(query)} />
            ) : results || !queueShown ? (
              <EmptyState
                icon="search"
                body={results ? t('search.noResults') : t('search.hint')}
                // Not in the catalog: the song can still come from a YouTube link.
                action={results && !isGuest ? <AccentButton label={t('youtube.title')} icon="link-outline" variant="glass" onPress={() => openYouTubeLink()} /> : undefined}
              />
            ) : undefined
          }
          renderItem={({ item, section, index }) =>
            section.key === 'library' ? (
              <TrackRow
                track={item as LibraryTrack}
                onPress={() => usePlayer.getState().playTracks(section.data as LibraryTrack[], index)}
              />
            ) : (
              <CatalogRow track={item as CatalogTrack} job={jobs[item.id]} onRequest={() => request(item as CatalogTrack, useRequestTarget.getState().target)} />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { color: colors.text, fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
});
