import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOTAUpdates } from '@/hooks/use-ota-updates';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { checkAndApplyUpdate, isEnabled } = useOTAUpdates({
    checkOnMount: true,
  });

  // Check for updates on app start (only in production builds)
  useEffect(() => {
    if (isEnabled) {
      // Check for updates after a short delay to not block app startup
      const timer = setTimeout(() => {
        checkAndApplyUpdate().catch((error) => {
          console.error('[OTA] Failed to check and apply update:', error);
        });
      }, 3000); // Wait 3 seconds after app start

      return () => clearTimeout(timer);
    }
  }, [isEnabled, checkAndApplyUpdate]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
