import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Symbol } from '@/components/Symbol';
import { toast } from '@/components/Toast';
import { Backdrop } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { setCachedLyrics } from '@/lib/lyrics';
import { useOffline } from '@/lib/offline';
import { exactPosition, usePlayer } from '@/lib/player';
import { colors, useAccent, withAlpha } from '@/lib/theme';

/** One lyric line; `time` is null until the line gets a timestamp. */
type Line = { key: number; time: number | null; text: string };

const STAMP = /\[(\d+):(\d+(?:[.,]\d+)?)\]/g;
const TAG = /^\[[a-z]+:.*\]$/i;

let nextKey = 1;

/** Splits an `.lrc` into tag lines (`[ar:...]`, kept as they are) and lyric lines; plain text becomes untimed lines. */
function parse(content: string): { tags: string[]; lines: Line[] } {
  const tags: string[] = [];
  const lines: Line[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (TAG.test(trimmed)) {
      tags.push(trimmed);
      continue;
    }
    const stamps = [...trimmed.matchAll(STAMP)];
    const text = trimmed.replace(/\[[^\]]*\]/g, '').trim();
    if (!stamps.length) lines.push({ key: nextKey++, time: null, text });
    for (const stamp of stamps) lines.push({ key: nextKey++, time: Number(stamp[1]) * 60 + Number(stamp[2].replace(',', '.')), text });
  }
  return { tags, lines };
}

function stamp(time: number) {
  const t = Math.max(0, Math.round(time * 100) / 100);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function serialize(tags: string[], lines: Line[]) {
  return [...tags, ...lines.map((line) => `[${stamp(line.time ?? 0)}]${line.text}`)].join('\n') + '\n';
}

/**
 * Beta lyrics editor for the song playing now (Settings > Beta): every line has a time; the clock sets it to the
 * current playback moment and selects the next line, the arrows move it by a tenth of a second, and the bar on top
 * shifts the whole song. Saves the `.lrc` next to the library file (`PUT /api/library/lyrics/{id}`).
 */
export default function LyricsEditor() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => s.position);
  const [tags, setTags] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Line>>(null);
  const otherSong = currentId !== id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ exists: boolean; content: string | null }>(`/api/library/lyrics/${id}`);
        let content = res.content ?? '';
        if (!content.trim()) {
          // No sidecar yet: start from the lyrics the server finds (synced or plain).
          const found = await api<{ synced?: string | null; plain?: string | null }>(`/api/jellyfin/track-lyrics/${id}`).catch(() => null);
          content = found?.synced || found?.plain || '';
        }
        if (cancelled) return;
        const parsed = parse(content);
        setTags(parsed.tags);
        setLines(parsed.lines);
        const firstUntimed = parsed.lines.findIndex((line) => line.time === null);
        setSelected(firstUntimed >= 0 ? firstUntimed : 0);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError && e.status === 403 ? t('lyricsEditor.notAllowed') : t('lyricsEditor.loadFailed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  const current = useMemo(() => {
    if (!lines || otherSong) return -1;
    let index = -1;
    lines.forEach((line, i) => {
      if (line.time !== null && line.time <= position + 0.2) index = i;
    });
    return index;
  }, [lines, position, otherSong]);

  const update = (next: Line[]) => {
    setLines(next);
    setDirty(true);
  };

  const setNow = (index: number) => {
    if (!lines || otherSong) return;
    const time = Math.round(exactPosition() * 100) / 100;
    update(lines.map((line, i) => (i === index ? { ...line, time } : line)));
    const next = Math.min(index + 1, lines.length - 1);
    setSelected(next);
    listRef.current?.scrollToIndex({ index: next, viewPosition: 0.4, animated: true });
  };

  const nudge = (index: number, delta: number) => {
    if (!lines) return;
    update(lines.map((line, i) => (i === index && line.time !== null ? { ...line, time: Math.max(0, line.time + delta) } : line)));
  };

  const shiftAll = (delta: number) => {
    if (!lines) return;
    update(lines.map((line) => (line.time === null ? line : { ...line, time: Math.max(0, line.time + delta) })));
  };

  const close = () => {
    if (!dirty) return router.back();
    Alert.alert(t('lyricsEditor.discardTitle'), t('lyricsEditor.discardBody'), [
      { text: t('lyricsEditor.keepEditing'), style: 'cancel' },
      { text: t('lyricsEditor.discard'), style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const save = async () => {
    if (!lines) return;
    const untimed = lines.filter((line) => line.time === null).length;
    if (untimed) {
      Alert.alert(t('lyricsEditor.untimedTitle'), t('lyricsEditor.untimedBody', { count: untimed }));
      return;
    }
    const sorted = [...lines].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    const content = serialize(tags, sorted);
    setSaving(true);
    try {
      await api(`/api/library/lyrics/${id}`, { method: 'PUT', body: { content } });
      setCachedLyrics(id, { found: true, synced: content, plain: null });
      useOffline.getState().updateLyrics(id, content);
      toast(t('lyricsEditor.saved'));
      router.back();
    } catch (e) {
      toast(e instanceof ApiError && e.offline ? t('track.playlistOffline') : t('lyricsEditor.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={close} hitSlop={10}>
            <Text style={styles.headerButton}>{t('common.cancel')}</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center', minWidth: 0 }}>
            <Text style={styles.title}>{t('lyricsEditor.title')}</Text>
            {title ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {title}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={save} disabled={saving || !lines || !dirty} hitSlop={10}>
            {saving ? (
              <ActivityIndicator color={accent} />
            ) : (
              <Text style={[styles.headerButton, { color: accent, fontWeight: '700' }, (!lines || !dirty) && { opacity: 0.4 }]}>
                {t('lyricsEditor.save')}
              </Text>
            )}
          </Pressable>
        </View>

        {otherSong ? <Text style={styles.warning}>{t('lyricsEditor.otherSong')}</Text> : <Text style={styles.hint}>{t('lyricsEditor.hint')}</Text>}

        <View style={styles.transport}>
          <Pressable
            disabled={otherSong}
            onPress={() => usePlayer.getState().toggle()}
            style={[styles.play, { backgroundColor: accent }, otherSong && { opacity: 0.4 }]}
            accessibilityLabel={playing ? t('player.pause') : t('player.play')}
          >
            <Symbol name={playing ? 'pause.fill' : 'play.fill'} fallback={playing ? 'pause' : 'play'} size={18} color={colors.bg} />
          </Pressable>
          <Text style={styles.clock}>{stamp(otherSong ? 0 : position)}</Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.shiftLabel}>{t('lyricsEditor.wholeSong')}</Text>
          <SmallButton label="-0.5" onPress={() => shiftAll(-0.5)} />
          <SmallButton label="+0.5" onPress={() => shiftAll(0.5)} />
        </View>

        {error ? (
          <Text style={[styles.warning, { marginTop: 24 }]}>{error}</Text>
        ) : !lines ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={colors.textSecondary} />
        ) : !lines.length ? (
          <Text style={[styles.hint, { marginTop: 24 }]}>{t('lyricsEditor.empty')}</Text>
        ) : (
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={40}>
            <FlatList
              ref={listRef}
              data={lines}
              keyExtractor={(line) => String(line.key)}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onScrollToIndexFailed={() => undefined}
              contentContainerStyle={{ paddingBottom: 120 }}
              renderItem={({ item, index }) => {
                const active = index === selected;
                return (
                  <Pressable
                    onPress={() => setSelected(index)}
                    style={[styles.line, active && { backgroundColor: withAlpha(accent, 0.12), borderColor: withAlpha(accent, 0.5) }]}
                  >
                    <View style={styles.lineTop}>
                      <Pressable
                        disabled={item.time === null || otherSong}
                        onPress={() => item.time !== null && usePlayer.getState().seek(item.time)}
                        hitSlop={6}
                      >
                        <Text style={[styles.time, index === current && { color: accent }, item.time === null && { color: colors.warning }]}>
                          {item.time === null ? '--:--.--' : stamp(item.time)}
                        </Text>
                      </Pressable>
                      <View style={{ flex: 1 }} />
                      <IconButton symbol="minus" fallback="remove" label="-0.1" onPress={() => nudge(index, -0.1)} />
                      <IconButton symbol="plus" fallback="add" label="+0.1" onPress={() => nudge(index, 0.1)} />
                      <IconButton
                        symbol="clock"
                        fallback="time-outline"
                        label={t('lyricsEditor.setNow')}
                        color={otherSong ? colors.textTertiary : accent}
                        onPress={() => setNow(index)}
                      />
                    </View>
                    <TextInput
                      value={item.text}
                      onChangeText={(text) => update(lines.map((line, i) => (i === index ? { ...line, text } : line)))}
                      onFocus={() => setSelected(index)}
                      placeholder={t('lyricsEditor.instrumental')}
                      placeholderTextColor={colors.textTertiary}
                      style={[styles.text, index === current && { color: colors.text }]}
                      multiline={false}
                    />
                  </Pressable>
                );
              }}
            />
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </View>
  );
}

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => [styles.small, pressed && { opacity: 0.6 }]}>
      <Text style={styles.smallText}>{label}</Text>
    </Pressable>
  );
}

function IconButton({
  symbol,
  fallback,
  label,
  color = colors.textSecondary,
  onPress,
}: {
  symbol: 'minus' | 'plus' | 'clock';
  fallback: 'remove' | 'add' | 'time-outline';
  label: string;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.icon, pressed && { opacity: 0.5 }]}>
      <Symbol name={symbol} fallback={fallback} size={18} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  headerButton: { color: colors.text, fontSize: 17 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 1 },
  hint: { color: colors.textSecondary, fontSize: 14, lineHeight: 19, paddingHorizontal: 18, paddingVertical: 6 },
  warning: { color: colors.warning, fontSize: 14, lineHeight: 19, paddingHorizontal: 18, paddingVertical: 6 },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 10 },
  play: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  clock: { color: colors.text, fontSize: 17, fontVariant: ['tabular-nums'], fontWeight: '600' },
  shiftLabel: { color: colors.textSecondary, fontSize: 13 },
  small: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' },
  smallText: { color: colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  line: { marginHorizontal: 12, marginVertical: 3, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { color: colors.textSecondary, fontSize: 14, fontVariant: ['tabular-nums'], fontWeight: '600' },
  icon: { width: 34, height: 30, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.textSecondary, fontSize: 17, fontWeight: '600', paddingVertical: 4 },
});
