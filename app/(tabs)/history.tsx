/**
 * History Screen
 * List of processed receipts with filtering and search
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  Text,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ReceiptCard } from '@/components/receipt/receipt-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ReceiptCardSkeleton } from '@/components/ui/skeleton';
import { Colors, Type } from '@/constants/theme';
import { useReceipts } from '@/contexts/receipts-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { exportAndShare } from '@/services/export';
import { INVOICE_TYPE_LABELS } from '@/constants/receipt-ui';
import { Receipt, InvoiceType } from '@/types/receipt';

const INVOICE_TYPES: { label: string; value: InvoiceType | 'all' }[] = [
  { label: 'All', value: 'all' },
  ...(Object.entries(INVOICE_TYPE_LABELS) as [InvoiceType, string][]).map(
    ([value, label]) => ({ label, value }),
  ),
];

export default function HistoryScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const { receipts, filter, status, setFilter, refresh, removeReceipt } =
    useReceipts();
  const selectedType = filter.type;

  const [searchQuery, setSearchQuery] = useState(filter.searchQuery);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Debounce search input into the shared filter (300ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  }, [refresh]);

  // Handle search
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setFilter({ searchQuery: query });
      }, 300);
    },
    [setFilter]
  );

  // Handle type filter change
  const handleTypeChange = useCallback(
    (type: InvoiceType | 'all') => {
      Haptics.selectionAsync();
      setSearchQuery('');
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setFilter({ type, searchQuery: '' });
    },
    [setFilter]
  );

  // Handle delete receipt
  const handleDelete = useCallback(
    async (receiptId: string) => {
      Alert.alert(
        'Delete Receipt',
        'Are you sure you want to delete this receipt?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await removeReceipt(receiptId);
              } catch {
                Alert.alert('Error', 'Failed to delete receipt');
              }
            },
          },
        ]
      );
    },
    [removeReceipt]
  );

  // Handle export all
  const handleExportAll = useCallback(async () => {
    if (receipts.length === 0) {
      Alert.alert('No Receipts', 'There are no receipts to export');
      return;
    }

    Alert.alert('Export Receipts', 'Choose export format', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'JSON',
        onPress: async () => {
          try {
            setIsExporting(true);
            await exportAndShare(receipts, 'json');
          } catch {
            Alert.alert('Error', 'Failed to export receipts');
          } finally {
            setIsExporting(false);
          }
        },
      },
      {
        text: 'CSV',
        onPress: async () => {
          try {
            setIsExporting(true);
            await exportAndShare(receipts, 'csv');
          } catch {
            Alert.alert('Error', 'Failed to export receipts');
          } finally {
            setIsExporting(false);
          }
        },
      },
    ]);
  }, [receipts]);

  // Navigate to receipt detail
  const handleReceiptPress = useCallback((receipt: Receipt) => {
    router.push(`/receipt/${receipt.id}`);
  }, []);

  // Render filter chips
  const renderFilters = () => (
    <View style={styles.filtersContainer}>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={INVOICE_TYPES}
        keyExtractor={(item) => item.value}
        contentContainerStyle={styles.filtersList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.filterChip,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth: 1,
              },
              selectedType === item.value && {
                backgroundColor: colors.tint,
                borderColor: colors.tint,
              },
            ]}
            onPress={() => handleTypeChange(item.value)}
          >
            <Text
              style={[
                styles.filterChipText,
                { color: selectedType === item.value ? '#fff' : colors.text },
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );

  // Render empty state
  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconCircle, { backgroundColor: colors.tint + '14' }]}>
        <IconSymbol name="doc.text.fill" size={32} color={colors.tint} />
      </View>
      <ThemedText style={styles.emptyTitle}>No Receipts Found</ThemedText>
      <Text style={[styles.emptyMessage, { color: colors.textSecondary }]}>
        {searchQuery
          ? 'Try a different search term'
          : 'Capture your first receipt to get started'}
      </Text>
      {!searchQuery && (
        <TouchableOpacity
          style={[styles.emptyButton, { backgroundColor: colors.tint }]}
          onPress={() => router.push('/(tabs)/capture')}
        >
          <IconSymbol name="camera.fill" size={20} color="#fff" />
          <Text style={styles.emptyButtonText}>Scan Receipt</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: 12 }]}>
        <ThemedText style={styles.title}>Receipt History</ThemedText>
        <TouchableOpacity
          style={styles.exportButton}
          onPress={handleExportAll}
          disabled={isExporting || receipts.length === 0}
        >
          {isExporting ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <IconSymbol
              name="square.and.arrow.up"
              size={24}
              color={receipts.length > 0 ? colors.tint : colors.icon}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={[styles.searchContainer, { backgroundColor: colors.surface }]}>
        <IconSymbol name="magnifyingglass" size={20} color={colors.icon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search by merchant name..."
          placeholderTextColor={colors.icon}
          value={searchQuery}
          onChangeText={handleSearch}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => handleSearch('')}>
            <IconSymbol name="xmark.circle.fill" size={20} color={colors.icon} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filters */}
      {renderFilters()}

      {/* Receipt count + background refresh indicator */}
      <View style={styles.countContainer}>
        <Text style={[styles.countText, { color: colors.textSecondary }]}>
          {receipts.length} receipt{receipts.length !== 1 ? 's' : ''}
        </Text>
        {status === 'loading' && !isRefreshing && (
          <ActivityIndicator size="small" color={colors.tint} />
        )}
      </View>

      {/* Receipt List — keep the last list rendered during background
          refreshes; only the very first load shows a spinner */}
      {status === 'initializing' ? (
        <View>
          <ReceiptCardSkeleton />
          <ReceiptCardSkeleton />
          <ReceiptCardSkeleton />
          <ReceiptCardSkeleton />
        </View>
      ) : (
        <FlatList
          data={receipts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ReceiptCard
              receipt={item}
              onPress={() => handleReceiptPress(item)}
              onDelete={() => handleDelete(item.id)}
            />
          )}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.tint}
            />
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    fontFamily: Type.display,
    letterSpacing: -0.3,
  },
  exportButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  filtersContainer: {
    marginTop: 12,
  },
  filtersList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 14,
    fontFamily: Type.medium,
  },
  countContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  countText: {
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 150,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    marginTop: 60,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: Type.semibold,
    marginTop: 16,
  },
  emptyMessage: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
    gap: 8,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: Type.semibold,
  },
});
