import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

// Home, Library, Search, and Downloads each get their own stack; album, artist, and playlist pages are shared.
export const unstable_settings = {
  anchor: 'index',
  home: { anchor: 'home' },
  search: { anchor: 'search' },
  offline: { anchor: 'offline' },
};

export default function SharedStack() {
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerLargeTitleStyle: { color: colors.text },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
