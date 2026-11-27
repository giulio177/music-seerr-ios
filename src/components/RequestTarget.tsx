import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { useRequestTarget } from '@/lib/requestTarget';
import { colors, useAccent, withAlpha } from '@/lib/theme';
import type { Playlist } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { Menu, type MenuItem } from './Menu';
import { Symbol } from './Symbol';

/**
 * Search tab: where requested songs end up (like the web app's "Add to playlist" selector). Library only, or one of
 * the playlists this account may change (its own; administrators all), joined when the download finishes.
 */
export function RequestTargetPicker() {
  const { t } = useTranslation();
  const { accent } = useAccent();
  const user = useAuth((s) => s.user);
  const target = useRequestTarget((s) => s.target);
  const playlists = useApi<Playlist[]>(user && !user.is_guest ? '/api/jellyfin/playlists' : null);
  const own = (playlists.data ?? []).filter((p) => user?.is_admin || !p.owner_user_id || p.owner_user_id === user?.id);

  const items: MenuItem[] = [
    {
      id: 'library',
      title: t('requestTarget.libraryOnly'),
      systemImage: target ? undefined : 'checkmark',
      run: () => useRequestTarget.getState().set(null),
    },
    ...own.map((p) => ({
      id: p.id,
      title: p.name,
      systemImage: target?.id === p.id ? 'checkmark' : undefined,
      group: 1,
      run: () => useRequestTarget.getState().set({ id: p.id, name: p.name }),
    })),
  ];

  return (
    <Menu items={items} title={t('requestTarget.title')} cancelLabel={t('common.cancel')} accessibilityLabel={t('requestTarget.title')} style={styles.wrap}>
      <View pointerEvents="none" style={[styles.pill, target && { backgroundColor: withAlpha(accent, 0.18), borderColor: withAlpha(accent, 0.5) }]}>
        <Symbol name="text.badge.plus" fallback="list" size={16} color={target ? accent : colors.textSecondary} />
        <Text style={styles.label} numberOfLines={1}>
          {t('requestTarget.label')}{' '}
          <Text style={[styles.value, { color: target ? accent : colors.text }]}>{target?.name ?? t('requestTarget.libraryOnly')}</Text>
        </Text>
        <Symbol name="chevron.up.chevron.down" fallback="chevron-expand" size={12} color={colors.textTertiary} />
      </View>
    </Menu>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  label: { flexShrink: 1, color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  value: { fontWeight: '700' },
});
