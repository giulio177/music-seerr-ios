import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ColorValue, NativeSyntheticEvent, ViewProps } from 'react-native';

export type RoutePickerProps = ViewProps & { tint?: ColorValue; activeTint?: ColorValue };

export type ScrubberProps = ViewProps & {
  value: number;
  maximum: number;
  onScrubStart?: () => void;
  onScrubChange?: (event: NativeSyntheticEvent<{ value: number }>) => void;
  onScrubEnd?: (event: NativeSyntheticEvent<{ value: number }>) => void;
};

export type MenuAction = { id: string; title: string; systemImage?: string; destructive?: boolean; group?: number };
export type MenuButtonProps = ViewProps & {
  actions: MenuAction[];
  title?: string;
  onSelect: (event: NativeSyntheticEvent<{ id: string }>) => void;
};

export type ContextMenuProps = ViewProps & {
  actions: MenuAction[];
  previewTitle?: string;
  previewSubtitle?: string;
  previewImages?: string[];
  previewHeaders?: Record<string, string>;
  onSelect: (event: NativeSyntheticEvent<{ id: string }>) => void;
  onPreviewPress?: () => void;
};

/** Null in a build made before the native view existed, so callers can fall back. */
function optionalView<P>(name: string): ComponentType<P> | null {
  return requireOptionalNativeModule(name) ? requireNativeView(name) : null;
}

export const SystemVolumeView = optionalView<ViewProps>('SystemVolume');
export const RoutePickerView = optionalView<RoutePickerProps>('RoutePicker');
export const ScrubberView = optionalView<ScrubberProps>('Scrubber');
export const MenuButtonView = optionalView<MenuButtonProps>('MenuButton');
export const ContextMenuView = optionalView<ContextMenuProps>('ContextMenu');
export const SwipeLockView = optionalView<ViewProps>('SwipeLock');

export type ShortcutRequest = { id: string; action: string; args: Record<string, unknown> };

type ShortcutsNative = {
  addListener: (event: 'onRequest', listener: (request: ShortcutRequest) => void) => { remove: () => void };
  ready: () => void;
  respond: (id: string, json: string | null, error: string | null) => void;
  catalogChanged: () => void;
};

/** App Intents bridge (Siri, Shortcuts, Control Center, Spotlight); null in builds made before it existed. */
export const ShortcutsNative = requireOptionalNativeModule<ShortcutsNative>('Shortcuts');
