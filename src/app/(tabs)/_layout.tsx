import { NativeTabs } from 'expo-router/native-tabs';
import { useTranslation } from 'react-i18next';
import { MiniPlayer } from '@/components/MiniPlayer';
import { useAuth } from '@/lib/auth';
import { usePlayer } from '@/lib/player';
import { useAccent } from '@/lib/theme';

// Transparent tab content: the backdrop lives once in the root layout.
const clear = { backgroundColor: 'transparent' };

export default function TabsLayout() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const hasQueue = usePlayer((s) => s.queue.length > 0);
  // Without an account only the downloads make sense; an unreachable server keeps every tab (they show the offline mode).
  const downloadsOnly = useAuth((s) => s.status === 'offline');

  return (
    <NativeTabs
      key={downloadsOnly ? 'downloads' : 'full'}
      tintColor={accent}
      minimizeBehavior="onScrollDown"
    >
      {hasQueue ? (
        <NativeTabs.BottomAccessory>
          <MiniPlayer />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger contentStyle={clear} name="(home)" hidden={downloadsOnly}>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>{t('tabs.home')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={clear} name="(library)" hidden={downloadsOnly}>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.stack', selected: 'square.stack.fill' }} />
        <NativeTabs.Trigger.Label>{t('tabs.library')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={clear} name="(offline)">
        <NativeTabs.Trigger.Icon sf={{ default: 'arrow.down.circle', selected: 'arrow.down.circle.fill' }} />
        <NativeTabs.Trigger.Label>{t('tabs.offline')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* No automatic search activation: the search tab then sits inside the full tab bar and only moves to
          its own button on the right when the bar minimizes (Apple Music behavior). */}
      <NativeTabs.Trigger contentStyle={clear} name="(search)" role="search" disableAutomaticSearchActivation hidden={downloadsOnly}>
        <NativeTabs.Trigger.Label>{t('tabs.search')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
