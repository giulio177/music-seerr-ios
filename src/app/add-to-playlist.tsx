import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Cover } from '@/components/Cover';
import { Symbol } from '@/components/Symbol';
import { toast } from '@/components/Toast';
import { Backdrop, EmptyState, ErrorState, Loading } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addToPlaylist, createPlaylist, usePlaylistPicker } from '@/lib/playlistPicker';
import { usePlaylists } from '@/lib/playlists';
import { colors, useAccent, withAlpha } from '@/lib/theme';
import type { Playlist } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** "Add to playlist" sheet: New Playlist first, then the account's own playlists (like Apple Music). */
export default function AddToPlaylist() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const user = useAuth((s) => s.user);
  const target = usePlaylistPicker((s) => s.target);
  const playlists = useApi<Playlist[]>('/api/jellyfin/playlists');
  const [busy, setBusy] = useState<string | null>(null);
  const saved = usePlaylists((s) => s.playlists);
  // Song IDs of the target in the library (a request counts once its song is there).
  const songIds = useMemo(
    () =>
      target?.kind === 'tracks' ? target.tracks.map((tr) => tr.id) : target?.kind === 'job' && target.job.track.jellyfin_id ? [target.job.track.jellyfin_id] : [],
    [target],
  );
  /** Playlists that already hold every song of the target, from the saved playlist contents. */
  const holding = useMemo(() => {
    const set = new Set<string>();
    if (!songIds.length) return set;
    for (const p of saved) if (songIds.every((id) => p.track_ids.includes(id))) set.add(p.id);
    return set;
  }, [saved, songIds]);

  // Saved contents can be a session old: read them again so the marks are current.
  useEffect(() => {
    usePlaylists.getState().refresh();
  }, []);
  // Regular accounts may change only their own playlists; administrators may change any they see.
  const own = (playlists.data ?? []).filter((p) => user?.is_admin || !p.owner_user_id || p.owner_user_id === user?.id);
  const subtitle =
    target?.kind === 'tracks'
      ? target.tracks.length === 1
        ? target.tracks[0].title
        : t('common.tracks', { count: target.tracks.length })
      : target?.kind === 'job'
        ? target.job.track.title
        : '';

  const done = (outcome: 'added' | 'queued', name: string) => {
    toast(outcome === 'queued' ? t('playlistPicker.queued', { name }) : t('playlistPicker.added', { name }));
    router.back();
  };

  const fail = (error: unknown) => {
    const status = error instanceof ApiError ? error.status : 500;
    const detail = error instanceof ApiError ? error.detail : '';
    toast(
      status === 0
        ? t('track.playlistOffline')
        : status === 403
          ? t('track.playlistNotYours')
          : detail === 'not_in_library_yet'
            ? t('playlistPicker.notInLibraryYet')
            : t('playlistPicker.failed'),
    );
  };

  const choose = (playlist: Playlist) => {
    if (!target || busy) return;
    if (!holding.has(playlist.id)) return add(playlist);
    Alert.alert(t('playlistPicker.alreadyTitle'), t('playlistPicker.alreadyBody', { name: playlist.name, count: songIds.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('playlistPicker.addAgain'), onPress: () => add(playlist) },
    ]);
  };

  const add = async (playlist: Playlist) => {
    if (!target) return;
    setBusy(playlist.id);
    try {
      done(await addToPlaylist(target, playlist), playlist.name);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    Alert.prompt(
      t('playlistPicker.new'),
      t('playlistPicker.nameHint'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('playlistPicker.create'),
          onPress: async (value?: string) => {
            const name = (value ?? '').trim();
            if (!name) return;
            setBusy('new');
            try {
              done(await createPlaylist(name, target), name);
            } catch (error) {
              fail(error);
            } finally {
              setBusy(null);
            }
          },
        },
      ],
      'plain-text',
    );

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{t('playlistPicker.title')}</Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
          <Text style={[styles.cancel, { color: accent }]}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
      {playlists.loading && !playlists.data ? (
        <Loading />
      ) : playlists.error ? (
        <ErrorState error={playlists.error} onRetry={playlists.reload} />
      ) : (
        <FlatList
          data={own}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListHeaderComponent={
            <Pressable onPress={create} disabled={!!busy} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <View style={[styles.newIcon, { backgroundColor: withAlpha(accent, 0.18) }]}>
                {busy === 'new' ? <ActivityIndicator color={accent} /> : <Symbol name="plus" fallback="add" size={22} color={accent} />}
              </View>
              <Text style={[styles.name, { color: accent }]}>{t('playlistPicker.new')}</Text>
            </Pressable>
          }
          ListEmptyComponent={<EmptyState icon="list" body={t('playlistPicker.empty')} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => choose(item)} disabled={!!busy} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <Cover path={item.cover_url ?? `/api/jellyfin/image/${item.id}`} size={52} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.count}>
                  {holding.has(item.id) ? `${t('playlistPicker.alreadyIn')} · ` : ''}
                  {t('common.tracks', { count: item.track_count ?? 0 })}
                </Text>
              </View>
              {busy === item.id ? (
                <ActivityIndicator color={colors.textSecondary} />
              ) : holding.has(item.id) ? (
                <Symbol name="checkmark.circle.fill" fallback="checkmark-circle" size={24} color={accent} />
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 12 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
  cancel: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 8, minHeight: 68 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  newIcon: { width: 52, height: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 17, fontWeight: '500' },
  count: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
});
