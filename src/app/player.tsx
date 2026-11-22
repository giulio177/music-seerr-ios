import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Cover } from '@/components/Cover';
import { Symbol } from '@/components/Symbol';
import { Backdrop } from '@/components/ui';
import { formatTime } from '@/lib/format';
import { parseLrc, useLyrics } from '@/lib/lyrics';
import { usePlayer, useCurrentItem, type QueueItem } from '@/lib/player';
import { colors, useAccent, withAlpha } from '@/lib/theme';
import { RoutePickerView, SystemVolumeView } from '../../modules/system-audio';

type Panel = 'cover' | 'lyrics' | 'queue';

/** Full screen player, laid out like Apple Music: artwork, title, thin scrubber, controls, volume, and three buttons. */
export default function Player() {
  const item = useCurrentItem();
  const { accent } = useAccent();
  const [panel, setPanel] = useState<Panel>('cover');

  useEffect(() => {
    if (!item) router.back();
  }, [item]);

  if (!item) return null;

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <LinearGradient colors={[withAlpha(accent, 0.28), 'transparent']} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.grabber} />
        {panel === 'cover' ? (
          <>
            <CoverPanel item={item} />
            <TitleRow item={item} />
          </>
        ) : (
          <>
            <CompactHeader item={item} />
            {panel === 'queue' ? <QueuePanel /> : <LyricsPanel item={item} />}
          </>
        )}
        <Scrubber />
        <Controls />
        <VolumeRow />
        <BottomBar panel={panel} onChange={setPanel} />
      </SafeAreaView>
    </View>
  );
}

/** Leaves the modal, then opens a page in the current tab. */
function goTo(path: string) {
  router.back();
  setTimeout(() => router.push(path as never), 250);
}

function openMenu(item: QueueItem, t: (key: string) => string) {
  const actions: { label: string; run: () => void }[] = [];
  if (item.albumId) actions.push({ label: t('player.goToAlbum'), run: () => goTo(`/album/${item.albumId}`) });
  if (item.artistId) actions.push({ label: t('player.goToArtist'), run: () => goTo(`/artist/${item.artistId}`) });
  if (!actions.length) return;
  ActionSheetIOS.showActionSheetWithOptions(
    { options: [...actions.map((a) => a.label), t('common.cancel')], cancelButtonIndex: actions.length, title: item.title, message: item.artist },
    (index) => actions[index]?.run(),
  );
}

/** Artwork; swipe left for the next song, right for the previous one. */
function CoverPanel({ item }: { item: QueueItem }) {
  const { width } = useWindowDimensions();
  const playing = usePlayer((s) => s.playing);
  const size = width - 56;
  const [x] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(playing ? 1 : 0.86));

  useEffect(() => {
    Animated.spring(scale, { toValue: playing ? 1 : 0.86, useNativeDriver: true, bounciness: 6 }).start();
  }, [playing, scale]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Horizontal drags only, so the vertical drag still closes the sheet.
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_, g) => x.setValue(g.dx),
        onPanResponderRelease: (_, g) => {
          const { queue, index, repeat } = usePlayer.getState();
          const hasNext = index < queue.length - 1 || repeat === 'all';
          const hasPrevious = index > 0;
          const goNext = (g.dx < -80 || g.vx < -0.6) && hasNext;
          const goPrevious = (g.dx > 80 || g.vx > 0.6) && hasPrevious;
          if (!goNext && !goPrevious) {
            Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
            return;
          }
          const out = goNext ? -width : width;
          Animated.timing(x, { toValue: out, duration: 160, useNativeDriver: true }).start(() => {
            if (goNext) usePlayer.getState().next();
            else usePlayer.getState().skipTo(index - 1);
            // The new artwork slides in from the other side.
            x.setValue(-out);
            Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          });
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [width, x],
  );

  return (
    <View style={styles.coverWrap} {...responder.panHandlers}>
      <Animated.View style={{ transform: [{ translateX: x }, { scale }] }}>
        <Cover path={item.cover} local={item.coverLocal} fallback={item.coverFallback} size={size} shadow />
      </Animated.View>
    </View>
  );
}

function TitleRow({ item }: { item: QueueItem }) {
  const { t } = useTranslation();
  const { accent } = useAccent();
  return (
    <View style={styles.info}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.title}>
          {item.title}
        </Text>
        <Pressable disabled={!item.artistId} onPress={() => item.artistId && goTo(`/artist/${item.artistId}`)}>
          <Text numberOfLines={1} style={styles.artist}>
            {item.artist}
          </Text>
        </Pressable>
      </View>
      {item.kind === 'preview' ? <Text style={[styles.previewTag, { color: accent, borderColor: accent }]}>{t('player.preview')}</Text> : null}
      <MoreButton item={item} />
    </View>
  );
}

function MoreButton({ item }: { item: QueueItem }) {
  const { t } = useTranslation();
  if (!item.albumId && !item.artistId) return null;
  return (
    <Pressable onPress={() => openMenu(item, t)} hitSlop={10} style={styles.more} accessibilityLabel={t('common.more')}>
      <Symbol name="ellipsis" fallback="ellipsis-horizontal" size={18} color={colors.text} />
    </Pressable>
  );
}

/** Small artwork and title above the lyrics and the queue (the big artwork makes room for them). */
function CompactHeader({ item }: { item: QueueItem }) {
  return (
    <View style={styles.compact}>
      <Cover path={item.cover} local={item.coverLocal} fallback={item.coverFallback} size={64} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.compactTitle}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={styles.compactArtist}>
          {item.artist}
        </Text>
      </View>
      <MoreButton item={item} />
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

  if (loading) {
    return (
      <View style={[styles.panel, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }
  if (!lines.length && !lyrics?.plain) {
    return (
      <View style={[styles.panel, { justifyContent: 'center' }]}>
        <Text style={styles.empty}>{t('player.noLyrics')}</Text>
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
      contentContainerStyle={{ paddingVertical: 80 }}
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

/** Up next, with shuffle and repeat on top (like Apple Music's queue). */
function QueuePanel() {
  const { t } = useTranslation();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const upcoming = queue.slice(index + 1);
  return (
    <View style={styles.panel}>
      <View style={styles.pills}>
        <Pill
          symbol="shuffle"
          fallback="shuffle"
          active={shuffle}
          label={t('player.shuffle')}
          onPress={() => usePlayer.getState().toggleShuffle()}
        />
        <Pill
          symbol={repeat === 'single' ? 'repeat.1' : 'repeat'}
          fallback="repeat"
          active={repeat !== 'none'}
          label={t('player.repeat')}
          onPress={() => usePlayer.getState().cycleRepeat()}
        />
      </View>
      <FlatList
        data={upcoming}
        keyExtractor={(q) => q.key}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={upcoming.length ? <Text style={styles.queueTitle}>{t('player.queue')}</Text> : undefined}
        ListEmptyComponent={<Text style={styles.empty}>{t('player.queueEmpty')}</Text>}
        renderItem={({ item: q, index: i }) => (
          <Pressable onPress={() => usePlayer.getState().skipTo(index + 1 + i)} style={styles.queueRow}>
            <Cover path={q.cover} local={q.coverLocal} fallback={q.coverFallback} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.queueSong}>
                {q.title}
              </Text>
              <Text numberOfLines={1} style={styles.queueArtist}>
                {q.artist}
              </Text>
            </View>
            <Pressable onPress={() => usePlayer.getState().removeAt(index + 1 + i)} hitSlop={10} accessibilityLabel={t('player.remove')}>
              <Symbol name="minus.circle" fallback="remove-circle-outline" size={20} color={colors.textSecondary} />
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  );
}

function Pill({
  symbol,
  fallback,
  active,
  label,
  onPress,
}: {
  symbol: 'shuffle' | 'repeat' | 'repeat.1';
  fallback: 'shuffle' | 'repeat';
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.pill, active && styles.pillActive, pressed && { opacity: 0.7 }]}
    >
      <Symbol name={symbol} fallback={fallback} size={20} color={active ? colors.text : 'rgba(255,255,255,0.55)'} />
    </Pressable>
  );
}

/** Drag state of the scrubber, read only by its gesture callbacks (one player exists at a time). */
const drag = { width: 1, start: 0 };

function beginDrag() {
  drag.start = usePlayer.getState().position;
  return drag.start;
}

function setTrackWidth(width: number) {
  drag.width = Math.max(1, width);
}

/** Apple Music style scrubber: a thin bar without knob that thickens while dragged; drags are relative. */
function Scrubber() {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = Math.min(dragging ?? position, duration || 0);
  const progress = duration > 0 ? shown / duration : 0;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          setDragging(beginDrag());
        },
        onPanResponderMove: (_, g) => {
          const total = usePlayer.getState().duration;
          setDragging(Math.max(0, Math.min(total, drag.start + (g.dx / drag.width) * total)));
        },
        onPanResponderRelease: (_, g) => {
          const total = usePlayer.getState().duration;
          const value = Math.max(0, Math.min(total, drag.start + (g.dx / drag.width) * total));
          if (Math.abs(g.dx) > 2) usePlayer.getState().seek(value);
          setTimeout(() => setDragging(null), 300);
        },
        onPanResponderTerminate: () => setDragging(null),
      }),
    [],
  );

  const active = dragging !== null;
  return (
    <View style={styles.scrubber}>
      <View
        style={styles.trackTouch}
        onLayout={(e) => {
          setTrackWidth(e.nativeEvent.layout.width);
        }}
        {...responder.panHandlers}
      >
        <View style={[styles.track, active && styles.trackActive]}>
          <View style={[styles.trackFill, { width: `${progress * 100}%` }, active && { backgroundColor: colors.text }]} />
        </View>
      </View>
      <View style={styles.times}>
        <Text style={[styles.time, active && { color: colors.textSecondary }]}>{formatTime(shown)}</Text>
        <Text style={[styles.time, active && { color: colors.textSecondary }]}>-{formatTime(Math.max(0, duration - shown))}</Text>
      </View>
    </View>
  );
}

function Controls() {
  const { t } = useTranslation();
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  return (
    <View style={styles.controls}>
      <Pressable onPress={() => usePlayer.getState().previous()} hitSlop={14} accessibilityLabel={t('player.previous')} style={pressedStyle}>
        <Symbol name="backward.fill" fallback="play-back" size={36} color={colors.text} />
      </Pressable>
      <Pressable
        onPress={() => usePlayer.getState().toggle()}
        hitSlop={14}
        accessibilityLabel={playing ? t('player.pause') : t('player.play')}
        style={({ pressed }) => [styles.playButton, { opacity: pressed ? 0.5 : 1 }]}
      >
        {buffering && playing ? (
          <ActivityIndicator color={colors.text} size="large" />
        ) : (
          <Symbol name={playing ? 'pause.fill' : 'play.fill'} fallback={playing ? 'pause' : 'play'} size={46} color={colors.text} />
        )}
      </Pressable>
      <Pressable onPress={() => usePlayer.getState().next()} hitSlop={14} accessibilityLabel={t('player.next')} style={pressedStyle}>
        <Symbol name="forward.fill" fallback="play-forward" size={36} color={colors.text} />
      </Pressable>
    </View>
  );
}

const pressedStyle = ({ pressed }: { pressed: boolean }) => ({ opacity: pressed ? 0.5 : 1 });

/** System volume (moves with the hardware buttons); hidden in builds without the native module. */
function VolumeRow() {
  if (!SystemVolumeView) return <View style={{ height: 12 }} />;
  return (
    <View style={styles.volume}>
      <Symbol name="speaker.fill" fallback="volume-low" size={13} color={colors.textTertiary} />
      <SystemVolumeView style={{ flex: 1, height: 34 }} minimumTrackColor="rgba(255,255,255,0.8)" maximumTrackColor="rgba(255,255,255,0.22)" />
      <Symbol name="speaker.wave.3.fill" fallback="volume-high" size={15} color={colors.textTertiary} />
    </View>
  );
}

function BottomBar({ panel, onChange }: { panel: Panel; onChange: (panel: Panel) => void }) {
  const { t } = useTranslation();
  const toggle = (target: Panel) => onChange(panel === target ? 'cover' : target);
  return (
    <View style={styles.bottomBar}>
      <BarButton active={panel === 'lyrics'} label={t('player.lyrics')} onPress={() => toggle('lyrics')}>
        <Symbol name="quote.bubble" fallback="chatbox-ellipses-outline" size={22} color={panel === 'lyrics' ? colors.bg : colors.textSecondary} />
      </BarButton>
      <View style={styles.barButton}>
        {RoutePickerView ? <RoutePickerView style={{ width: 30, height: 30 }} tint={colors.textSecondary} activeTint={colors.text} /> : null}
      </View>
      <BarButton active={panel === 'queue'} label={t('player.queue')} onPress={() => toggle('queue')}>
        <Symbol name="list.bullet" fallback="list" size={22} color={panel === 'queue' ? colors.bg : colors.textSecondary} />
      </BarButton>
    </View>
  );
}

function BarButton({ active, label, onPress, children }: { active: boolean; label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.barButton, active && styles.barButtonActive]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 28 },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', marginTop: 10, marginBottom: 8 },
  coverWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panel: { flex: 1 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  artist: { color: colors.textSecondary, fontSize: 19, marginTop: 1 },
  previewTag: { fontSize: 11, fontWeight: '800', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  more: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8, marginBottom: 14 },
  compactTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  compactArtist: { color: colors.textSecondary, fontSize: 15, marginTop: 1 },
  pills: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  pill: { flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  pillActive: { backgroundColor: 'rgba(255,255,255,0.28)' },
  scrubber: { marginTop: 18 },
  trackTouch: { height: 28, justifyContent: 'center' },
  track: { height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.22)' },
  trackActive: { height: 12, borderRadius: 6 },
  trackFill: { height: '100%', backgroundColor: 'rgba(255,255,255,0.72)' },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: colors.textTertiary, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', marginTop: 18, marginBottom: 14 },
  playButton: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: 4 },
  barButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  barButtonActive: { backgroundColor: 'rgba(255,255,255,0.75)' },
  empty: { color: colors.textSecondary, fontSize: 16, textAlign: 'center', marginTop: 24 },
  plainLyrics: { color: colors.text, fontSize: 20, lineHeight: 32, fontWeight: '600', paddingVertical: 16 },
  lyricLine: { color: 'rgba(255,255,255,0.55)', fontSize: 26, fontWeight: '800', lineHeight: 34, paddingVertical: 8 },
  queueTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  queueSong: { color: colors.text, fontSize: 15, fontWeight: '500' },
  queueArtist: { color: colors.textSecondary, fontSize: 13 },
});
