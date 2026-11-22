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

/** Null in a build made before the native view existed, so callers can fall back. */
function optionalView<P>(name: string): ComponentType<P> | null {
  return requireOptionalNativeModule(name) ? requireNativeView(name) : null;
}

export const SystemVolumeView = optionalView<ViewProps>('SystemVolume');
export const RoutePickerView = optionalView<RoutePickerProps>('RoutePicker');
export const ScrubberView = optionalView<ScrubberProps>('Scrubber');
export const MenuButtonView = optionalView<MenuButtonProps>('MenuButton');
export const SwipeLockView = optionalView<ViewProps>('SwipeLock');
