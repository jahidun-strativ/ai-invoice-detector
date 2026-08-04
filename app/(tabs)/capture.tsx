/**
 * Capture Screen
 * Camera/upload screen with receipt processing flow
 */

import { CameraCapture } from '@/components/receipt/camera-capture';
import { ReceiptEditModal } from '@/components/receipt/receipt-edit-modal';
import { ReceiptPreview } from '@/components/receipt/receipt-preview';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useReceipts } from '@/contexts/receipts-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  parseReceiptWithRetry,
  validateImage,
} from '@/services/ai-vision';
import { ProcessingState, Receipt, ReceiptInput } from '@/types/receipt';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function CaptureScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const { addReceipt, updateReceiptById } = useReceipts();

  const [state, setState] = useState<ProcessingState>('idle');
  const [capturedImageUri, setCapturedImageUri] = useState<string | null>(null);
  const [processedReceipt, setProcessedReceipt] = useState<Receipt | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Reset the success screen when the user leaves the tab, so returning
  // shows the camera instead of a stale "Receipt Processed!" screen.
  useFocusEffect(
    useCallback(() => {
      return () => {
        setState((current) => (current === 'success' ? 'idle' : current));
        setShowEditModal(false);
      };
    }, [])
  );

  // Handle image capture
  const handleCapture = useCallback(async (imageUri: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCapturedImageUri(imageUri);
    setState('processing');
    setErrorMessage(null);

    try {
      // Validate image first
      const validation = await validateImage(imageUri);
      if (!validation.valid) {
        setErrorMessage(validation.error || 'Invalid image');
        setState('error');
        return;
      }

      // Extract structured data with the AI vision API
      const result = await parseReceiptWithRetry(imageUri);

      // Create receipt input
      const receiptInput: ReceiptInput = {
        merchant_name: result.merchant_name,
        receipt_date: result.receipt_date,
        receipt_number: result.receipt_number,
        invoice_type: result.invoice_type,
        items: result.items,
        subtotal: result.subtotal,
        tax: result.tax,
        total: result.total ?? 0,
        currency: result.currency,
        payment_method: result.payment_method,
        confidence_score: result.confidence_score,
        image_uri: imageUri,
        raw_text: result.raw_text ?? null,
        error_message: result.error_message ?? null,
      };

      // Save to database (context keeps dashboard/history in sync)
      const savedReceipt = await addReceipt(receiptInput);
      setProcessedReceipt(savedReceipt);
      setState('success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error processing receipt:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to process receipt'
      );
      setState('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [addReceipt]);

  // Reset to capture new receipt
  const handleReset = useCallback(() => {
    setState('idle');
    setCapturedImageUri(null);
    setProcessedReceipt(null);
    setErrorMessage(null);
  }, []);

  // View receipt details
  const handleViewDetails = useCallback(() => {
    if (processedReceipt) {
      router.push(`/receipt/${processedReceipt.id}`);
    }
  }, [processedReceipt]);

  // Handle edit receipt
  const handleEditReceipt = useCallback(() => {
    setShowEditModal(true);
  }, []);

  // Handle save edited receipt
  const handleSaveEditedReceipt = useCallback(
    async (updatedReceipt: ReceiptInput) => {
      if (!processedReceipt) return;

      const savedReceipt = await updateReceiptById(
        processedReceipt.id,
        updatedReceipt
      );
      if (savedReceipt) {
        setProcessedReceipt(savedReceipt);
      }
    },
    [processedReceipt, updateReceiptById]
  );

  // Save with error - for cases where image couldn't be parsed
  const handleSaveWithError = useCallback(async () => {
    if (!capturedImageUri) return;

    try {
      const receiptInput: ReceiptInput = {
        merchant_name: null,
        receipt_date: null,
        receipt_number: null,
        invoice_type: 'unknown',
        items: [],
        subtotal: null,
        tax: null,
        total: 0,
        currency: 'BDT',
        payment_method: null,
        confidence_score: 0,
        image_uri: capturedImageUri,
        raw_text: null,
        error_message: errorMessage || 'Failed to process receipt',
      };

      const savedReceipt = await addReceipt(receiptInput);
      setProcessedReceipt(savedReceipt);
      setState('success');

      Alert.alert(
        'Receipt Saved',
        'The receipt image has been saved. You can edit the details manually later.',
        [{ text: 'OK' }]
      );
    } catch {
      Alert.alert('Error', 'Failed to save receipt');
    }
  }, [capturedImageUri, errorMessage, addReceipt]);

  // Render based on state
  if (state === 'idle' || state === 'capturing' || state === 'processing') {
    return (
      <CameraCapture
        onCapture={handleCapture}
        isProcessing={state === 'processing'}
      />
    );
  }

  if (state === 'error') {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.errorContainer, { paddingTop: insets.top }]}>
          <IconSymbol
            name="exclamationmark.triangle.fill"
            size={64}
            color={colors.danger}
          />
          <ThemedText style={styles.errorTitle}>Processing Failed</ThemedText>
          <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>
            {errorMessage || 'Unable to process the receipt image'}
          </Text>

          <View style={styles.errorActions}>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.tint }]}
              onPress={handleReset}
            >
              <IconSymbol name="camera.fill" size={20} color="#fff" />
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
              onPress={handleSaveWithError}
            >
              <IconSymbol name="square.and.arrow.down" size={20} color={colors.tint} />
              <Text style={[styles.buttonText, { color: colors.tint }]}>
                Save Anyway
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ThemedView>
    );
  }

  if (state === 'success' && processedReceipt) {
    return (
      <ThemedView style={styles.container}>
        <Animated.View
          entering={FadeInDown.duration(400)}
          style={[styles.successHeader, { paddingTop: insets.top + 12 }]}
        >
          <IconSymbol name="checkmark.circle.fill" size={32} color={colors.success} />
          <ThemedText style={styles.successTitle}>Receipt Processed!</ThemedText>
        </Animated.View>

        <ScrollView style={styles.previewScroll}>
          <ReceiptPreview receipt={processedReceipt} showImage={true} />
        </ScrollView>

        <View style={styles.successActions}>
          <TouchableOpacity
            style={[styles.button, styles.outlineButton, { borderColor: colors.tint }]}
            onPress={handleReset}
          >
            <IconSymbol name="camera.fill" size={20} color={colors.tint} />
            <Text style={[styles.buttonText, { color: colors.tint }]}>
              Scan Another
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.outlineButton, { borderColor: colors.tint }]}
            onPress={handleEditReceipt}
          >
            <IconSymbol name="pencil" size={20} color={colors.tint} />
            <Text style={[styles.buttonText, { color: colors.tint }]}>Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.tint }]}
            onPress={handleViewDetails}
          >
            <IconSymbol name="doc.text.fill" size={20} color="#fff" />
            <Text style={styles.buttonText}>View Details</Text>
          </TouchableOpacity>
        </View>

        <ReceiptEditModal
          visible={showEditModal}
          receipt={processedReceipt}
          onClose={() => setShowEditModal(false)}
          onSave={handleSaveEditedReceipt}
        />
      </ThemedView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 16,
  },
  errorMessage: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  errorActions: {
    marginTop: 32,
    gap: 12,
    width: '100%',
  },
  successHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 16,
    gap: 12,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  previewScroll: {
    flex: 1,
  },
  successActions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
