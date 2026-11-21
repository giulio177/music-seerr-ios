import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { absoluteUrl, authHeaders } from '@/lib/api';
import { radius } from '@/lib/theme';

/**
 * Artwork. `path` is a backend path (`/api/jellyfin/image/...`, loaded with the session token)
 * or an absolute URL; `local` is a downloaded file and wins when present.
 */
export function Cover({
  path,
  local,
  size,
  round,
  style,
}: {
  path?: string | null;
  local?: string | null;
  size: number;
  round?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const borderRadius = round ? size / 2 : size > 120 ? radius.card : radius.cover;
  const isServer = !!path && path.startsWith('/');
  const source = local
    ? { uri: local }
    : path
      ? { uri: absoluteUrl(path), headers: isServer ? authHeaders() : undefined, cacheKey: isServer ? path : undefined }
      : null;
  return (
    <View style={[{ width: size, height: size, borderRadius, overflow: 'hidden' }, style]}>
      <LinearGradient colors={['#2b2036', '#1b1c27', '#161720']} style={[StyleSheet.absoluteFill, styles.center]}>
        <Ionicons name={round ? 'person' : 'musical-note'} size={size * 0.36} color="rgba(255,255,255,0.28)" />
      </LinearGradient>
      {source && !failed ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          cachePolicy="disk"
          recyclingKey={local ?? path ?? undefined}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
