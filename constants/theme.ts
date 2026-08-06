/**
 * Strativ brand design tokens, adapted for React Native from the official
 * Strativ frontend design system (2024 brand guideline).
 *
 * Hard brand rules encoded here:
 * - Accent is Strativ Orange #FE5001. One accent — no purple, no indigo.
 * - "Black" is Warm Black #1A0E1C, never #000. Light-mode text is warm-black
 *   at decreasing strength (hex-blended, since tokens get alpha-suffixed).
 * - Dark mode uses the NEUTRAL dark scale (#0B0E13 family), not warm-black:
 *   warm-black is only for small accents, never a full canvas.
 * - No gradients anywhere. Solid fills only.
 */

const brandOrange = '#FE5001';

export const Colors = {
  light: {
    text: '#1A0E1C', // warm black
    background: '#F9FAFB',
    tint: brandOrange,
    icon: '#7F7880', // warm-black @ 56%
    tabIconDefault: '#7F7880',
    tabIconSelected: brandOrange,
    surface: '#F2F4F7',
    surfaceSecondary: '#E4E7EC',
    card: '#FFFFFF',
    border: '#E4E7EC',
    textSecondary: '#4C434E', // warm-black @ 78%
    success: '#039855',
    danger: '#D92D20',
    warning: '#DC6803',
    info: '#1570EF',
    accentYellow: '#F9B70E',
    accentTeal: '#0E9384',
    accentViolet: '#7A5AF8', // data-viz only
    neutral: '#475467',
    overlay: 'rgba(26,14,28,0.5)', // warm-black scrim
    skeleton: '#EAECF0',
    heroBg: brandOrange, // solid orange filled tile — never a gradient
    heroText: '#FFFFFF',
    heroTextMuted: 'rgba(255,255,255,0.72)',
    warmBlack: '#1A0E1C',
  },
  dark: {
    text: '#F5F1F4',
    background: '#0B0E13', // neutral dark canvas
    tint: brandOrange,
    icon: '#8E8D8F', // near-white @ 56%
    tabIconDefault: '#8E8D8F',
    tabIconSelected: brandOrange,
    surface: '#1E232B',
    surfaceSecondary: '#272D37',
    card: '#161A21',
    border: '#2A303A',
    textSecondary: '#BDBAC0', // near-white @ 78%
    success: '#12B76A',
    danger: '#F04438',
    warning: '#F79009',
    info: '#53B1FD',
    accentYellow: '#F9B70E',
    accentTeal: '#2ED3B7',
    accentViolet: '#9B8AFB', // data-viz only
    neutral: '#98A2B3',
    overlay: 'rgba(0,0,0,0.6)',
    skeleton: '#272D37',
    heroBg: brandOrange,
    heroText: '#FFFFFF',
    heroTextMuted: 'rgba(255,255,255,0.72)',
    warmBlack: '#1A0E1C',
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

// Two fonts only, per the brand guideline:
// Expletus Sans for headings, Inter for everything else.
// Use these families instead of fontWeight — Android won't synthesize
// weights for custom fonts.
export const Type = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
  display: 'ExpletusSans_500Medium', // headings default
  displayBold: 'ExpletusSans_700Bold', // headings that need punch
} as const;
