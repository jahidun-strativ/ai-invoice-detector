/**
 * Pulsing skeleton placeholders for first-load states.
 */

import { useEffect } from 'react';
import { DimensionValue, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 16, radius = Radius.sm, style }: SkeletonProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.5, { duration: 700 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.skeleton },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Placeholder matching the ReceiptCard layout for list first-loads. */
export function ReceiptCardSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton width={56} height={56} radius={Radius.md} />
      <View style={styles.cardBody}>
        <Skeleton width="70%" height={16} />
        <Skeleton width="40%" height={12} />
      </View>
      <Skeleton width={64} height={18} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
  },
  cardBody: {
    flex: 1,
    gap: 8,
  },
});
