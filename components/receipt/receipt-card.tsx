/**
 * Receipt Card Component
 * Display receipt summary in a list
 */

import { StyleSheet, View, TouchableOpacity, Text } from 'react-native';
import { Image } from 'expo-image';
import { Receipt } from '@/types/receipt';
import { Colors } from '@/constants/theme';
import {
  INVOICE_TYPE_ICONS,
  INVOICE_TYPE_LABELS,
  getInvoiceTypeColor,
} from '@/constants/receipt-ui';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { formatCurrency, formatDate } from '@/utils/format';

interface ReceiptCardProps {
  receipt: Receipt;
  onPress: () => void;
  onDelete?: () => void;
}

export function ReceiptCard({ receipt, onPress, onDelete }: ReceiptCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const formattedDate = formatDate(receipt.receipt_date);
  const formattedTotal = formatCurrency(receipt.total, receipt.currency);

  const typeColor = getInvoiceTypeColor(receipt.invoice_type, colors);
  const typeIcon = INVOICE_TYPE_ICONS[receipt.invoice_type];
  const typeLabel = INVOICE_TYPE_LABELS[receipt.invoice_type];

  const hasError = !!receipt.error_message;
  const needsReview = hasError || receipt.confidence_score < 0.5;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Thumbnail */}
      <Image
        source={{ uri: receipt.image_uri }}
        style={styles.thumbnail}
        contentFit="cover"
        transition={200}
        placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
      />

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text
            style={[styles.merchantName, { color: colors.text }]}
            numberOfLines={1}
          >
            {receipt.merchant_name || 'Unknown Merchant'}
          </Text>
          <Text style={[styles.total, { color: colors.text }]}>
            {formattedTotal}
          </Text>
        </View>

        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {formattedDate} · {receipt.items.length} item
          {receipt.items.length !== 1 ? 's' : ''}
        </Text>

        <View style={styles.chipRow}>
          <View style={[styles.chip, { backgroundColor: typeColor + '1A' }]}>
            <IconSymbol name={typeIcon} size={12} color={typeColor} />
            <Text style={[styles.chipText, { color: typeColor }]}>{typeLabel}</Text>
          </View>
          {needsReview && (
            <View
              style={[
                styles.chip,
                { backgroundColor: (hasError ? colors.danger : colors.warning) + '1A' },
              ]}
            >
              <IconSymbol
                name="exclamationmark.triangle.fill"
                size={12}
                color={hasError ? colors.danger : colors.warning}
              />
              <Text
                style={[
                  styles.chipText,
                  { color: hasError ? colors.danger : colors.warning },
                ]}
              >
                {hasError ? 'Failed' : 'Review'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Delete button */}
      {onDelete && (
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <IconSymbol name="trash.fill" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 18,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  thumbnail: {
    width: 56,
    height: 72,
    borderRadius: 12,
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  merchantName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  total: {
    fontSize: 15,
    fontWeight: '700',
  },
  meta: {
    fontSize: 13,
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  deleteButton: {
    justifyContent: 'center',
    paddingLeft: 4,
  },
});
