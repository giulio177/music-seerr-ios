import Constants from 'expo-constants';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Cover } from '@/components/Cover';
import { Menu, type MenuItem } from '@/components/Menu';
import { Symbol } from '@/components/Symbol';
import { toast } from '@/components/Toast';
import { AccentButton, Backdrop, Glass } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBytes } from '@/lib/format';
import { savedLanguage, setLanguage, type LanguageChoice } from '@/lib/language';
import { useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { usePreferences, type PreferenceChange } from '@/lib/preferences';
import { ACCENT_PRESETS, colors, resolveAccent, useAccent } from '@/lib/theme';
import { useApi } from '@/lib/useApi';

type ServerSettings = {
  music_dir: string;
  dir_exists: boolean;
  jellyfin_url: string;
  jellyfin_api_key: string;
  jellyfin_user_id: string;
  language: string;
  jellyfin_music_paths?: string[];
};

/**
 * Settings, shared with the web app: every change is saved on the server (accent color, crossfade, language,
 * and for administrators the Jellyfin connection, music folder, and artist aliases), so both clients follow it.
 * Only the server address and the downloads belong to this iPhone.
 */
export default function Settings() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const unreachable = useAuth((s) => s.unreachable);
  const signedIn = !!user && !user.is_guest;
  const role = user?.is_guest ? t('settings.guest') : user?.is_admin ? t('settings.admin') : t('settings.user');

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.title}>{t('tabs.settings')}</Text>
          {unreachable ? <Text style={styles.banner}>{t('settings.offlineBanner')}</Text> : null}

          <Glass style={styles.profile}>
            <Cover path={signedIn && user?.id ? `/api/jellyfin/user-image/${user.id}` : null} size={56} round />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.profileName} numberOfLines={1}>
                {user?.name ?? ''}
              </Text>
              <Text style={styles.profileRole}>{role}</Text>
            </View>
          </Glass>

          <ServerSection />
          <PreferencesSection />
          {user?.is_admin && !unreachable ? <AdminSections /> : null}
          <DownloadsSection />

          <AccentButton
            label={t('settings.signOut')}
            icon="log-out-outline"
            variant="glass"
            onPress={() => {
              usePlayer.getState().stop();
              useAuth.getState().logout();
            }}
            style={{ marginTop: 24 }}
          />
          <Text style={styles.version}>
            {t('settings.version')} {Constants.expoConfig?.version ?? '?'}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/* ---------- Building blocks ---------- */

function Section({ title, footer, children }: { title: string; footer?: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.group}>{title}</Text>
      <Glass style={styles.card}>{children}</Glass>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  last,
  danger,
  children,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
  danger?: boolean;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]} numberOfLines={1}>
        {label}
      </Text>
      {value !== undefined ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {children}
      {onPress ? <Symbol name="chevron.right" fallback="chevron-forward" size={13} color={colors.textTertiary} /> : null}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && styles.pressed]}>
      {body}
    </Pressable>
  ) : (
    <View style={[styles.row, !last && styles.rowBorder]}>{body}</View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  last,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  secure?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.field, !last && styles.rowBorder]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={styles.fieldInput}
      />
    </View>
  );
}

function errorText(e: unknown, t: TFunction) {
  if (e instanceof ApiError) {
    if (e.offline) return t('login.errorUnreachable');
    return t(`settings.errors.${e.detail}`, { defaultValue: e.detail });
  }
  return t('common.unknownError');
}

/* ---------- Server address (this iPhone) ---------- */

function ServerSection() {
  const { t } = useTranslation();
  const serverUrl = useAuth((s) => s.serverUrl);
  const unreachable = useAuth((s) => s.unreachable);
  const [busy, setBusy] = useState(false);

  const change = () =>
    Alert.prompt(
      t('settings.serverChange'),
      t('settings.serverChangeBody'),
      async (input) => {
        if (!input?.trim()) return;
        setBusy(true);
        try {
          await useAuth.getState().changeServer(input);
          toast(t('settings.serverChanged'));
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            Alert.alert(t('settings.serverOther'), t('settings.serverOtherBody'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('settings.signInThere'),
                onPress: () => {
                  usePlayer.getState().stop();
                  useAuth.setState({ serverUrl: input.trim() });
                  useAuth.getState().expire();
                },
              },
            ]);
          } else {
            Alert.alert(t('settings.serverChange'), errorText(e, t));
          }
        } finally {
          setBusy(false);
        }
      },
      'plain-text',
      serverUrl,
      'url',
    );

  return (
    <Section title={t('settings.server')} footer={t('settings.serverFooter')}>
      <Row label={t('settings.serverAddress')} value={serverUrl} onPress={busy ? undefined : change}>
        {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      </Row>
      <Row label={t('settings.status')} value={unreachable ? t('settings.statusOffline') : t('settings.statusOnline')} last />
    </Section>
  );
}

/* ---------- Personal preferences (shared with the web app) ---------- */

const LANGUAGES: { id: LanguageChoice; label: string }[] = [
  { id: 'system', label: '' },
  { id: 'en', label: 'English' },
  { id: 'it', label: 'Italiano' },
];

function PreferencesSection() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const unreachable = useAuth((s) => s.unreachable);
  const signedIn = !!user && !user.is_guest;
  const prefs = usePreferences((s) => s.prefs);
  const waiting = usePreferences((s) => Object.keys(s.pending).length > 0);
  const [language, setChoice] = useState<LanguageChoice>('system');
  const { accent: accentColor } = useAccent();

  useEffect(() => {
    savedLanguage().then(setChoice);
    if (signedIn) usePreferences.getState().sync();
  }, [signedIn]);

  const save = (change: PreferenceChange) => usePreferences.getState().change(change);

  const chooseLanguage = async (choice: LanguageChoice) => {
    setChoice(choice);
    await setLanguage(choice);
    // The web app keeps one language for the server; follow an explicit choice there too.
    if (choice !== 'system' && !unreachable) api('/api/settings', { method: 'POST', body: { language: choice } }).catch(() => undefined);
  };

  const currentAccent = prefs?.accent_color || prefs?.default_accent_color || 'pink';
  const seconds = prefs?.crossfade_seconds ?? 0;
  const showControls = prefs?.show_other_users_controls ?? false;

  const languageItems: MenuItem[] = LANGUAGES.map((lang) => ({
    id: lang.id,
    title: lang.id === 'system' ? t('settings.languageSystem') : lang.label,
    systemImage: lang.id === language ? 'checkmark' : undefined,
    run: () => chooseLanguage(lang.id),
  }));

  return (
    <Section title={t('settings.preferences')} footer={signedIn ? t(waiting ? 'settings.preferencesPending' : 'settings.preferencesFooter') : undefined}>
      <Menu items={languageItems} cancelLabel={t('common.cancel')} title={t('settings.language')}>
        <View pointerEvents="none">
          <Row
            label={t('settings.language')}
            value={language === 'system' ? t('settings.languageSystem') : LANGUAGES.find((l) => l.id === language)?.label}
            last={!signedIn}
          >
            <Symbol name="chevron.up.chevron.down" fallback="chevron-expand" size={13} color={colors.textTertiary} />
          </Row>
        </View>
      </Menu>
      {signedIn ? (
        <>
          <View style={[styles.field, styles.rowBorder]}>
            <Text style={styles.fieldLabel}>{t('settings.accent')}</Text>
            <View style={styles.swatches}>
              {Object.entries(ACCENT_PRESETS).map(([name, preset]) => {
                const selected = currentAccent === name;
                return (
                  <Pressable
                    key={name}
                    accessibilityLabel={name}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      save({ accent_color: name });
                    }}
                    style={[styles.swatchRing, selected && { borderColor: preset.accent }]}
                  >
                    <View style={[styles.swatch, { backgroundColor: preset.accent }]} />
                  </Pressable>
                );
              })}
              {currentAccent.startsWith('#') ? (
                <View style={[styles.swatchRing, { borderColor: resolveAccent(currentAccent).accent }]}>
                  <View style={[styles.swatch, { backgroundColor: resolveAccent(currentAccent).accent }]} />
                </View>
              ) : null}
            </View>
          </View>
          <Row label={t('settings.crossfade')} value={seconds ? t('settings.seconds', { count: seconds }) : t('settings.off')} last={!user?.is_admin}>
            <View style={styles.stepper}>
              {[-1, 1].map((step) => (
                <Pressable
                  key={step}
                  disabled={step < 0 ? seconds <= 0 : seconds >= 12}
                  onPress={() => {
                    const next = Math.max(0, Math.min(12, seconds + step));
                    save({ crossfade_seconds: next });
                  }}
                  style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
                >
                  <Text style={[styles.stepperLabel, { color: accentColor }]}>{step < 0 ? '−' : '+'}</Text>
                </Pressable>
              ))}
            </View>
          </Row>
          {user?.is_admin ? (
            <Row label={t('settings.otherUsers')} last>
              <Switch
                value={showControls}
                trackColor={{ true: accentColor }}
                onValueChange={(value) => {
                  save({ show_other_users_controls: value });
                }}
              />
            </Row>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}

/* ---------- Server configuration (administrators) ---------- */

function AdminSections() {
  const { t } = useTranslation();
  const settings = useApi<ServerSettings>('/api/settings');
  const users = useApi<{ users: { id: string; name: string }[] }>('/api/auth/users');
  const [draft, setDraft] = useState<Partial<ServerSettings>>({});
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  if (!settings.data) {
    return (
      <Section title={t('settings.jellyfin')}>
        <View style={{ padding: 18 }}>{settings.loading ? <ActivityIndicator color={colors.textSecondary} /> : null}</View>
      </Section>
    );
  }
  const value = { ...settings.data, ...draft };
  const changed = Object.keys(draft).some((key) => draft[key as keyof ServerSettings] !== settings.data![key as keyof ServerSettings]);
  const userName = users.data?.users.find((u) => u.id === value.jellyfin_user_id)?.name;

  const test = async () => {
    setBusy('test');
    try {
      setTestResult(
        await api<{ success: boolean; message: string }>('/api/settings/test-jellyfin', {
          method: 'POST',
          body: { jellyfin_url: value.jellyfin_url, jellyfin_api_key: value.jellyfin_api_key },
        }),
      );
    } catch (e) {
      setTestResult({ success: false, message: errorText(e, t) });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!/^https?:\/\//i.test(value.jellyfin_url.trim())) {
      Alert.alert(t('settings.jellyfin'), t('settings.urlInvalid'));
      return;
    }
    setBusy('save');
    try {
      await api('/api/settings', {
        method: 'POST',
        body: {
          jellyfin_url: value.jellyfin_url.trim(),
          jellyfin_api_key: value.jellyfin_api_key.trim(),
          jellyfin_user_id: value.jellyfin_user_id,
          music_dir: value.music_dir.trim(),
        },
      });
      setDraft({});
      await settings.refresh();
      toast(t('settings.saved'));
    } catch (e) {
      Alert.alert(t('settings.jellyfin'), errorText(e, t));
    } finally {
      setBusy(null);
    }
  };

  const userItems: MenuItem[] = [
    { id: '', title: t('settings.defaultUserNone'), systemImage: value.jellyfin_user_id ? undefined : 'checkmark', run: () => setDraft((d) => ({ ...d, jellyfin_user_id: '' })) },
    ...(users.data?.users ?? []).map((u) => ({
      id: u.id,
      title: u.name,
      systemImage: u.id === value.jellyfin_user_id ? 'checkmark' : undefined,
      group: 1,
      run: () => setDraft((d) => ({ ...d, jellyfin_user_id: u.id })),
    })),
  ];

  return (
    <>
      <Section title={t('settings.jellyfin')} footer={t('settings.jellyfinFooter')}>
        <Field label={t('settings.jellyfinUrl')} value={value.jellyfin_url} onChange={(text) => setDraft((d) => ({ ...d, jellyfin_url: text }))} placeholder="http://192.168.1.100:8096" />
        <Field label={t('settings.apiKey')} value={value.jellyfin_api_key} onChange={(text) => setDraft((d) => ({ ...d, jellyfin_api_key: text }))} secure />
        <Menu items={userItems} cancelLabel={t('common.cancel')} title={t('settings.defaultUser')}>
          <View pointerEvents="none">
            <Row label={t('settings.defaultUser')} value={userName ?? t('settings.defaultUserNone')}>
              <Symbol name="chevron.up.chevron.down" fallback="chevron-expand" size={13} color={colors.textTertiary} />
            </Row>
          </View>
        </Menu>
        <Field
          label={t('settings.musicDir')}
          value={value.music_dir}
          onChange={(text) => setDraft((d) => ({ ...d, music_dir: text }))}
          placeholder="/music"
          last
        />
      </Section>
      <Text style={[styles.footer, { color: settings.data.dir_exists ? colors.success : colors.warning }]}>
        {settings.data.dir_exists ? t('settings.musicDirOk') : t('settings.musicDirMissing')}
      </Text>
      {testResult ? <Text style={[styles.footer, { color: testResult.success ? colors.success : colors.danger }]}>{testResult.message}</Text> : null}
      <View style={styles.buttons}>
        <AccentButton label={t('settings.test')} variant="glass" onPress={test} loading={busy === 'test'} style={{ flex: 1 }} />
        <AccentButton label={t('settings.save')} onPress={save} loading={busy === 'save'} disabled={!changed} style={{ flex: 1 }} />
      </View>
      <AliasSection />
    </>
  );
}

function AliasSection() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const aliases = useApi<{ aliases: Record<string, string> }>('/api/settings/artist-aliases');
  const entries = Object.entries(aliases.data?.aliases ?? {}).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

  const store = async (next: Record<string, string>) => {
    try {
      await api('/api/settings/artist-aliases', { method: 'POST', body: { aliases: next } });
      await aliases.refresh();
    } catch (e) {
      Alert.alert(t('settings.aliases'), errorText(e, t));
    }
  };

  const add = () =>
    Alert.prompt(t('settings.aliasFrom'), t('settings.aliasFromBody'), (from) => {
      if (!from?.trim()) return;
      Alert.prompt(t('settings.aliasTo'), t('settings.aliasToBody', { name: from.trim() }), (to) => {
        if (!to?.trim()) return;
        store({ ...(aliases.data?.aliases ?? {}), [from.trim()]: to.trim() });
      });
    });

  const remove = (from: string) =>
    Alert.alert(t('settings.aliasRemove'), from, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.aliasRemove'),
        style: 'destructive',
        onPress: () => {
          const next = { ...(aliases.data?.aliases ?? {}) };
          delete next[from];
          store(next);
        },
      },
    ]);

  return (
    <Section title={t('settings.aliases')} footer={t('settings.aliasesFooter')}>
      {entries.map(([from, to]) => (
        <Row key={from} label={from} value={`→ ${to}`} onPress={() => remove(from)} />
      ))}
      <Pressable onPress={add} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <Text style={[styles.rowLabel, { color: accent }]}>{t('settings.aliasAdd')}</Text>
      </Pressable>
    </Section>
  );
}

/* ---------- Downloads (this iPhone) ---------- */

function DownloadsSection() {
  const { t } = useTranslation();
  const saved = useOffline((s) => s.tracks);
  const count = Object.keys(saved).length;
  const size = Object.values(saved).reduce((sum, tr) => sum + (tr.size || 0), 0);

  const removeAll = () =>
    Alert.alert(t('settings.removeAll'), t('settings.removeAllConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.removeAll'), style: 'destructive', onPress: () => useOffline.getState().removeAll() },
    ]);

  return (
    <Section title={t('settings.storage')} footer={t('settings.storageFooter')}>
      <Row label={t('settings.storageUsed')} value={`${formatBytes(size)} · ${t('common.tracks', { count })}`} />
      <Row label={t('settings.removeAll')} danger last onPress={count ? removeAll : undefined} />
    </Section>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 80, gap: 6 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', marginBottom: 10 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  profileName: { color: colors.text, fontSize: 20, fontWeight: '700' },
  profileRole: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
  group: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 22, marginBottom: 6, marginLeft: 16 },
  footer: { color: colors.textTertiary, fontSize: 13, lineHeight: 18, marginTop: 6, marginHorizontal: 16 },
  card: { paddingLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 10, paddingRight: 16, gap: 10 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  rowLabel: { color: colors.text, fontSize: 16, flexShrink: 0, maxWidth: '55%' },
  rowValue: { flex: 1, color: colors.textSecondary, fontSize: 15, textAlign: 'right' },
  field: { paddingVertical: 10, paddingRight: 16, gap: 6 },
  fieldLabel: { color: colors.textSecondary, fontSize: 13 },
  fieldInput: { color: colors.text, fontSize: 16, paddingVertical: 2 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatchRing: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  stepper: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 9 },
  stepperButton: { width: 40, height: 30, alignItems: 'center', justifyContent: 'center' },
  stepperLabel: { fontSize: 20, fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 12 },
  version: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', marginTop: 20 },
  banner: { color: colors.warning, fontSize: 14, backgroundColor: 'rgba(251, 191, 36, 0.1)', padding: 12, borderRadius: 12, overflow: 'hidden' },
});
