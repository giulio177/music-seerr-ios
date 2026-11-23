import type { ReactNode } from 'react';
import { ActionSheetIOS, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { ContextMenuView, MenuButtonView } from '../../modules/system-audio';

export type MenuItem = {
  id: string;
  title: string;
  /** SF Symbol shown next to the title. */
  systemImage?: string;
  destructive?: boolean;
  /** Items of different groups are separated by a divider. */
  group?: number;
  run: () => void;
};

/**
 * Native pull-down menu (like Apple Music's "..." menus) opened by tapping `children`.
 * Builds without the native view fall back to an action sheet.
 */
export function Menu({
  items,
  title,
  cancelLabel,
  accessibilityLabel,
  style,
  children,
}: {
  items: MenuItem[];
  title?: string;
  cancelLabel: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (!items.length) return null;
  if (MenuButtonView) {
    return (
      <MenuButtonView
        style={style}
        title={title}
        accessibilityLabel={accessibilityLabel}
        actions={items.map(({ id, title: label, systemImage, destructive, group }) => ({ id, title: label, systemImage, destructive, group }))}
        onSelect={(e) => items.find((item) => item.id === e.nativeEvent.id)?.run()}
      >
        {children}
      </MenuButtonView>
    );
  }
  return (
    <Pressable style={style} hitSlop={10} accessibilityLabel={accessibilityLabel} onPress={() => showActionSheet(items, cancelLabel, title)}>
      {children}
    </Pressable>
  );
}

/**
 * Native long-press context menu with an Apple Music style preview card (artwork + title + subtitle).
 * Falls back to rendering children as-is in builds without the native view.
 */
export function ContextMenu({
  items,
  previewTitle,
  previewSubtitle,
  previewImages,
  previewHeaders,
  onPreviewPress,
  style,
  children,
}: {
  items: MenuItem[];
  previewTitle?: string;
  previewSubtitle?: string;
  previewImages?: string[];
  previewHeaders?: Record<string, string>;
  onPreviewPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (!ContextMenuView || !items.length) return <>{children}</>;
  return (
    <ContextMenuView
      style={style}
      previewTitle={previewTitle}
      previewSubtitle={previewSubtitle}
      previewImages={previewImages}
      previewHeaders={previewHeaders}
      actions={items.map(({ id, title: label, systemImage, destructive, group }) => ({ id, title: label, systemImage, destructive, group }))}
      onSelect={(e) => items.find((item) => item.id === e.nativeEvent.id)?.run()}
      onPreviewPress={onPreviewPress}
    >
      {children}
    </ContextMenuView>
  );
}

/** Whether the native long-press context menu is available in this build. */
export const hasNativeContextMenu = !!ContextMenuView;

/** The same items as an action sheet (long press fallback in builds without the native menu). */
export function showActionSheet(items: MenuItem[], cancelLabel: string, title?: string, message?: string) {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      message,
      options: [...items.map((item) => item.title), cancelLabel],
      cancelButtonIndex: items.length,
      destructiveButtonIndex: items.findIndex((item) => item.destructive),
      userInterfaceStyle: 'dark',
    },
    (index) => items[index]?.run(),
  );
}
