import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePlayer, useCurrentItem } from '@/lib/player';
import { colors, useAccent } from '@/lib/theme';
import { Cover } from './Cover';
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

  return (
    <Pressable testID="mini-player" style={styles.wrap} onPress={() => item && router.push('/player')} accessibilityRole="button">
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
        <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onPress={() => usePlayer.getState().toggle()} />
      )}
      {inline ? null : <IconButton icon="play-forward" label="Next" onPress={() => usePlayer.getState().next()} />}
      {inline ? null : <View style={[styles.progress, { width: `${progress * 100}%`, backgroundColor: accent }]} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  meta: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  artist: { color: colors.textSecondary, fontSize: 12 },
  progress: { position: 'absolute', left: 0, bottom: 0, height: 2, borderRadius: 1 },
});
