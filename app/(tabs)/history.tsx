/**
 * History Screen
 * List of processed receipts with filtering and search
 */

import { useState, useCallback, useEffect } from 'react';
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
import { router, useFocusEffect } from 'expo-router';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ReceiptCard } from '@/components/receipt/receipt-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getReceipts,
  deleteReceipt,
  searchReceipts,
  initDatabase,
} from '@/services/storage';
import { exportAndShare } from '@/services/export';
import { INVOICE_TYPE_LABELS } from '@/constants/receipt-ui';
import { Receipt, InvoiceType, ReceiptFilter } from '@/types/receipt';

const INVOICE_TYPES: { label: string; value: InvoiceType | 'all' }[] = [
  { label: 'All', value: 'all' },
  ...(Object.entries(INVOICE_TYPE_LABELS) as [InvoiceType, string][]).map(
    ([value, label]) => ({ label, value }),
  ),
];

export default function HistoryScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<InvoiceType | 'all'>('all');
  const [isExporting, setIsExporting] = useState(false);

  // Load receipts with current filter
  const loadReceipts = useCallback(async () => {
    try {
      setIsLoading(true);
      const filter: ReceiptFilter | undefined =
        selectedType !== 'all' ? { invoice_type: selectedType } : undefined;
      const data = await getReceipts(filter);
      setReceipts(data);
    } catch {
      Alert.alert('Error', 'Failed to load receipts');
    } finally {
      setIsLoading(false);
    }
  }, [selectedType]);

  // Initialize database and load receipts on mount
  useEffect(() => {
    async function init() {
      await initDatabase();
      await loadReceipts();
    }
    init();
  }, [loadReceipts]);

  // Reload when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadReceipts();
    }, [loadReceipts])
  );

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadReceipts();
    setIsRefreshing(false);
  }, [loadReceipts]);

  // Handle search
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      try {
        const results = await searchReceipts(query.trim());
        setReceipts(results);
      } catch {
        // Search failed silently
      }
    } else {
      loadReceipts();
    }
  }, [loadReceipts]);

  // Handle type filter change
  const handleTypeChange = useCallback((type: InvoiceType | 'all') => {
    setSelectedType(type);
    setSearchQuery('');
  }, []);

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
                await deleteReceipt(receiptId);
                setReceipts((prev) => prev.filter((r) => r.id !== receiptId));
              } catch {
                Alert.alert('Error', 'Failed to delete receipt');
              }
            },
          },
        ]
      );
    },
    []
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
              selectedType === item.value && {
                backgroundColor: colors.tint,
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
      <IconSymbol name="doc.text.fill" size={64} color={colors.icon} />
      <ThemedText style={styles.emptyTitle}>No Receipts Found</ThemedText>
      <Text style={[styles.emptyMessage, { color: colors.icon }]}>
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
    <ThemedView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
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
      <View style={styles.searchContainer}>
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

      {/* Receipt count */}
      <View style={styles.countContainer}>
        <Text style={[styles.countText, { color: colors.icon }]}>
          {receipts.length} receipt{receipts.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Receipt List */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
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
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
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
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
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
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  countContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  countText: {
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 100,
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
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
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
    fontWeight: '600',
  },
});
