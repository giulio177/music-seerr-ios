import { NativeTabs } from 'expo-router/native-tabs';
import { useTranslation } from 'react-i18next';
import { MiniPlayer } from '@/components/MiniPlayer';
import { useBackdropStyle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { usePlayer } from '@/lib/player';
import { useAccent } from '@/lib/theme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  // The backdrop is the tab content's own background, so each screen's scroll view stays its first child.
  const backdrop = useBackdropStyle();
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
      <NativeTabs.Trigger contentStyle={backdrop} name="(home)" hidden={downloadsOnly}>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>{t('tabs.home')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={backdrop} name="(library)" hidden={downloadsOnly}>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.stack', selected: 'square.stack.fill' }} />
        <NativeTabs.Trigger.Label>{t('tabs.library')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={backdrop} name="(offline)">
        <NativeTabs.Trigger.Icon sf={{ default: 'arrow.down.circle', selected: 'arrow.down.circle.fill' }} />
        <NativeTabs.Trigger.Label>{t('tabs.offline')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* No automatic search activation: on iOS 27+, UIKit keeps Search inside the unified tab bar pill
          when expanded and detaches it to the trailing circle when minimized (Apple Music behavior). */}
      <NativeTabs.Trigger contentStyle={backdrop} name="(search)" role="search" disableAutomaticSearchActivation hidden={downloadsOnly}>
        <NativeTabs.Trigger.Label>{t('tabs.search')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
