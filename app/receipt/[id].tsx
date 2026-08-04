/**
 * Receipt Detail Screen
 * View full receipt details and export options
 */

import { ReceiptEditModal } from '@/components/receipt/receipt-edit-modal';
import { ReceiptPreview } from '@/components/receipt/receipt-preview';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useReceipts } from '@/contexts/receipts-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { exportAndShare } from '@/services/export';
import { getReceiptById } from '@/services/storage';
import { Receipt, ReceiptInput } from '@/types/receipt';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ReceiptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const { receipts, recent, removeReceipt, updateReceiptById } = useReceipts();

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [showJsonPreview, setShowJsonPreview] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Load receipt: prefer the copy already in context, fall back to the DB
  // (e.g. deep links or receipts outside the current filter).
  useEffect(() => {
    async function loadReceipt() {
      if (!id) {
        Alert.alert('Error', 'Receipt ID not found');
        router.back();
        return;
      }

      const cached =
        receipts.find((r) => r.id === id) ?? recent.find((r) => r.id === id);
      if (cached) {
        setReceipt(cached);
        setIsLoading(false);
        return;
      }

      try {
        const data = await getReceiptById(id);
        if (data) {
          setReceipt(data);
        } else {
          Alert.alert('Error', 'Receipt not found');
          router.back();
        }
      } catch {
        Alert.alert('Error', 'Failed to load receipt');
        router.back();
      } finally {
        setIsLoading(false);
      }
    }

    loadReceipt();
    // Intentionally keyed on id only: context list churn must not re-trigger
    // load (and would fight local edits before the refresh lands).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Handle export
  const handleExport = useCallback((format: 'json' | 'csv') => {
    if (!receipt) return;

    Alert.alert(`Export as ${format.toUpperCase()}`, 'Share the exported file?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Export & Share',
        onPress: async () => {
          try {
            setIsExporting(true);
            await exportAndShare([receipt], format);
          } catch {
            Alert.alert('Error', 'Failed to export receipt');
          } finally {
            setIsExporting(false);
          }
        },
      },
    ]);
  }, [receipt]);

  // Handle delete
  const handleDelete = useCallback(() => {
    if (!receipt) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Delete Receipt',
      'Are you sure you want to delete this receipt? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeReceipt(receipt.id);
              Alert.alert('Deleted', 'Receipt has been deleted');
              router.back();
            } catch {
              Alert.alert('Error', 'Failed to delete receipt');
            }
          },
        },
      ]
    );
  }, [receipt, removeReceipt]);

  // Handle save edited receipt
  const handleSaveEditedReceipt = useCallback(
    async (updatedReceipt: ReceiptInput) => {
      if (!receipt) return;

      const savedReceipt = await updateReceiptById(receipt.id, updatedReceipt);
      if (savedReceipt) {
        setReceipt(savedReceipt);
      }
    },
    [receipt, updateReceiptById]
  );

  // Format receipt as JSON for preview (excluding image_uri for cleaner view)
  const getJsonPreview = useCallback(() => {
    if (!receipt) return '';
    
    const previewData = {
      merchant_name: receipt.merchant_name,
      receipt_date: receipt.receipt_date,
      receipt_number: receipt.receipt_number,
      invoice_type: receipt.invoice_type,
      items: receipt.items,
      subtotal: receipt.subtotal,
      tax: receipt.tax,
      total: receipt.total,
      currency: receipt.currency,
      payment_method: receipt.payment_method,
      confidence_score: receipt.confidence_score,
    };
    
    return JSON.stringify(previewData, null, 2);
  }, [receipt]);

  // Loading state
  if (isLoading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <ActivityIndicator size="large" color={colors.tint} />
      </ThemedView>
    );
  }

  // Not found
  if (!receipt) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <IconSymbol name="doc.questionmark.fill" size={64} color={colors.icon} />
        <ThemedText style={styles.notFoundText}>Receipt not found</ThemedText>
      </ThemedView>
    );
  }

  // Full image view
  if (showFullImage) {
    return (
      <View style={styles.fullImageContainer}>
        <Stack.Screen
          options={{
            title: 'Receipt Image',
            headerStyle: { backgroundColor: '#000' },
            headerTintColor: '#fff',
          }}
        />
        <TouchableOpacity
          style={[styles.fullImageClose, { top: insets.top + 12 }]}
          onPress={() => setShowFullImage(false)}
        >
          <IconSymbol name="xmark" size={28} color="#fff" />
        </TouchableOpacity>
        <Image
          source={{ uri: receipt.image_uri }}
          style={styles.fullImage}
          contentFit="contain"
        />
      </View>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: receipt.merchant_name || 'Receipt Details',
          headerRight: () => (
            <View style={styles.headerButtons}>
              <TouchableOpacity
                onPress={() => setShowEditModal(true)}
                style={styles.headerButton}
              >
                <IconSymbol name="pencil" size={22} color={colors.tint} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDelete}
                style={styles.headerButton}
              >
                <IconSymbol name="trash.fill" size={22} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      <ScrollView style={styles.scrollView}>
        {/* Tappable Image */}
        <TouchableOpacity
          style={styles.imageContainer}
          onPress={() => setShowFullImage(true)}
          activeOpacity={0.8}
        >
          <Image
            source={{ uri: receipt.image_uri }}
            style={styles.image}
            contentFit="cover"
            transition={200}
          />
          <View style={styles.imageOverlay}>
            <IconSymbol name="arrow.up.left.and.arrow.down.right" size={24} color="#fff" />
            <Text style={styles.imageOverlayText}>Tap to enlarge</Text>
          </View>
        </TouchableOpacity>

        {/* JSON Preview Button */}
        <TouchableOpacity
          style={[styles.jsonPreviewButton, { borderColor: colors.tint }]}
          onPress={() => setShowJsonPreview(true)}
        >
          <IconSymbol name="curlybraces" size={20} color={colors.tint} />
          <Text style={[styles.jsonPreviewButtonText, { color: colors.tint }]}>
            Preview JSON Schema
          </Text>
        </TouchableOpacity>

        {/* Receipt Preview */}
        <ReceiptPreview receipt={receipt} showImage={false} />
      </ScrollView>

      {/* JSON Preview Modal */}
      <Modal
        visible={showJsonPreview}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowJsonPreview(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>JSON Schema</Text>
            <TouchableOpacity
              onPress={() => setShowJsonPreview(false)}
              style={styles.modalCloseButton}
            >
              <IconSymbol name="xmark" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          
          <ScrollView 
            style={styles.jsonScrollView}
            contentContainerStyle={styles.jsonContentContainer}
          >
            <View style={[styles.jsonContainer, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
              <Text
                style={[styles.jsonText, { color: colors.tint }]}
                selectable
              >
                {getJsonPreview()}
              </Text>
            </View>
          </ScrollView>

          <View style={[styles.modalActions, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.modalActionButton, { backgroundColor: colors.success }]}
              onPress={() => {
                setShowJsonPreview(false);
                handleExport('json');
              }}
            >
              <IconSymbol name="square.and.arrow.up" size={20} color="#fff" />
              <Text style={styles.modalActionButtonText}>Export JSON</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Action Buttons */}
      <View
        style={[
          styles.actionsContainer,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + 12 },
        ]}
      >
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.success }]}
          onPress={() => handleExport('json')}
          disabled={isExporting}
        >
          {isExporting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <IconSymbol name="curlybraces" size={20} color="#fff" />
              <Text style={styles.actionButtonText}>JSON</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.info }]}
          onPress={() => handleExport('csv')}
          disabled={isExporting}
        >
          {isExporting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <IconSymbol name="tablecells" size={20} color="#fff" />
              <Text style={styles.actionButtonText}>CSV</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.tint }]}
          onPress={() => router.push('/(tabs)/capture')}
        >
          <IconSymbol name="camera.fill" size={20} color="#fff" />
          <Text style={styles.actionButtonText}>New</Text>
        </TouchableOpacity>
      </View>

      <ReceiptEditModal
        visible={showEditModal}
        receipt={receipt}
        onClose={() => setShowEditModal(false)}
        onSave={handleSaveEditedReceipt}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  notFoundText: {
    fontSize: 18,
    marginTop: 16,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    padding: 8,
  },
  scrollView: {
    flex: 1,
  },
  imageContainer: {
    height: 200,
    margin: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  image: {
    flex: 1,
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  imageOverlayText: {
    color: '#fff',
    fontSize: 14,
  },
  fullImageContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  fullImageClose: {
    position: 'absolute',
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    flex: 1,
  },
  jsonPreviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 2,
    gap: 8,
  },
  jsonPreviewButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  modalCloseButton: {
    padding: 4,
  },
  jsonScrollView: {
    flex: 1,
  },
  jsonContentContainer: {
    padding: 16,
  },
  jsonContainer: {
    borderRadius: 12,
    padding: 16,
  },
  jsonText: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
  modalActions: {
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modalActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  modalActionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  actionsContainer: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 32,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
