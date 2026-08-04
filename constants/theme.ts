/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#4FC3F7'; // Light blue that's visible on dark backgrounds

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
    surface: '#F6F7F8',
    surfaceSecondary: '#EDEFF1',
    card: '#FFFFFF',
    border: '#E3E6E8',
    textSecondary: '#687076',
    success: '#2E9E5B',
    danger: '#D93F33',
    warning: '#C77D00',
    info: '#1976D2',
    accentOrange: '#E8710A',
    accentPurple: '#8E44AD',
    neutral: '#757575',
    overlay: 'rgba(0,0,0,0.45)',
    skeleton: '#E8EAEC',
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    surface: '#1E2022',
    surfaceSecondary: '#26282B',
    card: '#1C1E20',
    border: '#33363A',
    textSecondary: '#9BA1A6',
    success: '#4CD080',
    danger: '#FF6B5E',
    warning: '#FFC960',
    info: '#64B5F6',
    accentOrange: '#FFA040',
    accentPurple: '#BB7CD8',
    neutral: '#9E9E9E',
    overlay: 'rgba(0,0,0,0.6)',
    skeleton: '#2A2D30',
  },
};

export type ThemeColors = typeof Colors.light;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
