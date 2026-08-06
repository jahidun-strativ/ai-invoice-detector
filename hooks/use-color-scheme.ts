import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * Narrows RN's ColorSchemeName (which can include 'unspecified' on Android)
 * to the two schemes the theme actually defines.
 */
export function useColorScheme(): 'light' | 'dark' | null {
  const scheme = useRNColorScheme();
  return scheme === 'dark' ? 'dark' : scheme === 'light' ? 'light' : null;
}
