/**
 * Receipt Edit Modal Component
 * Allows editing receipt data before saving/exporting
 */

import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { INVOICE_TYPE_LABELS } from '@/constants/receipt-ui';
import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Receipt, ReceiptInput, InvoiceType, LineItem } from '@/types/receipt';

interface ReceiptEditModalProps {
  visible: boolean;
  receipt: Receipt | null;
  onClose: () => void;
  onSave: (updatedReceipt: ReceiptInput) => Promise<void>;
}

const INVOICE_TYPES = Object.keys(INVOICE_TYPE_LABELS) as InvoiceType[];

export function ReceiptEditModal({
  visible,
  receipt,
  onClose,
  onSave,
}: ReceiptEditModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [formData, setFormData] = useState<ReceiptInput | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showItems, setShowItems] = useState(true);
  const [dateError, setDateError] = useState<string | null>(null);

  // Initialize form data when receipt changes
  useEffect(() => {
    if (receipt) {
      setFormData({
        merchant_name: receipt.merchant_name,
        receipt_date: receipt.receipt_date,
        receipt_number: receipt.receipt_number,
        invoice_type: receipt.invoice_type,
        items: [...receipt.items],
        subtotal: receipt.subtotal,
        tax: receipt.tax,
        total: receipt.total,
        currency: receipt.currency,
        payment_method: receipt.payment_method,
        confidence_score: receipt.confidence_score,
        image_uri: receipt.image_uri,
        raw_text: receipt.raw_text,
        error_message: receipt.error_message,
      });
    }
  }, [receipt]);

  if (!receipt || !formData) {
    return null;
  }

  const handleSave = async () => {
    if (!formData) return;

    // Validate total
    if (formData.total <= 0) {
      Alert.alert('Invalid Total', 'Total must be greater than 0');
      return;
    }

    // Validate date format (kept as a plain text field)
    // ponytail: text input + regex validation; upgrade path is
    // @react-native-community/datetimepicker if a picker is ever needed
    if (formData.receipt_date) {
      const isValid =
        /^\d{4}-\d{2}-\d{2}$/.test(formData.receipt_date) &&
        !isNaN(new Date(formData.receipt_date).getTime());
      if (!isValid) {
        setDateError('Date must be in YYYY-MM-DD format');
        return;
      }
    }
    setDateError(null);

    setIsSaving(true);
    try {
      await onSave(formData);
      Alert.alert('Success', 'Receipt updated successfully', [
        { text: 'OK', onPress: onClose },
      ]);
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to update receipt'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = <K extends keyof ReceiptInput>(
    field: K,
    value: ReceiptInput[K]
  ) => {
    setFormData((prev) => (prev ? { ...prev, [field]: value } : null));
  };

  const updateItem = (index: number, field: keyof LineItem, value: string | number | null) => {
    if (!formData) return;
    const updatedItems = [...formData.items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setFormData({ ...formData, items: updatedItems });
  };

  const addItem = () => {
    if (!formData) return;
    setFormData({
      ...formData,
      items: [...formData.items, { name: '', quantity: null, price: 0 }],
    });
  };

  const removeItem = (index: number) => {
    if (!formData) return;
    const updatedItems = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items: updatedItems });
  };

  // Pure: derive subtotal/total from a draft, so functional updates never
  // read a stale closure and clobber the digit the user just typed.
  const withTotals = (draft: ReceiptInput): ReceiptInput => {
    const itemsTotal = draft.items.reduce((sum, item) => sum + (item.price || 0), 0);
    const subtotal = draft.subtotal ?? itemsTotal;
    const tax = draft.tax ?? 0;
    return { ...draft, subtotal, tax, total: subtotal + tax };
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={['top', 'bottom']}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <IconSymbol name="xmark" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Receipt</Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={isSaving}
            style={[styles.saveButton, { backgroundColor: colors.tint }]}
          >
            {isSaving ? (
              <Text style={styles.saveButtonText}>Saving...</Text>
            ) : (
              <>
                <IconSymbol name="checkmark" size={18} color="#fff" />
                <Text style={styles.saveButtonText}>Save</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.scrollView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* Basic Information */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Basic Information</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.icon }]}>Merchant Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={formData.merchant_name || ''}
                onChangeText={(text) => updateField('merchant_name', text || null)}
                placeholder="Enter merchant name"
                placeholderTextColor={colors.icon}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.icon }]}>Receipt Date</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border },
                  !!dateError && { borderColor: colors.danger },
                ]}
                value={formData.receipt_date || ''}
                onChangeText={(text) => {
                  setDateError(null);
                  updateField('receipt_date', text || null);
                }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.icon}
              />
              {dateError && (
                <Text style={[styles.fieldError, { color: colors.danger }]}>{dateError}</Text>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.icon }]}>Receipt Number</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={formData.receipt_number || ''}
                onChangeText={(text) => updateField('receipt_number', text || null)}
                placeholder="Enter receipt number"
                placeholderTextColor={colors.icon}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.icon }]}>Invoice Type</Text>
              <View style={styles.typeButtons}>
                {INVOICE_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.typeButton,
                      {
                        backgroundColor:
                          formData.invoice_type === type ? colors.tint : colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => updateField('invoice_type', type)}
                  >
                    <Text
                      style={[
                        styles.typeButtonText,
                        {
                          color: formData.invoice_type === type ? '#fff' : colors.text,
                        },
                      ]}
                    >
                      {INVOICE_TYPE_LABELS[type]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.icon }]}>Payment Method</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={formData.payment_method || ''}
                onChangeText={(text) => updateField('payment_method', text || null)}
                placeholder="Cash, Card, etc."
                placeholderTextColor={colors.icon}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.icon }]}>Currency</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={formData.currency}
                onChangeText={(text) => updateField('currency', text)}
                placeholder="BDT, USD, etc."
                placeholderTextColor={colors.icon}
              />
            </View>
          </View>

          {/* Financial Information */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Financial Information</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.icon }]}>Subtotal</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={formData.subtotal?.toString() || ''}
                onChangeText={(text) => {
                  const num = parseFloat(text) || null;
                  setFormData((prev) =>
                    prev ? withTotals({ ...prev, subtotal: num }) : prev
                  );
                }}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.icon}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.icon }]}>Tax</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                value={formData.tax?.toString() || ''}
                onChangeText={(text) => {
                  const num = parseFloat(text) || null;
                  setFormData((prev) =>
                    prev ? withTotals({ ...prev, tax: num }) : prev
                  );
                }}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.icon}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.icon }]}>Total</Text>
              <TextInput
                style={[styles.input, styles.totalInput, { backgroundColor: colors.background, color: colors.tint, borderColor: colors.tint }]}
                value={formData.total.toString()}
                onChangeText={(text) => {
                  const num = parseFloat(text) || 0;
                  updateField('total', num);
                }}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.icon}
              />
            </View>
          </View>

          {/* Line Items */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Line Items ({formData.items.length})
              </Text>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: colors.icon }]}>Show Items</Text>
                <Switch
                  value={showItems}
                  onValueChange={setShowItems}
                  trackColor={{ false: colors.surfaceSecondary, true: colors.tint }}
                  thumbColor="#fff"
                />
              </View>
            </View>

            {showItems && (
              <>
                {formData.items.map((item, index) => (
                  <View key={index} style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={styles.itemHeader}>
                      <Text style={[styles.itemNumber, { color: colors.icon }]}>#{index + 1}</Text>
                      <TouchableOpacity
                        onPress={() => removeItem(index)}
                        style={styles.removeButton}
                      >
                        <IconSymbol name="trash" size={18} color={colors.danger} />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.label, { color: colors.icon }]}>Item Name</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                        value={item.name}
                        onChangeText={(text) => updateItem(index, 'name', text)}
                        placeholder="Enter item name"
                        placeholderTextColor={colors.icon}
                      />
                    </View>

                    <View style={styles.itemRow}>
                      <View style={[styles.inputGroup, styles.itemInputGroup]}>
                        <Text style={[styles.label, { color: colors.icon }]}>Quantity</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                          value={item.quantity?.toString() || ''}
                          onChangeText={(text) => {
                            const num = text ? parseFloat(text) : null;
                            updateItem(index, 'quantity', num);
                          }}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={colors.icon}
                        />
                      </View>

                      <View style={[styles.inputGroup, styles.itemInputGroup]}>
                        <Text style={[styles.label, { color: colors.icon }]}>Price</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                          value={item.price.toString()}
                          onChangeText={(text) => {
                            const num = parseFloat(text) || 0;
                            setFormData((prev) => {
                              if (!prev) return prev;
                              const items = [...prev.items];
                              items[index] = { ...items[index], price: num };
                              // Recompute from items only when subtotal was derived
                              return withTotals({ ...prev, items });
                            });
                          }}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          placeholderTextColor={colors.icon}
                        />
                      </View>
                    </View>
                  </View>
                ))}

                <TouchableOpacity
                  style={[styles.addButton, { borderColor: colors.tint }]}
                  onPress={addItem}
                >
                  <IconSymbol name="plus.circle" size={20} color={colors.tint} />
                  <Text style={[styles.addButtonText, { color: colors.tint }]}>Add Item</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: Type.semibold,
    flex: 1,
    textAlign: 'center',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: Type.semibold,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: Type.semibold,
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleLabel: {
    fontSize: 14,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: Type.medium,
    marginBottom: 6,
  },
  fieldError: {
    fontSize: 13,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  totalInput: {
    borderWidth: 2,
    fontFamily: Type.semibold,
    fontSize: 18,
  },
  typeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  typeButtonText: {
    fontSize: 14,
    fontFamily: Type.medium,
  },
  itemCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemNumber: {
    fontSize: 12,
    fontFamily: Type.semibold,
  },
  removeButton: {
    padding: 4,
  },
  itemRow: {
    flexDirection: 'row',
    gap: 12,
  },
  itemInputGroup: {
    flex: 1,
    marginBottom: 0,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: 'dashed',
    gap: 8,
    marginTop: 8,
  },
  addButtonText: {
    fontSize: 16,
    fontFamily: Type.semibold,
  },
});
