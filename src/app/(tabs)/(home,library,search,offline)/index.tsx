import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Cover } from '@/components/Cover';
import { Backdrop, EmptyState, ErrorState, Loading, OfflineState } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, useAccent, withAlpha } from '@/lib/theme';
import type { Album, Artist, Playlist } from '@/lib/types';

type Kind = 'playlists' | 'albums' | 'artists';
type Item = { id: string; name: string; sub?: string; cover?: string | null };
const PAGE = 100;

async function fetchPage(kind: Kind, offset: number, q: string): Promise<{ items: Item[]; total: number }> {
  if (kind === 'playlists') {
    const list = await api<Playlist[]>('/api/jellyfin/playlists');
    const filtered = q ? list.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : list;
    return {
      items: filtered.map((p) => ({ id: p.id, name: p.name, cover: p.cover_url ?? `/api/jellyfin/image/${p.id}`, sub: String(p.track_count ?? '') })),
      total: filtered.length,
    };
  }
  if (kind === 'albums') {
    const res = await api<{ total: number; albums: Album[] }>('/api/jellyfin/albums', { query: { q, limit: PAGE, offset } });
    return { items: res.albums.map((a) => ({ id: a.id, name: a.name, sub: a.artist, cover: a.cover_url })), total: res.total };
  }
  const res = await api<{ total: number; artists: Artist[] }>('/api/jellyfin/artists', { query: { q, limit: PAGE, offset } });
  return { items: res.artists.map((a) => ({ id: a.id, name: a.name, cover: a.cover_url })), total: res.total };
}

export default function Library() {
  const { t } = useTranslation();
  const isGuest = useAuth((s) => !!s.user?.is_guest);
  const unreachable = useAuth((s) => s.unreachable);
  const [kind, setKind] = useState<Kind>('playlists');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const seq = useRef(0);
  const { width } = useWindowDimensions();
  const tile = (width - 16 * 3) / 2;

  const load = useCallback(
    async (mode: 'reset' | 'refresh' | 'more') => {
      const id = ++seq.current;
      const offset = mode === 'more' ? items.length : 0;
      if (mode === 'reset') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const page = await fetchPage(kind, offset, query.trim());
        if (id !== seq.current) return;
        setItems((prev) => (mode === 'more' ? [...prev, ...page.items] : page.items));
        setTotal(page.total);
        setError(null);
      } catch (e) {
        if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(500, String(e)));
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [kind, query, items.length],
  );

  useEffect(() => {
    if (isGuest || unreachable) return;
    const timer = setTimeout(() => load('reset'), query ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, query, isGuest, unreachable]);

  const open = (item: Item) => {
    if (kind === 'albums') router.push(`/album/${item.id}`);
    else if (kind === 'artists') router.push(`/artist/${item.id}`);
    else router.push(`/playlist/${item.id}`);
  };

  const header = (
    <Stack.Screen
      options={{
        title: t('tabs.library'),
        headerSearchBarOptions: isGuest || unreachable
          ? undefined
          : { placeholder: t('library.filter'), onChangeText: (e) => setQuery(e.nativeEvent.text), hideWhenScrolling: true },
      }}
    />
  );

  if (isGuest) {
    return (
      <View style={{ flex: 1 }}>
        <Backdrop />
        {header}
        <EmptyState icon="lock-closed-outline" title={t('library.guestTitle')} body={t('library.guestBody')} />
      </View>
    );
  }

  if (unreachable) {
    return (
      <View style={{ flex: 1 }}>
        <Backdrop />
        {header}
        <OfflineState />
      </View>
    );
  }

  const grid = kind !== 'artists';
  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      {header}
      <FlatList
        key={kind}
        data={loading || error ? [] : items}
        numColumns={grid ? 2 : 1}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        columnWrapperStyle={grid ? { gap: 16, paddingHorizontal: 16 } : undefined}
        contentContainerStyle={{ paddingBottom: 140, gap: grid ? 18 : 0 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.textSecondary} />}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (!loading && kind !== 'playlists' && items.length < total) load('more');
        }}
        ListHeaderComponent={<Segments value={kind} onChange={(k) => { setItems([]); setKind(k); }} />}
        ListEmptyComponent={
          loading ? (
            <View style={{ height: 300 }}><Loading /></View>
          ) : error ? (
            <View style={{ height: 420 }}><ErrorState error={error} onRetry={() => load('reset')} /></View>
          ) : (
            <View style={{ height: 300 }}><EmptyState icon="albums-outline" body={t('library.empty')} /></View>
          )
        }
        renderItem={({ item }) =>
          grid ? (
            <Pressable onPress={() => open(item)} style={({ pressed }) => ({ width: tile, opacity: pressed ? 0.75 : 1 })}>
              <Cover path={item.cover} size={tile} />
              <Text numberOfLines={1} style={styles.tileTitle}>{item.name}</Text>
              {item.sub ? (
                <Text numberOfLines={1} style={styles.tileSub}>
                  {kind === 'playlists' ? t('common.tracks', { count: Number(item.sub) || 0 }) : item.sub}
                </Text>
              ) : null}
            </Pressable>
          ) : (
            <Pressable onPress={() => open(item)} style={({ pressed }) => [styles.artistRow, pressed && { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
              <Cover path={item.cover} size={52} round />
              <Text numberOfLines={1} style={styles.artistName}>{item.name}</Text>
            </Pressable>
          )
        }
      />
    </View>
  );
}

function Segments({ value, onChange }: { value: Kind; onChange: (kind: Kind) => void }) {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const kinds: Kind[] = ['playlists', 'albums', 'artists'];
  return (
    <View style={styles.segments}>
      {kinds.map((k) => {
        const active = k === value;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            style={[styles.segment, active && { backgroundColor: withAlpha(accent, 0.22), borderColor: withAlpha(accent, 0.55) }]}
          >
            <Text style={[styles.segmentLabel, active && { color: colors.text }]}>{t(`library.${k}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 14 },
  segment: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  segmentLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  tileTitle: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 8 },
  tileSub: { color: colors.textSecondary, fontSize: 13, marginTop: 1 },
  artistRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 8 },
  artistName: { color: colors.text, fontSize: 17, fontWeight: '500', flex: 1 },
});
