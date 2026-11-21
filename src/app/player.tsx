import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Cover } from '@/components/Cover';
import { Backdrop, IconButton } from '@/components/ui';
import { formatTime } from '@/lib/format';
import { parseLrc, useLyrics } from '@/lib/lyrics';
import { usePlayer, useCurrentItem, type QueueItem } from '@/lib/player';
import { colors, useAccent, withAlpha } from '@/lib/theme';

type Panel = 'cover' | 'lyrics' | 'queue';

export default function Player() {
  const { t } = useTranslation();
  const item = useCurrentItem();
  const { accent } = useAccent();
  const [panel, setPanel] = useState<Panel>('cover');

  useEffect(() => {
    if (!item) router.back();
  }, [item]);

  if (!item) return null;

  const goTo = (path: string) => {
    router.back();
    setTimeout(() => router.push(path), 250);
  };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <LinearGradient colors={[withAlpha(accent, 0.25), 'transparent']} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.grabber} />
        {panel === 'cover' ? (
          <CoverPanel item={item} />
        ) : panel === 'lyrics' ? (
          <LyricsPanel item={item} />
        ) : (
          <QueuePanel />
        )}
        <View style={styles.info}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
            <Pressable disabled={!item.artistId} onPress={() => item.artistId && goTo(`/artist/${item.artistId}`)}>
              <Text numberOfLines={1} style={styles.artist}>{item.artist}</Text>
            </Pressable>
          </View>
          {item.kind === 'preview' ? <Text style={[styles.previewTag, { color: accent, borderColor: accent }]}>{t('player.preview')}</Text> : null}
          {item.albumId ? <IconButton icon="disc-outline" label="Album" onPress={() => goTo(`/album/${item.albumId}`)} /> : null}
        </View>
        <Scrubber />
        <Controls />
        <View style={styles.bottomBar}>
          <PanelToggle icon="chatbox-ellipses-outline" active={panel === 'lyrics'} label={t('player.lyrics')} onPress={() => setPanel(panel === 'lyrics' ? 'cover' : 'lyrics')} />
          <RepeatShuffle />
          <PanelToggle icon="list" active={panel === 'queue'} label={t('player.queue')} onPress={() => setPanel(panel === 'queue' ? 'cover' : 'queue')} />
        </View>
      </SafeAreaView>
    </View>
  );
}

function CoverPanel({ item }: { item: QueueItem }) {
  const { width } = useWindowDimensions();
  const playing = usePlayer((s) => s.playing);
  const size = width - 56;
  return (
    <View style={styles.coverWrap}>
      <View style={[styles.coverShadow, { transform: [{ scale: playing ? 1 : 0.86 }] }]}>
        <Cover path={item.coverLocal ? null : item.cover} local={item.coverLocal} size={size} />
      </View>
    </View>
  );
}

function LyricsPanel({ item }: { item: QueueItem }) {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const { lyrics, loading } = useLyrics(item);
  const position = usePlayer((s) => s.position);
  const synced = lyrics?.synced;
  const lines = useMemo(() => (synced ? parseLrc(synced) : []), [synced]);
  const listRef = useRef<FlatList>(null);
  let current = -1;
  for (let i = 0; i < lines.length && lines[i].time <= position + 0.3; i++) current = i;

  useEffect(() => {
    if (current >= 0) listRef.current?.scrollToIndex({ index: current, viewPosition: 0.35, animated: true });
  }, [current]);

  if (loading) return <View style={styles.panel}><ActivityIndicator color={colors.textSecondary} /></View>;
  if (!lines.length && !lyrics?.plain) {
    return (
      <View style={[styles.panel, { justifyContent: 'center' }]}>
        <Text style={styles.noLyrics}>{t('player.noLyrics')}</Text>
      </View>
    );
  }
  if (!lines.length) {
    return (
      <FlatList
        style={styles.panel}
        data={[lyrics!.plain!]}
        keyExtractor={() => 'plain'}
        renderItem={({ item: text }) => <Text style={styles.plainLyrics}>{text}</Text>}
      />
    );
  }
  return (
    <FlatList
      ref={listRef}
      style={styles.panel}
      data={lines}
      keyExtractor={(line, i) => `${i}:${line.time}`}
      contentContainerStyle={{ paddingVertical: 120 }}
      onScrollToIndexFailed={() => undefined}
      showsVerticalScrollIndicator={false}
      renderItem={({ item: line, index }) => (
        <Pressable onPress={() => usePlayer.getState().seek(line.time)}>
          <Text
            style={[
              styles.lyricLine,
              index === current ? { color: colors.text } : index < current ? { color: 'rgba(255,255,255,0.35)' } : null,
              index === current && { textShadowColor: withAlpha(accent, 0.8), textShadowRadius: 12 },
            ]}
          >
            {line.text || '♪'}
          </Text>
        </Pressable>
      )}
    />
  );
}

function QueuePanel() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const upcoming = queue.slice(index + 1);
  return (
    <FlatList
      style={styles.panel}
      data={upcoming}
      keyExtractor={(q) => q.key}
      ListHeaderComponent={<Text style={styles.queueTitle}>{t('player.queue')}</Text>}
      ListEmptyComponent={<Text style={styles.noLyrics}>{t('player.queueEmpty')}</Text>}
      renderItem={({ item: q, index: i }) => (
        <Pressable onPress={() => usePlayer.getState().skipTo(index + 1 + i)} style={styles.queueRow}>
          <Cover path={q.coverLocal ? null : q.cover} local={q.coverLocal} size={42} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={styles.queueSong}>{q.title}</Text>
            <Text numberOfLines={1} style={styles.queueArtist}>{q.artist}</Text>
          </View>
          <IconButton icon="remove-circle-outline" size={20} color={withAlpha(accent, 0.9)} label="Remove" onPress={() => usePlayer.getState().removeAt(index + 1 + i)} />
        </Pressable>
      )}
    />
  );
}

function Scrubber() {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const { accent } = useAccent();
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? position;
  return (
    <View style={styles.scrubber}>
      <Slider
        minimumValue={0}
        maximumValue={Math.max(duration, 1)}
        value={shown}
        minimumTrackTintColor={accent}
        maximumTrackTintColor="rgba(255,255,255,0.18)"
        thumbTintColor={colors.text}
        onValueChange={setDragging}
        onSlidingComplete={(value) => {
          usePlayer.getState().seek(value);
          setTimeout(() => setDragging(null), 400);
        }}
      />
      <View style={styles.times}>
        <Text style={styles.time}>{formatTime(shown)}</Text>
        <Text style={styles.time}>-{formatTime(Math.max(0, duration - shown))}</Text>
      </View>
    </View>
  );
}

function Controls() {
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const { accent, accent2 } = useAccent();
  return (
    <View style={styles.controls}>
      <IconButton icon="play-back" size={36} label="Previous" onPress={() => usePlayer.getState().previous()} />
      <Pressable onPress={() => usePlayer.getState().toggle()} accessibilityLabel={playing ? 'Pause' : 'Play'}>
        <LinearGradient colors={[accent, accent2]} style={styles.playButton}>
          {buffering && playing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name={playing ? 'pause' : 'play'} size={38} color="#fff" style={!playing && { marginLeft: 4 }} />
          )}
        </LinearGradient>
      </Pressable>
      <IconButton icon="play-forward" size={36} label="Next" onPress={() => usePlayer.getState().next()} />
    </View>
  );
}

function RepeatShuffle() {
  const { t } = useTranslation();
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const { accent } = useAccent();
  return (
    <View style={{ flexDirection: 'row', gap: 26 }}>
      <PanelToggle icon="shuffle" active={shuffle} label={t('player.shuffle')} onPress={() => usePlayer.getState().toggleShuffle()} />
      <View>
        <PanelToggle icon="repeat" active={repeat !== 'none'} label={t('player.repeat')} onPress={() => usePlayer.getState().cycleRepeat()} />
        {repeat === 'single' ? <Text style={[styles.repeatOne, { color: accent }]}>1</Text> : null}
      </View>
    </View>
  );
}

function PanelToggle({ icon, active, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; active: boolean; label: string; onPress: () => void }) {
  const { accent } = useAccent();
  return (
    <Pressable
      testID={`player-${icon}`}
      onPress={onPress}
      hitSlop={10}
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.toggle, active && { backgroundColor: withAlpha(accent, 0.2) }]}
    >
      <Ionicons name={icon} size={22} color={active ? accent : colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 24 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 10, marginBottom: 8 },
  coverWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverShadow: { shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 30, shadowOffset: { width: 0, height: 18 } },
  panel: { flex: 1 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  artist: { color: colors.textSecondary, fontSize: 18, marginTop: 2 },
  previewTag: { fontSize: 11, fontWeight: '800', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  scrubber: { marginTop: 12 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  time: { color: colors.textTertiary, fontSize: 12, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', marginVertical: 16 },
  playButton: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  bottomBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  toggle: { padding: 8, borderRadius: 10 },
  repeatOne: { position: 'absolute', right: 2, top: 0, fontSize: 10, fontWeight: '900' },
  noLyrics: { color: colors.textSecondary, fontSize: 16, textAlign: 'center', marginTop: 24 },
  plainLyrics: { color: colors.text, fontSize: 20, lineHeight: 32, fontWeight: '600', paddingVertical: 16 },
  lyricLine: { color: 'rgba(255,255,255,0.55)', fontSize: 26, fontWeight: '800', lineHeight: 34, paddingVertical: 8 },
  queueTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8, marginTop: 8 },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  queueSong: { color: colors.text, fontSize: 15, fontWeight: '500' },
  queueArtist: { color: colors.textSecondary, fontSize: 13 },
});
