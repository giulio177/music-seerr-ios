import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccentButton, Backdrop, Glass } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, useAccent } from '@/lib/theme';

export default function Login() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const savedServer = useAuth((s) => s.serverUrl);
  const [server, setServer] = useState(savedServer);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'login' | 'guest' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const describe = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.offline) return t('login.errorUnreachable');
      if (e.status === 401) return t('login.errorCredentials');
      if (e.detail === 'server_too_old') return t('login.errorServerTooOld');
      return e.detail;
    }
    return e instanceof Error && e.message ? `${t('common.unknownError')} (${e.message})` : t('common.unknownError');
  };

  const submit = async (mode: 'login' | 'guest') => {
    if (!server.trim()) {
      setError(t('login.errorServer'));
      return;
    }
    setBusy(mode);
    setError(null);
    try {
      if (mode === 'login') await useAuth.getState().login(server, username, password);
      else await useAuth.getState().continueAsGuest(server);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.brand}>
              <Image source={require('../../assets/splash-icon.png')} style={[styles.logo, { shadowColor: accent }]} />
              <Text style={styles.title}>Music Seerr</Text>
              <Text style={styles.subtitle}>{t('login.subtitle')}</Text>
            </View>
            <Glass style={styles.card}>
              <Field label={t('login.server')}>
                <TextInput
                  value={server}
                  testID="login-server"
                  onChangeText={setServer}
                  placeholder={t('login.serverPlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  textContentType="URL"
                  style={styles.input}
                />
              </Field>
              <Field label={t('login.username')}>
                <TextInput
                  value={username}
                  testID="login-username"
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="username"
                  autoComplete="username"
                  style={styles.input}
                />
              </Field>
              <Field label={t('login.password')}>
                <TextInput
                  value={password}
                  testID="login-password"
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="password"
                  autoComplete="current-password"
                  onSubmitEditing={() => submit('login')}
                  style={styles.input}
                />
              </Field>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <AccentButton testID="login-submit" label={t('login.signIn')} onPress={() => submit('login')} loading={busy === 'login'} disabled={!!busy} />
              <AccentButton
                label={t('login.guest')}
                variant="glass"
                onPress={() => submit('guest')}
                loading={busy === 'guest'}
                disabled={!!busy}
              />
            </Glass>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 28 },
  brand: { alignItems: 'center', gap: 8 },
  logo: { width: 112, height: 112, shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 8 },
  subtitle: { color: colors.textSecondary, fontSize: 15 },
  card: { padding: 18, gap: 14 },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  input: {
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  error: { color: colors.danger, fontSize: 14, lineHeight: 19 },
});
