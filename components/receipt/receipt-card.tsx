/**
 * Receipt Card Component
 * Display receipt summary in a list
 */

import { StyleSheet, View, TouchableOpacity, Text } from 'react-native';
import { Image } from 'expo-image';
import { Receipt } from '@/types/receipt';
import { Colors } from '@/constants/theme';
import { INVOICE_TYPE_ICONS, getInvoiceTypeColor } from '@/constants/receipt-ui';
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

  const hasError = !!receipt.error_message;
  const isLowConfidence = receipt.confidence_score < 0.5;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: colors.background },
        hasError && styles.errorContainer,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Thumbnail */}
      <View style={styles.thumbnailContainer}>
        <Image
          source={{ uri: receipt.image_uri }}
          style={styles.thumbnail}
          contentFit="cover"
        />
        <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
          <IconSymbol name={typeIcon} size={14} color="#fff" />
        </View>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.header}>
          <Text
            style={[styles.merchantName, { color: colors.text }]}
            numberOfLines={1}
          >
            {receipt.merchant_name || 'Unknown Merchant'}
          </Text>
          {(hasError || isLowConfidence) && (
            <IconSymbol
              name="exclamationmark.triangle.fill"
              size={16}
              color={hasError ? '#F44336' : '#FFC107'}
            />
          )}
        </View>

        <Text style={[styles.date, { color: colors.icon }]}>{formattedDate}</Text>

        <View style={styles.footer}>
          <Text style={[styles.itemCount, { color: colors.icon }]}>
            {receipt.items.length} item{receipt.items.length !== 1 ? 's' : ''}
          </Text>
          <Text style={[styles.total, { color: colors.tint }]}>
            {formattedTotal}
          </Text>
        </View>

        {hasError && (
          <Text style={styles.errorText} numberOfLines={1}>
            {receipt.error_message}
          </Text>
        )}
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
          <IconSymbol name="trash.fill" size={18} color="#F44336" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  errorContainer: {
    borderWidth: 1,
    borderColor: '#F44336',
  },
  thumbnailContainer: {
    position: 'relative',
    width: 60,
    height: 80,
    marginRight: 12,
  },
  thumbnail: {
    width: 60,
    height: 80,
    borderRadius: 8,
  },
  typeBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  merchantName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  date: {
    fontSize: 13,
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  itemCount: {
    fontSize: 13,
  },
  total: {
    fontSize: 18,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 12,
    color: '#F44336',
    marginTop: 4,
  },
  deleteButton: {
    justifyContent: 'center',
    paddingLeft: 12,
  },
});
