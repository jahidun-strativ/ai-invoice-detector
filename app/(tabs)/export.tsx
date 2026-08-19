/**
 * Monthly Export Screen
 * One card per month that has receipts; tap Export to produce that month's
 * Bill Approval Sheet.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExportConfigModal } from '@/components/receipt/export-config-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Type } from '@/constants/theme';
import { ExportProvider, useExport } from '@/contexts/export-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MonthlyPeriodSummary } from '@/services/storage';
import { formatCurrency } from '@/utils/format';

function ExportScreenContent() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { periods, officeName, isLoading, error, refresh, selectPeriod } = useExport();

  const [modalSummary, setModalSummary] = useState<MonthlyPeriodSummary | null>(null);

  // Months change as receipts are scanned on other tabs
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const openExport = (summary: MonthlyPeriodSummary) => {
    selectPeriod(summary.period);
    setModalSummary(summary);
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ThemedText style={styles.title}>Monthly Export</ThemedText>
        <Text style={[styles.office, { color: colors.textSecondary }]}>
          {officeName}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.tint} />
        }
      >
        {error ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <IconSymbol name="exclamationmark.triangle.fill" size={28} color={colors.danger} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{error}</Text>
          </View>
        ) : null}

        {isLoading && periods.length === 0 ? (
          <ActivityIndicator style={styles.loader} color={colors.tint} />
        ) : null}

        {!isLoading && periods.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <IconSymbol name="tablecells" size={32} color={colors.textSecondary} />
            <ThemedText style={styles.emptyTitle}>No receipts yet</ThemedText>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Scan receipts through the month. They group here by month, ready to
              export as one sheet.
            </Text>
          </View>
        ) : null}

        {periods.map((summary) => {
          const key = `${summary.period.year}-${summary.period.month}`;
          return (
            <View
              key={key}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardInfo}>
                  <ThemedText style={styles.periodLabel}>{summary.period.label}</ThemedText>
                  <Text style={[styles.periodMeta, { color: colors.textSecondary }]}>
                    {summary.receiptCount} receipt{summary.receiptCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <View style={[styles.countBadge, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.countText, { color: colors.text }]}>
                    {summary.receiptCount}
                  </Text>
                </View>
              </View>

              <Text style={[styles.amount, { color: colors.text }]}>
                {formatCurrency(summary.totalAmount, summary.currency)}
              </Text>

              <TouchableOpacity
                style={[styles.exportButton, { backgroundColor: colors.tint }]}
                onPress={() => openExport(summary)}
              >
                <IconSymbol name="square.and.arrow.up" size={18} color="#fff" />
                <Text style={styles.exportText}>Export Sheet</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      <ExportConfigModal
        visible={modalSummary !== null}
        summary={modalSummary}
        onClose={() => setModalSummary(null)}
      />
    </ThemedView>
  );
}

export default function ExportScreen() {
  return (
    <ExportProvider>
      <ExportScreenContent />
    </ExportProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: {
    fontSize: 28,
    lineHeight: 36,
    fontFamily: Type.display,
    letterSpacing: -0.3,
  },
  office: { fontSize: 14, marginTop: 2 },
  content: { padding: 16, gap: 12 },
  loader: { marginTop: 40 },
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardInfo: { flex: 1, gap: 2 },
  periodLabel: { fontSize: 18, lineHeight: 24, fontFamily: Type.display },
  periodMeta: { fontSize: 13 },
  countBadge: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  countText: { fontSize: 15, fontFamily: Type.semibold },
  amount: { fontSize: 24, fontFamily: Type.display },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderRadius: 12,
    gap: 8,
  },
  exportText: { color: '#fff', fontSize: 15, fontFamily: Type.semibold },
  emptyCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: { fontSize: 17, fontFamily: Type.semibold },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
