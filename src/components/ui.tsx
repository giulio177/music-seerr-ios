import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radius, useAccent, withAlpha } from '@/lib/theme';

/** Dark backdrop with two soft accent glows, shared by every screen. */
export function Backdrop() {
  const { accent, accent2 } = useAccent();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} />
      <LinearGradient
        colors={[withAlpha(accent, 0.22), 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 0.45 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['transparent', withAlpha(accent2, 0.14)]}
        start={{ x: 0.2, y: 0.55 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** Frosted glass surface with a hairline border. */
export function Glass({ children, style, intensity = 30 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; intensity?: number }) {
  return (
    <View style={[styles.glass, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassFill }]} />
      {children}
    </View>
  );
}

export function AccentButton({
  label,
  icon,
  onPress,
  disabled,
  loading,
  variant = 'solid',
  style,
  testID,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'solid' | 'glass';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { accent, accent2 } = useAccent();
  const content = (
    <View style={styles.buttonInner}>
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={variant === 'solid' ? '#fff' : accent} />}
          <Text style={[styles.buttonLabel, variant === 'glass' && { color: colors.text }]}>{label}</Text>
        </>
      )}
    </View>
  );
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}
    >
      {variant === 'solid' ? (
        <LinearGradient colors={[accent, accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonFill}>
          {content}
        </LinearGradient>
      ) : (
        <Glass style={styles.buttonFill}>{content}</Glass>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  size = 24,
  color = colors.text,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  size?: number;
  color?: string;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function Loading() {
  const { accent } = useAccent();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={accent} />
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: keyof typeof Ionicons.glyphMap; title?: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={44} color={colors.textTertiary} />
      {title ? <Text style={styles.emptyTitle}>{title}</Text> : null}
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action}
    </View>
  );
}

/** Offline mode placeholder for screens that need the server; Retry checks the server again. */
export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const retry = async () => {
    setChecking(true);
    await useAuth.getState().verify();
    setChecking(false);
    onRetry?.();
  };
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title={t('errors.offlineTitle')}
      body={t('errors.offlineBody')}
      action={
        <View style={{ gap: 10, marginTop: 16, alignSelf: 'stretch' }}>
          <AccentButton label={t('errors.openDownloads')} icon="arrow-down-circle" onPress={() => router.navigate('/(tabs)/(offline)/offline')} />
          <AccentButton label={t('common.retry')} variant="glass" loading={checking} onPress={retry} />
        </View>
      }
    />
  );
}

/** Error view: offline errors show the offline mode. */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const { t } = useTranslation();
  if (error.offline) return <OfflineState onRetry={onRetry} />;
  return (
    <EmptyState
      icon="alert-circle-outline"
      title={t('common.unknownError')}
      body={error.detail}
      action={<AccentButton label={t('common.retry')} variant="glass" onPress={onRetry} style={{ marginTop: 16, alignSelf: 'stretch' }} />}
    />
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.section}>{children}</Text>;
}

export const styles = StyleSheet.create({
  glass: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  button: { borderRadius: radius.pill, overflow: 'hidden' },
  buttonFill: { borderRadius: radius.pill, minHeight: 46, justifyContent: 'center', paddingHorizontal: 20 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  emptyBody: { color: colors.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  section: { color: colors.text, fontSize: 20, fontWeight: '700', marginTop: 20, marginBottom: 8, paddingHorizontal: 16 },
});
