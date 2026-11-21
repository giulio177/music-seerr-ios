import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccentButton, Backdrop, Glass } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatBytes } from '@/lib/format';
import { useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { colors } from '@/lib/theme';

export default function Settings() {
  const { t } = useTranslation();
  const { user, serverUrl, unreachable } = useAuth();
  const saved = useOffline((s) => s.tracks);
  const size = Object.values(saved).reduce((sum, tr) => sum + (tr.size || 0), 0);
  const role = user?.is_guest ? t('settings.guest') : user?.is_admin ? t('settings.admin') : t('settings.user');

  const removeAll = () =>
    Alert.alert(t('settings.removeAll'), t('settings.removeAllConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.removeAll'), style: 'destructive', onPress: () => useOffline.getState().removeAll() },
    ]);

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>{t('tabs.settings')}</Text>
          {unreachable ? <Text style={styles.banner}>{t('settings.offlineBanner')}</Text> : null}

          <Text style={styles.group}>{t('settings.account')}</Text>
          <Glass style={styles.card}>
            <Row label={user?.name ?? ''} value={role} />
            <Row label={t('settings.server')} value={serverUrl} last />
          </Glass>

          <Text style={styles.group}>{t('settings.storage')}</Text>
          <Glass style={styles.card}>
            <Row label={t('settings.storageUsed')} value={`${formatBytes(size)} · ${t('common.tracks', { count: Object.keys(saved).length })}`} last />
          </Glass>
          <AccentButton label={t('settings.removeAll')} variant="glass" onPress={removeAll} disabled={!Object.keys(saved).length} />

          <AccentButton
            label={t('settings.signOut')}
            icon="log-out-outline"
            onPress={() => {
              usePlayer.getState().stop();
              useAuth.getState().logout();
            }}
            style={{ marginTop: 12 }}
          />
          <Text style={styles.version}>
            {t('settings.version')} {Constants.expoConfig?.version ?? '?'}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 140, gap: 10 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', marginBottom: 6 },
  group: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 14, marginLeft: 4 },
  card: { paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, gap: 12 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  rowLabel: { color: colors.text, fontSize: 16, flexShrink: 0, maxWidth: '50%' },
  rowValue: { color: colors.textSecondary, fontSize: 15, flexShrink: 1 },
  version: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', marginTop: 20 },
  banner: { color: colors.warning, fontSize: 14, backgroundColor: 'rgba(251, 191, 36, 0.1)', padding: 12, borderRadius: 12, overflow: 'hidden' },
});
