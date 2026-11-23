import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePlayer, useCurrentItem } from '@/lib/player';
import { colors, useAccent } from '@/lib/theme';
import { TabBarSearchPinView } from '../../modules/system-audio';
import { Cover } from './Cover';
import { SwipeArea } from './SwipeArea';
import { IconButton } from './ui';

/**
 * Now playing strip, shown as the native tab bar's bottom accessory. Tap opens the full player.
 * `regular` sits above the full tab bar; `inline` is the compact form iOS puts between the minimized
 * tab and Search after a scroll down (title and play only, like Apple Music).
 */
export function MiniPlayer() {
  const { t } = useTranslation();
  const inline = NativeTabs.BottomAccessory.usePlacement() === 'inline';
  const item = useCurrentItem();
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const progress = usePlayer((s) => (s.duration > 0 ? Math.min(1, s.position / s.duration) : 0));
  const { accent } = useAccent();
  const [x] = useState(() => new Animated.Value(0));

  // Swipe left for the next song, right for the previous one (the strip follows the finger).
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => x.setValue(g.dx * 0.6),
        onPanResponderRelease: (_, g) => {
          const { queue, index, repeat } = usePlayer.getState();
          if ((g.dx < -50 || g.vx < -0.5) && (index < queue.length - 1 || repeat === 'all')) usePlayer.getState().next();
          else if ((g.dx > 50 || g.vx > 0.5) && index > 0) usePlayer.getState().skipTo(index - 1);
          Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [x],
  );

  return (
    <SwipeArea style={styles.wrap} {...responder.panHandlers}>
      {TabBarSearchPinView ? <TabBarSearchPinView collapsable={false} pointerEvents="none" style={styles.pin} /> : null}
      <Pressable testID="mini-player" style={styles.wrap} onPress={() => item && router.push('/player')} accessibilityRole="button">
        <Animated.View style={[styles.slide, { transform: [{ translateX: x }] }]}>
          <Cover path={item?.cover} local={item?.coverLocal} fallback={item?.coverFallback} size={inline ? 30 : 36} />
          <View style={styles.meta}>
            <Text numberOfLines={1} style={styles.title}>
              {item?.title ?? t('player.nothing')}
            </Text>
            {item && !inline ? (
              <Text numberOfLines={1} style={styles.artist}>
                {item.artist}
              </Text>
            ) : null}
          </View>
          {buffering && playing ? (
            <ActivityIndicator color={colors.text} style={{ width: 36 }} />
          ) : (
            <IconButton
              icon={playing ? 'pause' : 'play'}
              label={playing ? 'Pause' : 'Play'}
              onPress={() => usePlayer.getState().toggle()}
            />
          )}
          {inline ? null : <IconButton icon="play-forward" label="Next" onPress={() => usePlayer.getState().next()} />}
        </Animated.View>
        <View style={[styles.progress, inline && styles.progressInline, { width: `${progress * 100}%`, backgroundColor: accent }]} />
      </Pressable>
    </SwipeArea>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', overflow: 'hidden' },
  pin: { position: 'absolute', width: 0, height: 0 },
  slide: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  meta: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  artist: { color: colors.textSecondary, fontSize: 12 },
  progress: { position: 'absolute', left: 0, bottom: 0, height: 2, borderRadius: 1 },
  // Inside the pill between the minimized tab and Search: inset so the rounded ends do not clip it.
  progressInline: { left: 14, bottom: 3, maxWidth: '88%' },
});
