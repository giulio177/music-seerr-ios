import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { absoluteUrl, authHeaders, serverPath } from '@/lib/api';
import { radius } from '@/lib/theme';

/**
 * Artwork URLs that failed recently (songs without a cover): not requested again on every mount, but tried
 * again after a while, since Jellyfin adds the artwork of a song just added to the library a little later.
 */
const failedAt = new Map<string, number>();
const RETRY_MS = 2 * 60 * 1000;

function recentlyFailed(uri: string) {
  const at = failedAt.get(uri);
  if (at === undefined) return false;
  if (Date.now() - at < RETRY_MS) return true;
  failedAt.delete(uri);
  return false;
}

/** Ordered candidate artwork URIs for native previews (local file first, then server/fallback). */
export function coverCandidateUrls(path?: string | null, local?: string | null, fallback?: string | null): string[] {
  return [local, path, fallback]
    .filter((uri): uri is string => !!uri)
    .map((uri) => {
      if (uri === local) return uri;
      const server = serverPath(uri);
      return server ? absoluteUrl(server) : uri;
    })
    .filter((uri) => !recentlyFailed(uri));
}

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
    .find((candidate) => !failed.includes(candidate.uri) && !recentlyFailed(candidate.uri));
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
          onError={() => {
            if (!source.uri.startsWith('file:')) failedAt.set(source.uri, Date.now());
            setFailed((prev) => [...prev, source.uri]);
          }}
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
