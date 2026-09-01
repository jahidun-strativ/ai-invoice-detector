/**
 * Export Config Modal
 * Collects the four approval signatories and the cash actually drawn, then
 * generates the month's Bill Approval Sheet, then offers to share it or save
 * it to a folder on the device.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Type } from '@/constants/theme';
import { useExport } from '@/contexts/export-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deliverFile } from '@/services/export';
import { MonthlyPeriodSummary } from '@/services/storage';
import { SignatureConfig } from '@/services/xlsx-export';
import { formatCurrency } from '@/utils/format';

type Role = keyof SignatureConfig;

const ROLES: { key: Role; label: string; hint: string }[] = [
  { key: 'preparedBy', label: 'Prepared By', hint: 'Who compiled the bills' },
  { key: 'checkedBy', label: 'Checked By', hint: 'Who verified the amounts' },
  { key: 'reviewedBy', label: 'Reviewed By', hint: 'Who reviewed the sheet' },
  { key: 'approvedBy', label: 'Approved By', hint: 'Who signs off the payment' },
];

const EMPTY_SIGNATURES: SignatureConfig = {
  preparedBy: { name: '', designation: '' },
  checkedBy: { name: '', designation: '' },
  reviewedBy: { name: '', designation: '' },
  approvedBy: { name: '', designation: '' },
};

export function ExportConfigModal({
  visible,
  summary,
  onClose,
}: {
  visible: boolean;
  summary: MonthlyPeriodSummary | null;
  onClose: () => void;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { generateExport, isGenerating } = useExport();

  const [signatures, setSignatures] = useState<SignatureConfig>(EMPTY_SIGNATURES);
  const [amountReceived, setAmountReceived] = useState('');

  if (!summary) return null;

  const setField = (role: Role, field: 'name' | 'designation', value: string) => {
    setSignatures((prev) => ({ ...prev, [role]: { ...prev[role], [field]: value } }));
  };

  const handleGenerate = async () => {
    try {
      const received = amountReceived.trim()
        ? Number(amountReceived.replace(/,/g, ''))
        : undefined;

      if (received !== undefined && Number.isNaN(received)) {
        Alert.alert('Check the amount', 'Amount received must be a number.');
        return;
      }

      const filepath = await generateExport(signatures, received);
      setSignatures(EMPTY_SIGNATURES);
      setAmountReceived('');
      onClose();
      await deliverFile(filepath);
    } catch (error) {
      Alert.alert(
        'Export Failed',
        error instanceof Error ? error.message : 'Could not create the sheet.'
      );
    }
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
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <IconSymbol name="xmark" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Export {summary.period.label}
          </Text>
          <View style={styles.closeButton} />
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={[
                styles.summaryCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                {summary.receiptCount} receipt{summary.receiptCount === 1 ? '' : 's'}
              </Text>
              <Text style={[styles.summaryAmount, { color: colors.text }]}>
                {formatCurrency(summary.totalAmount, summary.currency)}
              </Text>
            </View>

            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              AMOUNT RECEIVED FROM ACCOUNT
            </Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
              ]}
              value={amountReceived}
              onChangeText={setAmountReceived}
              placeholder={`Defaults to ${formatCurrency(summary.totalAmount, summary.currency)}`}
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
            <Text style={[styles.helpText, { color: colors.textSecondary }]}>
              Leave blank if the cash drawn matched the bills exactly.
            </Text>

            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              SIGNATURES
            </Text>
            <Text style={[styles.helpText, { color: colors.textSecondary }]}>
              Blank fields print as a line to sign by hand.
            </Text>

            {ROLES.map((role) => (
              <View
                key={role.key}
                style={[
                  styles.roleCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.roleLabel, { color: colors.text }]}>{role.label}</Text>
                <Text style={[styles.roleHint, { color: colors.textSecondary }]}>
                  {role.hint}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.roleInput,
                    { borderColor: colors.border, color: colors.text },
                  ]}
                  value={signatures[role.key].name}
                  onChangeText={(v) => setField(role.key, 'name', v)}
                  placeholder="Name"
                  placeholderTextColor={colors.textSecondary}
                />
                <TextInput
                  style={[
                    styles.input,
                    styles.roleInput,
                    { borderColor: colors.border, color: colors.text },
                  ]}
                  value={signatures[role.key].designation}
                  onChangeText={(v) => setField(role.key, 'designation', v)}
                  placeholder="Designation"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            ))}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.generateButton, { backgroundColor: colors.tint }]}
              onPress={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <IconSymbol name="square.and.arrow.up" size={20} color="#fff" />
                  <Text style={styles.generateText}>Generate Sheet</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: Type.semibold },
  content: { padding: 16, paddingBottom: 32 },
  summaryCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  summaryLabel: { fontSize: 13 },
  summaryAmount: { fontSize: 26, fontFamily: Type.display },
  sectionLabel: {
    fontSize: 12,
    fontFamily: Type.semibold,
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 46,
  },
  helpText: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  roleCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginTop: 12,
    gap: 8,
  },
  roleLabel: { fontSize: 15, fontFamily: Type.semibold },
  roleHint: { fontSize: 12, marginTop: -4 },
  roleInput: { backgroundColor: 'transparent' },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: 14,
    gap: 8,
  },
  generateText: { color: '#fff', fontSize: 16, fontFamily: Type.semibold },
});
