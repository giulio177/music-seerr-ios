import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ColorValue, ViewProps } from 'react-native';

export type SystemVolumeProps = ViewProps & { minimumTrackColor?: ColorValue; maximumTrackColor?: ColorValue };
export type RoutePickerProps = ViewProps & { tint?: ColorValue; activeTint?: ColorValue };

// Both views are null in a build made before this module existed, so callers can hide them.
export const SystemVolumeView: ComponentType<SystemVolumeProps> | null = requireOptionalNativeModule('SystemVolume')
  ? requireNativeView('SystemVolume')
  : null;

export const RoutePickerView: ComponentType<RoutePickerProps> | null = requireOptionalNativeModule('RoutePicker')
  ? requireNativeView('RoutePicker')
  : null;
