import { Ionicons } from '@expo/vector-icons';
import { requireOptionalNativeModule } from 'expo';
import type { SFSymbol } from 'expo-symbols';
import type { ComponentType } from 'react';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

// Builds made before expo-symbols was added fall back to the closest Ionicons glyph. The module is loaded
// only when its native side exists: importing it in an older build fails at load time.
const SymbolView: ComponentType<Record<string, unknown>> | null = requireOptionalNativeModule('SymbolModule')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('expo-symbols').SymbolView
  : null;

/** SF Symbol (exactly Apple's glyphs), with an Ionicons fallback for older builds. */
export function Symbol({
  name,
  fallback,
  size,
  color,
  style,
}: {
  name: SFSymbol;
  fallback: keyof typeof Ionicons.glyphMap;
  size: number;
  color: ColorValue;
  style?: StyleProp<ViewStyle>;
}) {
  if (!SymbolView) return <Ionicons name={fallback} size={size} color={color as string} />;
  return <SymbolView name={name} size={size} tintColor={color} weight="semibold" resizeMode="scaleAspectFit" style={[{ width: size, height: size }, style]} />;
}
