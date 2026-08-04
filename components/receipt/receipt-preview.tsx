/**
 * Receipt Preview Component
 * Display parsed receipt data with all details
 */

import { StyleSheet, View, Text, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Receipt } from '@/types/receipt';
import { Colors } from '@/constants/theme';
import { INVOICE_TYPE_LABELS } from '@/constants/receipt-ui';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { formatCurrency } from '@/utils/format';
import { LineItemRow } from './line-item';

interface ReceiptPreviewProps {
  receipt: Receipt;
  showImage?: boolean;
}

export function ReceiptPreview({ receipt, showImage = true }: ReceiptPreviewProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const formattedDate = receipt.receipt_date
    ? new Date(receipt.receipt_date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Date not available';

  const hasError = !!receipt.error_message;
  const isLowConfidence = receipt.confidence_score < 0.5;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Image Preview */}
      {showImage && (
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: receipt.image_uri }}
            style={styles.image}
            contentFit="contain"
          />
        </View>
      )}

      {/* Error Banner */}
      {hasError && (
        <View style={styles.errorBanner}>
          <IconSymbol name="exclamationmark.triangle.fill" size={20} color="#fff" />
          <Text style={styles.errorBannerText}>{receipt.error_message}</Text>
        </View>
      )}

      {/* Low Confidence Warning */}
      {isLowConfidence && !hasError && (
        <View style={styles.warningBanner}>
          <IconSymbol name="exclamationmark.triangle.fill" size={20} color="#5D4E00" />
          <Text style={styles.warningBannerText}>
            Low confidence ({Math.round(receipt.confidence_score * 100)}%) - Please review
          </Text>
        </View>
      )}

      {/* Header Section */}
      <View style={styles.section}>
        <Text style={[styles.merchantName, { color: colors.text }]}>
          {receipt.merchant_name || 'Unknown Merchant'}
        </Text>
        <Text style={[styles.date, { color: colors.icon }]}>{formattedDate}</Text>

        <View style={styles.badges}>
          <View style={[styles.badge, { backgroundColor: colors.tint }]}>
            <Text style={styles.badgeText}>
              {INVOICE_TYPE_LABELS[receipt.invoice_type]}
            </Text>
          </View>
          {receipt.payment_method && (
            <View style={[styles.badge, { backgroundColor: '#4CAF50' }]}>
              <Text style={styles.badgeText}>{receipt.payment_method}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Receipt Info */}
      {receipt.receipt_number && (
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.icon }]}>
            Receipt #
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {receipt.receipt_number}
          </Text>
        </View>
      )}

      {/* Line Items */}
      {receipt.items.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Items ({receipt.items.length})
          </Text>
          <View style={styles.itemsContainer}>
            {receipt.items.map((item, index) => (
              <LineItemRow
                key={index}
                item={item}
                currency={receipt.currency}
              />
            ))}
          </View>
        </View>
      )}

      {/* Totals */}
      <View style={[styles.section, styles.totalsSection]}>
        {receipt.subtotal !== null && (
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.icon }]}>
              Subtotal
            </Text>
            <Text style={[styles.totalValue, { color: colors.text }]}>
              {formatCurrency(receipt.subtotal, receipt.currency)}
            </Text>
          </View>
        )}

        {receipt.tax !== null && (
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.icon }]}>Tax</Text>
            <Text style={[styles.totalValue, { color: colors.text }]}>
              {formatCurrency(receipt.tax, receipt.currency)}
            </Text>
          </View>
        )}

        <View style={[styles.totalRow, styles.grandTotalRow]}>
          <Text style={[styles.grandTotalLabel, { color: colors.text }]}>
            Total
          </Text>
          <Text style={[styles.grandTotalValue, { color: colors.tint }]}>
            {formatCurrency(receipt.total, receipt.currency)}
          </Text>
        </View>
      </View>

      {/* Confidence Score */}
      <View style={styles.confidenceContainer}>
        <Text style={[styles.confidenceLabel, { color: colors.icon }]}>
          Extraction Confidence
        </Text>
        <View style={styles.confidenceBar}>
          <View
            style={[
              styles.confidenceFill,
              {
                width: `${receipt.confidence_score * 100}%`,
                backgroundColor: getConfidenceColor(receipt.confidence_score),
              },
            ]}
          />
        </View>
        <Text style={[styles.confidenceValue, { color: colors.text }]}>
          {Math.round(receipt.confidence_score * 100)}%
        </Text>
      </View>
    </ScrollView>
  );
}

function getConfidenceColor(score: number): string {
  if (score >= 0.8) return '#4CAF50';
  if (score >= 0.5) return '#FFC107';
  return '#F44336';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  imageContainer: {
    height: 200,
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  image: {
    flex: 1,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F44336',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  errorBannerText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFC107',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  warningBannerText: {
    flex: 1,
    color: '#000',
    fontSize: 14,
  },
  section: {
    marginBottom: 20,
  },
  merchantName: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  date: {
    fontSize: 15,
    marginBottom: 12,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  badgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  itemsContainer: {
    gap: 8,
  },
  totalsSection: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  totalLabel: {
    fontSize: 15,
  },
  totalValue: {
    fontSize: 15,
  },
  grandTotalRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  grandTotalLabel: {
    fontSize: 18,
    fontWeight: '700',
  },
  grandTotalValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  confidenceContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 12,
  },
  confidenceLabel: {
    fontSize: 13,
    marginBottom: 8,
  },
  confidenceBar: {
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 4,
  },
  confidenceValue: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'right',
  },
});
