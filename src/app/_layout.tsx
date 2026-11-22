import '@/lib/i18n';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ToastHost } from '@/components/Toast';
import { useAuth } from '@/lib/auth';
import { useOffline } from '@/lib/offline';
import { colors } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const status = useAuth((s) => s.status);

  useEffect(() => {
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
      });
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
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={status === 'signedIn' || status === 'offline'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="player" options={{ presentation: 'modal', contentStyle: { backgroundColor: colors.bg } }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="login" options={{ animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
      <ToastHost />
    </GestureHandlerRootView>
  );
}
