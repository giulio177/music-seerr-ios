import { NativeTabs } from 'expo-router/native-tabs';
import { useTranslation } from 'react-i18next';
import { MiniPlayer } from '@/components/MiniPlayer';
import { useAuth } from '@/lib/auth';
import { usePlayer } from '@/lib/player';
import { colors, useAccent } from '@/lib/theme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const hasQueue = usePlayer((s) => s.queue.length > 0);
  // Without a server (unreachable, or no account) only the downloads make sense.
  const downloadsOnly = useAuth((s) => s.status === 'offline' || s.unreachable);

  return (
    <NativeTabs key={downloadsOnly ? 'downloads' : 'full'} tintColor={accent} minimizeBehavior="onScrollDown" backgroundColor={colors.bg}>
      {hasQueue ? (
        <NativeTabs.BottomAccessory>
          <MiniPlayer />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger name="(library)" hidden={downloadsOnly}>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.stack', selected: 'square.stack.fill' }} />
        <NativeTabs.Trigger.Label>{t('tabs.library')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(offline)">
        <NativeTabs.Trigger.Icon sf={{ default: 'arrow.down.circle', selected: 'arrow.down.circle.fill' }} />
        <NativeTabs.Trigger.Label>{t('tabs.offline')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings" hidden={downloadsOnly}>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>{t('tabs.settings')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)" role="search" hidden={downloadsOnly}>
        <NativeTabs.Trigger.Label>{t('tabs.search')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
