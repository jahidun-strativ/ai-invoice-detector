// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<string, ComponentProps<typeof MaterialIcons>['name']>;
export type IconSymbolName = keyof typeof MAPPING;

/**
 * SF Symbols to Material Icons mappings.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  // Navigation
  'house.fill': 'home',
  'house': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',

  // Actions
  'camera.fill': 'camera-alt',
  'photo.on.rectangle': 'photo-library',
  'square.and.arrow.down': 'download',
  'square.and.arrow.up': 'share',
  'arrow.counterclockwise': 'refresh',
  'arrow.clockwise': 'refresh',
  'arrow.triangle.2.circlepath': 'flip-camera-ios',
  'arrow.up.left.and.arrow.down.right': 'fullscreen',
  'arrow.down.circle': 'arrow-circle-down',
  'arrow.up.circle': 'arrow-circle-up',
  'checkmark': 'check',
  'checkmark.circle': 'check-circle-outline',
  'checkmark.circle.fill': 'check-circle',
  'xmark': 'close',
  'xmark.circle.fill': 'cancel',
  'pencil': 'edit',
  'trash': 'delete',
  'trash.fill': 'delete',
  'plus.circle': 'add-circle',
  'magnifyingglass': 'search',
  'gearshape': 'settings',
  'gearshape.fill': 'settings',

  // Documents
  'doc.text.fill': 'description',
  'doc.questionmark.fill': 'help-outline',
  'curlybraces': 'data-object',
  'tablecells': 'table-chart',

  // Time & Calendar
  'clock.fill': 'schedule',
  'clock': 'schedule',
  'calendar': 'calendar-today',

  // Finance & Commerce
  'banknote.fill': 'payments',
  'cart.fill': 'shopping-cart',

  // Alerts & Info
  'exclamationmark.triangle.fill': 'warning',
  'info.circle': 'info-outline',

  // Food & Utilities
  'fork.knife': 'restaurant',
  'bolt.fill': 'bolt',
  'wrench.and.screwdriver.fill': 'build',
} as const satisfies IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
