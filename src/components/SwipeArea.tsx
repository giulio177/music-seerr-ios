import { View, type ViewProps } from 'react-native';
import { SwipeLockView } from '../../modules/system-audio';

/**
 * Container for horizontal swipes: once a drag is horizontal, the native side blocks the sheet and tab bar
 * gestures until the finger lifts, so drifting up or down does not cancel it. A plain view in older builds.
 */
export function SwipeArea(props: ViewProps) {
  const Native = SwipeLockView;
  return Native ? <Native {...props} /> : <View {...props} />;
}
