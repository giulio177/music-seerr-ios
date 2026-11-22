import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { absoluteUrl, authHeaders, serverPath } from '@/lib/api';
import { radius } from '@/lib/theme';

/**
 * Artwork. `path` is a backend path (`/api/jellyfin/image/...`) or an absolute URL; server images load with
 * the session token. `local` is a downloaded file and wins when present; `fallback` (usually the album
 * artwork) is tried when the others fail.
 */
export function Cover({
  path,
  local,
  fallback,
  size,
  round,
  shadow,
  style,
}: {
  path?: string | null;
  local?: string | null;
  fallback?: string | null;
  size: number;
  round?: boolean;
  /** Drop shadow, drawn by a solid outer view so iOS can compute it from the rounded shape. */
  shadow?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  // URIs that failed to load; the next candidate is tried.
  const [failed, setFailed] = useState<string[]>([]);
  const borderRadius = round ? size / 2 : size > 120 ? radius.card : radius.cover;
  const source = [local, path, fallback]
    .filter((uri): uri is string => !!uri)
    .map((uri) => {
      if (uri === local) return { uri };
      const server = serverPath(uri);
      return server ? { uri: absoluteUrl(server), headers: authHeaders(), cacheKey: server } : { uri };
    })
    .find((candidate) => !failed.includes(candidate.uri));
  const box = { width: size, height: size, borderRadius };
  const art = (
    <View style={[box, { overflow: 'hidden' }, shadow ? null : style]}>
      <LinearGradient colors={['#2b2036', '#1b1c27', '#161720']} style={[StyleSheet.absoluteFill, styles.center]}>
        <Ionicons name={round ? 'person' : 'musical-note'} size={size * 0.36} color="rgba(255,255,255,0.28)" />
      </LinearGradient>
      {source ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          cachePolicy="disk"
          recyclingKey={source.uri}
          onError={() => setFailed((prev) => [...prev, source.uri])}
        />
      ) : null}
    </View>
  );
  return shadow ? <View style={[box, styles.shadow, style]}>{art}</View> : art;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  shadow: {
    backgroundColor: '#161720',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
});
