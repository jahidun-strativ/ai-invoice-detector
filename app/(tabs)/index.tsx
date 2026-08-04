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
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ReceiptCard } from '@/components/receipt/receipt-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ReceiptCardSkeleton, Skeleton } from '@/components/ui/skeleton';
import { INVOICE_TYPE_ICONS, INVOICE_TYPE_LABELS } from '@/constants/receipt-ui';
import { Colors } from '@/constants/theme';
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
        {/* Header */}
        <View style={[styles.header, { paddingTop: 16 }]}>
          <View>
            <Text style={[styles.greeting, { color: colors.textSecondary }]}>
              Welcome back 👋
            </Text>
            <ThemedText style={styles.title}>Receipt Scanner</ThemedText>
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
            {/* Hero: total spent */}
            <View style={[styles.heroCard, { backgroundColor: colors.heroBg }]}>
              <View style={styles.heroTopRow}>
                <Text style={[styles.heroLabel, { color: colors.heroTextMuted }]}>
                  Total Spent
                </Text>
                <View style={styles.heroIconChip}>
                  <IconSymbol name="banknote.fill" size={18} color="#fff" />
                </View>
              </View>
              <Text style={[styles.heroAmount, { color: colors.heroText }]}>
                {formatCurrency(stats?.total_amount ?? 0)}
              </Text>
              <Text style={[styles.heroSub, { color: colors.heroTextMuted }]}>
                across {stats?.total_count ?? 0} receipt
                {(stats?.total_count ?? 0) !== 1 ? 's' : ''}
              </Text>
            </View>

            {/* Stat tiles */}
            <View style={[styles.statTile, cardSurface, { width: cardWidth }]}>
              <View style={[styles.statIcon, { backgroundColor: colors.info + '1A' }]}>
                <IconSymbol name="doc.text.fill" size={20} color={colors.info} />
              </View>
              <View style={styles.statTileText}>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {stats?.total_count ?? 0}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                  Receipts
                </Text>
              </View>
            </View>

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

        {/* Quick Actions */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Quick Actions</ThemedText>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionCard, { backgroundColor: colors.tint }]}
              onPress={() => router.push('/(tabs)/capture')}
            >
              <IconSymbol name="camera.fill" size={28} color="#fff" />
              <Text style={styles.actionText}>Scan Receipt</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionCard, { backgroundColor: colors.surface }]}
              onPress={() => router.push('/(tabs)/history')}
            >
              <IconSymbol name="clock.fill" size={28} color={colors.tint} />
              <Text style={[styles.actionTextDark, { color: colors.text }]}>
                View History
              </Text>
            </TouchableOpacity>
          </View>
        </View>

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
            <View style={styles.emptyReceipts}>
              <IconSymbol name="doc.text.fill" size={48} color={colors.icon} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
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
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  greeting: {
    fontSize: 14,
    marginBottom: 4,
  },
  title: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  scanButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
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
    borderRadius: 24,
    padding: 22,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroLabel: {
    fontSize: 14,
    fontWeight: '600',
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
    fontWeight: '800',
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
    fontWeight: '800',
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
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '500',
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
    fontWeight: '600',
  },
  categoryLabel: {
    fontSize: 13,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionCard: {
    flex: 1,
    padding: 20,
    borderRadius: 20,
    alignItems: 'center',
    gap: 10,
  },
  actionText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  actionTextDark: {
    fontSize: 15,
    fontWeight: '600',
  },
  emptyReceipts: {
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
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
