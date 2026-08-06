/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

const tintColorLight = '#4F46E5'; // indigo-600
const tintColorDark = '#818CF8'; // indigo-400, readable on dark backgrounds

export const Colors = {
  light: {
    text: '#0F1222',
    background: '#F7F7FA',
    tint: tintColorLight,
    icon: '#6B7280',
    tabIconDefault: '#9CA3AF',
    tabIconSelected: tintColorLight,
    surface: '#EEEFF4',
    surfaceSecondary: '#E4E6EE',
    card: '#FFFFFF',
    border: '#E6E8F0',
    textSecondary: '#6B7280',
    success: '#16A34A',
    danger: '#DC2626',
    warning: '#B45309',
    info: '#2563EB',
    accentOrange: '#EA580C',
    accentPurple: '#7C3AED',
    neutral: '#6B7280',
    overlay: 'rgba(15,18,34,0.45)',
    skeleton: '#E7E9F0',
    // Hero surfaces keep the deep indigo in both schemes — white text on top
    heroBg: '#4F46E5',
    heroText: '#FFFFFF',
    heroTextMuted: 'rgba(255,255,255,0.72)',
  },
  dark: {
    text: '#F2F3F7',
    background: '#0B0D12',
    tint: tintColorDark,
    icon: '#9AA0AE',
    tabIconDefault: '#6B7280',
    tabIconSelected: tintColorDark,
    surface: '#161923',
    surfaceSecondary: '#1E2230',
    card: '#141722',
    border: '#262B3B',
    textSecondary: '#9AA0AE',
    success: '#4ADE80',
    danger: '#F87171',
    warning: '#FBBF24',
    info: '#60A5FA',
    accentOrange: '#FB923C',
    accentPurple: '#A78BFA',
    neutral: '#9CA3AF',
    overlay: 'rgba(0,0,0,0.6)',
    skeleton: '#1D2130',
    heroBg: '#4338CA',
    heroText: '#FFFFFF',
    heroTextMuted: 'rgba(255,255,255,0.72)',
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

// Inter static families (loaded in app/_layout.tsx). Use these instead of
// fontWeight — Android won't synthesize weights for custom fonts.
export const Type = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
} as const;

