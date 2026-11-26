import Constants from 'expo-constants';
import { File } from 'expo-file-system';
import { Alert, AppState, Linking } from 'react-native';
import { create } from 'zustand';
import i18n from './i18n';
import { readKey, writeKey } from './keychain';
import { supportDir } from './offline';

/**
 * App updates through SideStore. The app reads the AltStore source of the latest GitHub release and, when it holds a
 * newer version, offers it once a day. Updating opens `sidestore://install?url=<ipa>`; SideStore installs over this
 * app (same bundle ID), so the session and the downloads stay.
 *
 * SideStore needs LocalDevVPN, and iOS runs one VPN at a time. With "Use shortcuts" on, the app runs the user's
 * shortcut `Sonalis Update` (input: the install link; it connects LocalDevVPN and opens the link), and when the app
 * is opened again it runs `Sonalis VPN` (connects the usual VPN, such as Tailscale) and comes back.
 */
const SOURCE_URL = 'https://github.com/giulio177/sonalis-ios/releases/latest/download/altstore-source.json';
export const UPDATE_SHORTCUT = 'Sonalis Update';
export const VPN_SHORTCUT = 'Sonalis VPN';
const SHORTCUTS_KEY = 'update_shortcuts';
/** The update in progress, so the next launch or foreground restores the VPN. */
const pendingFile = new File(supportDir, 'update.json');
/** Time for SideStore to take over before a return to the app counts as "update done or abandoned". */
const RESTORE_AFTER_MS = 15000;
const CHECK_EVERY_MS = 6 * 3600 * 1000;
const ASK_EVERY_MS = 24 * 3600 * 1000;

type Latest = { version: string; url: string };

type UpdateState = {
  current: string;
  latest: Latest | null;
  checking: boolean;
  checkedAt: number;
  /** Run the user's shortcuts around the update to switch VPN. */
  useShortcuts: boolean;
  setUseShortcuts: (on: boolean) => void;
};

export const useUpdates = create<UpdateState>((set) => ({
  current: Constants.expoConfig?.version ?? '0.0.0',
  latest: null,
  checking: false,
  checkedAt: 0,
  useShortcuts: false,
  setUseShortcuts: (on) => {
    set({ useShortcuts: on });
    writeKey(SHORTCUTS_KEY, on ? '1' : '0').catch(() => undefined);
  },
}));

/** -1, 0, or 1, comparing `X.Y.Z` versions numerically. */
export function compareVersions(a: string, b: string) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The newer release, or null when this build is current. */
export function availableUpdate() {
  const { latest, current } = useUpdates.getState();
  return latest && compareVersions(latest.version, current) > 0 ? latest : null;
}

/** Reads the latest release from the AltStore source; `force` skips the 6 hour pause. */
export async function checkForUpdate(force = false) {
  const state = useUpdates.getState();
  if (state.checking || (!force && Date.now() - state.checkedAt < CHECK_EVERY_MS)) return availableUpdate();
  useUpdates.setState({ checking: true });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(SOURCE_URL, { signal: controller.signal, headers: { Accept: 'application/json' } }).finally(() =>
      clearTimeout(timer),
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.json();
    const latest = source?.apps?.[0]?.versions?.[0];
    if (typeof latest?.version === 'string' && typeof latest?.downloadURL === 'string') {
      useUpdates.setState({ latest: { version: latest.version, url: latest.downloadURL } });
    }
    useUpdates.setState({ checkedAt: Date.now() });
  } catch (error) {
    console.warn('[updates] could not read the release source', error);
  } finally {
    useUpdates.setState({ checking: false });
  }
  return availableUpdate();
}

const shortcutUrl = (name: string, params: Record<string, string>) =>
  `shortcuts://x-callback-url/run-shortcut?${Object.entries({ name, ...params })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')}`;

/** Installs `update` through SideStore, switching VPN through the shortcuts when they are on. */
export async function startUpdate(update: Latest) {
  const install = `sidestore://install?url=${encodeURIComponent(update.url)}`;
  if (!useUpdates.getState().useShortcuts) {
    Alert.alert(i18n.t('updates.title'), i18n.t('updates.vpnHint'), [
      { text: i18n.t('common.cancel'), style: 'cancel' },
      { text: i18n.t('updates.openSideStore'), onPress: () => Linking.openURL(install).catch(() => Alert.alert(i18n.t('updates.noSideStore'))) },
    ]);
    return;
  }
  try {
    if (!supportDir.exists) supportDir.create({ intermediates: true });
    pendingFile.writeSync(JSON.stringify({ from: useUpdates.getState().current, at: Date.now() }));
  } catch (error) {
    console.warn('[updates] could not save the pending update', error);
  }
  // No x-success: the shortcut ends by opening SideStore, which must stay in front while it installs.
  await Linking.openURL(shortcutUrl(UPDATE_SHORTCUT, { input: 'text', text: install })).catch(() =>
    Alert.alert(i18n.t('updates.noShortcuts')),
  );
}

/** After an update (or one abandoned in SideStore): runs the VPN shortcut once and comes back to the app. */
function restoreVpn() {
  let pending: { at?: number } | null = null;
  try {
    if (pendingFile.exists) pending = JSON.parse(pendingFile.textSync());
  } catch {
    pending = {};
  }
  if (!pending || Date.now() - (pending.at ?? 0) < RESTORE_AFTER_MS) return;
  try {
    pendingFile.delete();
  } catch {
    return;
  }
  Linking.openURL(shortcutUrl(VPN_SHORTCUT, { 'x-success': 'sonalis://', 'x-error': 'sonalis://' })).catch(() => undefined);
}

let askedAt = 0;

/** Offers a newer version, at most once a day per launch session. */
async function offerUpdate() {
  if (__DEV__ || Date.now() - askedAt < ASK_EVERY_MS) return;
  const update = await checkForUpdate();
  if (!update) return;
  askedAt = Date.now();
  Alert.alert(i18n.t('updates.title'), i18n.t('updates.available', { version: update.version }), [
    { text: i18n.t('updates.later'), style: 'cancel' },
    { text: i18n.t('updates.update'), onPress: () => startUpdate(update) },
  ]);
}

/** Called at launch and on every return to the foreground. */
export async function onAppActive() {
  // Shortcuts and automations start the app in the background: never prompt or switch apps then.
  if (AppState.currentState !== 'active') return;
  const value = await readKey(SHORTCUTS_KEY).catch(() => null);
  if (value !== null) useUpdates.setState({ useShortcuts: value === '1' });
  restoreVpn();
  offerUpdate().catch(() => undefined);
}
