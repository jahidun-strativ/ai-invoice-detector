/**
 * Dashboard Screen
 * Home screen with stats, quick actions, and recent receipts
 */

import { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  Text,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ReceiptCard } from '@/components/receipt/receipt-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ReceiptCardSkeleton, Skeleton } from '@/components/ui/skeleton';
import { INVOICE_TYPE_ICONS, INVOICE_TYPE_LABELS } from '@/constants/receipt-ui';
import { Colors, Type } from '@/constants/theme';
import { useReceipts } from '@/contexts/receipts-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InvoiceType } from '@/types/receipt';
import { formatCurrency } from '@/utils/format';

export default function DashboardScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardWidth = (width - 48) / 2;

  const { stats, recent: recentReceipts, status, error, refresh } = useReceipts();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isFirstLoad = status === 'initializing';
  const cardSurface = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  };

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  }, [refresh]);

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.tint}
          />
        }
      >
        {/* Header — "[Product] BY STRATIV" lockup */}
        <View style={[styles.header, { paddingTop: 16 }]}>
          <View style={styles.brandRow}>
            <Image
              source={require('@/assets/brand/symbol-orange.svg')}
              style={styles.brandSymbol}
              contentFit="contain"
            />
            <View>
              <ThemedText style={styles.title}>Receipt Scanner</ThemedText>
              <Text style={[styles.byStrativ, { color: colors.icon }]}>
                BY STRATIV
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.scanButton, { backgroundColor: colors.tint }]}
            onPress={() => router.push('/(tabs)/capture')}
          >
            <IconSymbol name="camera.fill" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Load error */}
        {error && (
          <View style={[styles.errorBanner, { backgroundColor: colors.danger + '20' }]}>
            <IconSymbol name="exclamationmark.triangle.fill" size={18} color={colors.danger} />
            <Text style={[styles.errorBannerText, { color: colors.danger }]}>{error}</Text>
          </View>
        )}

        {/* Hero total + stat tiles */}
        {isFirstLoad ? (
          <View style={styles.statsGrid}>
            <Skeleton width="100%" height={160} radius={24} />
            <Skeleton width={cardWidth} height={104} radius={20} />
            <Skeleton width={cardWidth} height={104} radius={20} />
          </View>
        ) : (
          <Animated.View entering={FadeIn.duration(300)} style={styles.statsGrid}>
            {/* Hero: documents digitized — solid orange fill (brand rule: no gradients) */}
            <View style={[styles.heroCard, { backgroundColor: colors.heroBg }]}>
              <View style={styles.heroTopRow}>
                <Text style={[styles.heroLabel, { color: colors.heroTextMuted }]}>
                  Receipts Digitized
                </Text>
                <View style={styles.heroIconChip}>
                  <IconSymbol name="doc.text.fill" size={18} color="#fff" />
                </View>
              </View>
              <Text style={[styles.heroAmount, { color: colors.heroText }]}>
                {stats?.total_count ?? 0}
              </Text>
              <Text style={[styles.heroSub, { color: colors.heroTextMuted }]}>
                {formatCurrency(stats?.total_amount ?? 0)} total recorded value
              </Text>
            </View>

            {/* Stat tiles */}
            <View style={[styles.statTile, cardSurface, { width: cardWidth }]}>
              <View style={[styles.statIcon, { backgroundColor: colors.success + '1A' }]}>
                <IconSymbol name="calendar" size={20} color={colors.success} />
              </View>
              <View style={styles.statTileText}>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {stats?.this_month_count ?? 0}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                  This Month
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.statTile, cardSurface, { width: cardWidth }]}
              onPress={() => router.push('/(tabs)/history')}
            >
              <View style={[styles.statIcon, { backgroundColor: colors.warning + '1A' }]}>
                <IconSymbol
                  name="exclamationmark.triangle.fill"
                  size={20}
                  color={colors.warning}
                />
              </View>
              <View style={styles.statTileText}>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {stats?.needs_review_count ?? 0}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                  Needs Review
                </Text>
              </View>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Category Breakdown */}
        {stats && stats.total_count > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>By Category</ThemedText>
            <View style={styles.categoriesGrid}>
              {(Object.keys(stats.by_type) as InvoiceType[])
                .filter((type) => stats.by_type[type] > 0)
                .map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.categoryCard, { backgroundColor: colors.surface }]}
                    onPress={() => router.push('/(tabs)/history')}
                  >
                    <IconSymbol
                      name={INVOICE_TYPE_ICONS[type]}
                      size={20}
                      color={colors.tint}
                    />
                    <Text style={[styles.categoryCount, { color: colors.text }]}>
                      {stats.by_type[type]}
                    </Text>
                    <Text style={[styles.categoryLabel, { color: colors.textSecondary }]}>
                      {INVOICE_TYPE_LABELS[type]}
                    </Text>
                  </TouchableOpacity>
                ))}
            </View>
          </View>
        )}

        {/* Recent Receipts */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>Recent Receipts</ThemedText>
            {recentReceipts.length > 0 && (
              <TouchableOpacity onPress={() => router.push('/(tabs)/history')}>
                <Text style={[styles.seeAllText, { color: colors.tint }]}>
                  See All
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {isFirstLoad ? (
            <View style={styles.recentList}>
              <ReceiptCardSkeleton />
              <ReceiptCardSkeleton />
              <ReceiptCardSkeleton />
            </View>
          ) : recentReceipts.length === 0 ? (
            <View style={[styles.emptyReceipts, cardSurface, { borderRadius: 20 }]}>
              <View style={[styles.emptyIconCircle, { backgroundColor: colors.tint + '14' }]}>
                <IconSymbol name="doc.text.fill" size={28} color={colors.tint} />
              </View>
              <Text style={[styles.emptyText, { color: colors.text }]}>
                No receipts yet
              </Text>
              <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
                Scan your first receipt to get started
              </Text>
            </View>
          ) : (
            <View style={styles.recentList}>
              {recentReceipts.map((receipt) => (
                <ReceiptCard
                  key={receipt.id}
                  receipt={receipt}
                  onPress={() => router.push(`/receipt/${receipt.id}`)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 150,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandSymbol: {
    width: 36,
    height: 36,
  },
  title: {
    fontSize: 26,
    lineHeight: 34,
    fontFamily: Type.display,
    letterSpacing: -0.3,
  },
  byStrativ: {
    fontFamily: Type.regular,
    fontSize: 10,
    letterSpacing: 1.2,
    marginTop: 1,
  },
  scanButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  heroCard: {
    width: '100%',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroLabel: {
    fontSize: 14,
    fontFamily: Type.semibold,
    letterSpacing: 0.3,
  },
  heroIconChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroAmount: {
    fontSize: 34,
    fontFamily: Type.heavy,
    letterSpacing: -0.8,
    marginTop: 12,
  },
  heroSub: {
    fontSize: 13,
    marginTop: 6,
  },
  statTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
  },
  statTileText: {
    flex: 1,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 14,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontFamily: Type.heavy,
    letterSpacing: -0.3,
  },
  statLabel: {
    fontSize: 13,
    marginTop: 2,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 19,
    fontFamily: Type.display,
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  seeAllText: {
    fontSize: 14,
    fontFamily: Type.medium,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
  },
  categoryCount: {
    fontSize: 15,
    fontFamily: Type.semibold,
  },
  categoryLabel: {
    fontSize: 13,
  },
  emptyReceipts: {
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 16,
    fontFamily: Type.medium,
    marginTop: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
  recentList: {
    marginHorizontal: -16,
  },
});
