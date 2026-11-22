import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

// Home, Library, Search, and Downloads each get their own stack; album, artist, and playlist pages are shared.
export const unstable_settings = {
  // `index` is Home: the app opens on `/`, which resolves to `index` in the first tab.
  anchor: 'index',
  library: { anchor: 'library' },
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
        contentStyle: { backgroundColor: 'transparent' },
      }}
    />
  );
}
