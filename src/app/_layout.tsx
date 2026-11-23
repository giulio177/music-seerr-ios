import '@/lib/i18n';
import { DarkTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ToastHost } from '@/components/Toast';
import { Backdrop } from '@/components/ui';
import { applySavedLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useOffline } from '@/lib/offline';
import { usePlayer } from '@/lib/player';
import { colors } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Dark navigation theme with a transparent background: the default light theme paints #f2f2f2 under
// every navigator screen, which covered the backdrop.
const theme: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent', card: colors.bg },
};

export default function RootLayout() {
  const status = useAuth((s) => s.status);

  useEffect(() => {
    applySavedLanguage().catch(() => undefined);
    try {
      useOffline.getState().refresh();
    } catch (error) {
      console.error('[startup] offline library', error);
    }
    useAuth
      .getState()
      .load()
      .catch((error) => {
        console.error('[startup] session', error);
        useAuth.setState({ status: 'signedOut' });
      })
      // After the session (stream URLs need the server and token): bring back the last song, paused.
      .then(() => {
        if (useAuth.getState().status === 'signedIn') usePlayer.getState().restore();
      })
      .catch((error) => console.error('[startup] player', error));
    // Never leave the splash screen up, whatever happens during startup.
    const timer = setTimeout(() => SplashScreen.hideAsync().catch(() => undefined), 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync().catch(() => undefined);
  }, [status]);

  // Back in the foreground: check the server again (for example back home on Wi-Fi) and pick up songs deleted in the Files app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      useOffline.getState().refresh();
      if (useAuth.getState().status === 'signedIn') useAuth.getState().verify();
    });
    return () => sub.remove();
  }, []);

  if (status === 'loading') return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <ThemeProvider value={theme}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        {/* One backdrop behind every screen: a per-screen backdrop as first child would hide the scroll view
          from the tab bar, which looks for it through the first child to minimize on scroll. */}
        <Backdrop />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        >
          <Stack.Protected guard={status === 'signedIn' || status === 'offline'}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="player"
              options={{
                presentation: 'modal',
                contentStyle: { backgroundColor: colors.bg },
              }}
            />
            <Stack.Screen
              name="settings"
              options={{
                presentation: 'modal',
                contentStyle: { backgroundColor: colors.bg },
              }}
            />
          </Stack.Protected>
          <Stack.Protected guard={status === 'signedOut'}>
            <Stack.Screen name="login" options={{ animation: 'fade' }} />
          </Stack.Protected>
        </Stack>
        <ToastHost />
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
