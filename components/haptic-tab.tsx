// SDK 57 inlines React Navigation into expo-router, so these come from there
// rather than from `@react-navigation/*` — the official template ships no
// react-navigation dependency at all. Importing the npm copy alongside it gives
// two incompatible sets of types (its `pressColor` is `string`, expo-router's is
// `ColorValue`) and `tabBarButton` stops type-checking. These are build-internal
// paths because expo-router does not re-export them; if a future patch moves
// them, tsc says so immediately.
import type { BottomTabBarButtonProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { PlatformPressable } from 'expo-router/build/react-navigation/elements';
import * as Haptics from 'expo-haptics';

export function HapticTab(props: BottomTabBarButtonProps) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === 'ios') {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}
