import {
  ExpletusSans_500Medium,
  ExpletusSans_700Bold,
} from '@expo-google-fonts/expletus-sans';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ReceiptsProvider } from '@/contexts/receipts-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOTAUpdates } from '@/hooks/use-ota-updates';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    ExpletusSans_500Medium,
    ExpletusSans_700Bold,
  });
  const { checkAndApplyUpdate, isEnabled } = useOTAUpdates({
    checkOnMount: true,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

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

  if (!fontsLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <ReceiptsProvider>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
            <StatusBar style="auto" />
          </ReceiptsProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
