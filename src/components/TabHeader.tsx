import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { Cover } from './Cover';

/**
 * Title row of a root tab screen, rendered inside its scroll view (the native header is hidden there):
 * large title on the left, the account picture on the right, which opens Settings (like Apple Music).
 */
export function TabHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  return (
    <View style={styles.row}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {signedIn ? (
        <Pressable
          onPress={() => router.push('/settings')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('tabs.settings')}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Cover path={user?.id && !user.is_guest ? `/api/jellyfin/user-image/${user.id}` : null} size={36} round />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Fades content out under the status bar on screens without a native header.
 * Render it after the scroll view: iOS finds the scroll view for the tab bar minimize through the first child.
 */
export function TopFade() {
  const { top } = useSafeAreaInsets();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[colors.bg, 'transparent']}
      style={[styles.fade, { height: top + 12 }]}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  title: { flex: 1, color: colors.text, fontSize: 34, fontWeight: '800', letterSpacing: 0.2 },
  fade: { position: 'absolute', top: 0, left: 0, right: 0 },
});
