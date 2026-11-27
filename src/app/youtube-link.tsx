import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Cover } from '@/components/Cover';
import { RequestTargetPicker } from '@/components/RequestTarget';
import { Symbol } from '@/components/Symbol';
import { toast } from '@/components/Toast';
import { AccentButton, Backdrop, Glass } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDownloadQueue } from '@/lib/downloadQueue';
import { formatTime } from '@/lib/format';
import { openInLibrary } from '@/lib/locate';
import { useRequestTarget } from '@/lib/requestTarget';
import { colors, useAccent } from '@/lib/theme';
import type { CatalogTrack, DownloadJob } from '@/lib/types';

/**
 * Request a song from a YouTube or YouTube Music link, for music the catalog search does not find. The server reads
 * the video (`/api/youtube/resolve`) and guesses title and artist, which can be corrected here; the request then
 * downloads that exact video and joins the playlist picked in the Search tab, like a catalog request.
 */
export default function YouTubeLink() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const isGuest = useAuth((s) => !!s.user?.is_guest);
  const params = useLocalSearchParams<{ url?: string }>();
  const [url, setUrl] = useState(params.url ?? '');
  const [track, setTrack] = useState<CatalogTrack | null>(null);
  // A link passed by the Search field is read at once.
  const [finding, setFinding] = useState(!!params.url);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (link: string) => {
    try {
      // yt-dlp reads the video on the server, which can take a while.
      setTrack(await api<CatalogTrack>('/api/youtube/resolve', { query: { url: link.trim() }, timeoutMs: 60000 }));
    } catch (e) {
      const detail = e instanceof ApiError ? e.detail : '';
      setError(
        detail === 'not_youtube_link'
          ? t('youtube.notLink')
          : detail === 'video_unavailable'
            ? t('youtube.unavailable')
            : e instanceof ApiError && e.status === 404
              ? t('youtube.serverTooOld')
              : e instanceof ApiError && e.offline
                ? t('track.playlistOffline')
                : t('youtube.failed'),
      );
    } finally {
      setFinding(false);
    }
  };

  const find = () => {
    if (!url.trim() || finding) return;
    setFinding(true);
    setError(null);
    setTrack(null);
    load(url);
  };

  useEffect(() => {
    const link = params.url;
    if (link) (async () => load(link))();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (field: 'title' | 'artist' | 'album', value: string) => setTrack((prev) => (prev ? { ...prev, [field]: value } : prev));

  const request = async () => {
    if (!track || !track.title.trim() || !track.artist.trim()) return;
    const target = useRequestTarget.getState().target;
    const body = { ...track, title: track.title.trim(), artist: track.artist.trim(), album: track.album.trim() };
    setSending(true);
    try {
      await api<DownloadJob>('/api/download', {
        method: 'POST',
        body: target ? { track: body, playlist_id: target.id, playlist_name: target.name } : { track: body },
      });
      useDownloadQueue.getState().refresh();
      toast(target ? t('search.requestedTo', { name: target.name }) : t('search.requested'));
      router.back();
    } catch (e) {
      toast(e instanceof ApiError && e.detail ? e.detail : t('search.requestFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.headerButton}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={styles.title}>{t('youtube.title')}</Text>
          <View style={{ minWidth: 50 }} />
        </View>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <Text style={styles.hint}>{t('youtube.hint')}</Text>
            <View style={styles.linkRow}>
              <TextInput
                value={url}
                onChangeText={setUrl}
                onSubmitEditing={find}
                placeholder="https://youtu.be/..."
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={!params.url}
                keyboardType="url"
                textContentType="URL"
                returnKeyType="search"
                clearButtonMode="while-editing"
                style={[styles.input, { flex: 1 }]}
              />
              <Pressable
                onPress={find}
                disabled={finding || !url.trim()}
                accessibilityLabel={t('youtube.find')}
                style={({ pressed }) => [styles.findButton, { backgroundColor: accent }, (pressed || !url.trim()) && { opacity: 0.6 }]}
              >
                {finding ? <ActivityIndicator color={colors.bg} /> : <Symbol name="magnifyingglass" fallback="search" size={18} color={colors.bg} />}
              </Pressable>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {track ? (
              <>
                <Glass style={styles.card}>
                  <View style={styles.preview}>
                    <Cover path={track.cover_url} size={72} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.previewTitle} numberOfLines={2}>
                        {track.title || '-'}
                      </Text>
                      <Text style={styles.previewSub} numberOfLines={1}>
                        {[track.artist, track.duration ? formatTime(track.duration) : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </View>
                  {track.in_jellyfin ? (
                    <Pressable
                      onPress={() => openInLibrary({ jellyfinId: track.jellyfin_id, title: track.title, artist: track.artist })}
                      style={styles.inLibrary}
                    >
                      <Symbol name="checkmark.circle.fill" fallback="checkmark-circle" size={16} color={accent} />
                      <Text style={[styles.inLibraryText, { color: accent }]}>{t('youtube.alreadyInLibrary')}</Text>
                      <Symbol name="chevron.right" fallback="chevron-forward" size={12} color={colors.textTertiary} />
                    </Pressable>
                  ) : null}
                  <Text style={styles.fieldHint}>{t('youtube.checkFields')}</Text>
                  <Field label={t('youtube.songTitle')} value={track.title} onChange={(v) => edit('title', v)} />
                  <Field label={t('youtube.artist')} value={track.artist} onChange={(v) => edit('artist', v)} />
                  <Field label={t('youtube.album')} value={track.album} placeholder={t('youtube.albumPlaceholder')} onChange={(v) => edit('album', v)} />
                </Glass>
                {isGuest ? null : <RequestTargetPicker />}
                <AccentButton
                  label={t('search.request')}
                  icon="cloud-download-outline"
                  onPress={request}
                  loading={sending}
                  disabled={!track.title.trim() || !track.artist.trim()}
                  style={{ marginHorizontal: 16, marginTop: 12 }}
                />
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  headerButton: { color: colors.text, fontSize: 17, minWidth: 50 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  scroll: { paddingBottom: 40 },
  hint: { color: colors.textSecondary, fontSize: 14, lineHeight: 19, paddingHorizontal: 18, paddingVertical: 8 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 4 },
  input: {
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  findButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.warning, fontSize: 14, lineHeight: 19, paddingHorizontal: 18, paddingTop: 12 },
  card: { marginHorizontal: 16, marginTop: 18, padding: 14, gap: 10 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  previewSub: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
  inLibrary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  inLibraryText: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  fieldHint: { color: colors.textTertiary, fontSize: 13, lineHeight: 17 },
  field: { gap: 4 },
  fieldLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginLeft: 2 },
});
