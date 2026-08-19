/**
 * Tab Layout
 * Bottom tab navigation for main app screens
 */

import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          position: 'absolute',
          bottom: insets.bottom + 12,
          marginHorizontal: 16,
          height: 68,
          borderRadius: 34,
          backgroundColor: colors.card,
          // Let the raised Scan button sit proud of the pill
          overflow: 'visible',
          borderTopWidth: 0,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          paddingTop: 8,
          paddingBottom: 10,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.18,
          shadowRadius: 16,
          elevation: 10,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: Type.semibold,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol
              size={28}
              name={focused ? 'house.fill' : 'house'}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol
              size={28}
              name={focused ? 'clock.fill' : 'clock'}
              color={color}
            />
          ),
        }}
      />
      {/* Centre slot: the app's primary action, raised out of the pill.
          Works as a true centre only because there are five tabs. */}
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Scan',
          tabBarShowLabel: false,
          tabBarIcon: ({ focused }) => (
            <View
              style={[
                styles.scanButton,
                {
                  backgroundColor: colors.tint,
                  borderColor: colors.card,
                  shadowColor: colors.warmBlack,
                },
                focused && styles.scanButtonFocused,
              ]}
            >
              <IconSymbol size={26} name="camera.fill" color="#fff" />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="export"
        options={{
          title: 'Export',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="tablecells" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol
              size={28}
              name={focused ? 'gearshape.fill' : 'gearshape'}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scanButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    // Raised out of the pill; the ring in card colour reads as a cut-out
    marginTop: -24,
    borderWidth: 4,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    elevation: 8,
  },
  scanButtonFocused: {
    // Solid fill only — brand rule forbids gradients, so pressed state is a
    // subtle lift rather than a colour shift
    shadowOpacity: 0.34,
    elevation: 12,
  },
});
