/**
 * Settings Screen
 * Office identity and export setup, OTA updates, app info.
 */

import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { UpdateStatus } from '@/components/update-status';
import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReceipts } from '@/contexts/receipts-context';
import {
  getColumns,
  getOfficeName,
  isRemoteConfigured,
  resetColumnsToDefault,
  reuploadAllReceipts,
  updateColumns,
  updateOfficeName,
} from '@/services/config';
import { ExportColumnConfig } from '@/services/storage';

const AI_MODEL_LABEL = 'Gemini 2.5 Flash (via OpenRouter)';


export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const channel = Updates.channel || 'development';

  const { stats, clearAllReceipts } = useReceipts();

  const [officeName, setOfficeName] = useState('');
  const [savingOffice, setSavingOffice] = useState(false);


  const [deleting, setDeleting] = useState(false);
  const [reuploading, setReuploading] = useState(false);
  // Endpoint is fixed at build time, so one read at mount is enough
  const [remoteOn] = useState(() => isRemoteConfigured());
  const [showColumns, setShowColumns] = useState(false);
  const [columns, setColumns] = useState<ExportColumnConfig[]>([]);

  const load = useCallback(async () => {
    try {
      const [name, cols] = await Promise.all([getOfficeName(), getColumns()]);
      setOfficeName(name);
      setColumns(cols);
    } catch {
      // Settings are non-critical; leave defaults visible rather than blocking
    }
  }, []);

  useEffect(() => {
    // load() awaits before it setStates, so this is a fetch-on-mount, not a
    // cascading render. The rule (new in eslint-config-expo 57) cannot see
    // through the async call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleSaveOffice = async () => {
    setSavingOffice(true);
    try {
      await updateOfficeName(officeName);
      Alert.alert('Saved', 'Office name will appear at the top of every export.');
    } catch (error) {
      Alert.alert(
        'Not saved',
        error instanceof Error ? error.message : 'Could not save the office name.'
      );
    } finally {
      setSavingOffice(false);
    }
  };

  const handleReupload = async () => {
    setReuploading(true);
    try {
      const { synced, failed } = await reuploadAllReceipts();
      Alert.alert(
        failed > 0 ? 'Partly sent' : 'Sent',
        failed > 0
          ? `${synced} sent, ${failed} could not be sent. Nothing was lost — they stay on this device and retry on the next start.`
          : `${synced} receipt${synced === 1 ? '' : 's'} sent.`
      );
    } catch (error) {
      Alert.alert(
        'Could not send',
        error instanceof Error ? error.message : 'The records could not be reached.'
      );
    } finally {
      setReuploading(false);
    }
  };

  // Two taps, and the second names the number about to go — the receipts are
  // the record, and there is no undo.
  const handleDeleteAll = () => {
    const count = stats?.total_count ?? 0;
    if (count === 0) {
      Alert.alert('Nothing to delete', 'There are no receipts on this device.');
      return;
    }

    Alert.alert(
      'Delete all receipts?',
      `This removes ${count} receipt${count === 1 ? '' : 's'} from this device and cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete ${count}`,
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const deleted = await clearAllReceipts();
              Alert.alert('Deleted', `${deleted} receipt${deleted === 1 ? '' : 's'} removed.`);
            } catch (error) {
              Alert.alert(
                'Not deleted',
                error instanceof Error ? error.message : 'Could not clear the receipts.'
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const persistColumns = async (next: ExportColumnConfig[]) => {
    const previous = columns;
    setColumns(next);
    try {
      await updateColumns(next);
    } catch (error) {
      setColumns(previous);
      Alert.alert(
        'Not saved',
        error instanceof Error ? error.message : 'Could not save columns.'
      );
    }
  };

  const toggleColumn = (field: string) => {
    persistColumns(
      columns.map((c) => (c.field === field ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    persistColumns(next);
  };

  const handleResetColumns = async () => {
    await resetColumnsToDefault();
    setColumns(await getColumns());
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.header, { paddingTop: 12 }]}>
          <ThemedText style={styles.title}>Settings</ThemedText>
        </View>

        {/* Office */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          OFFICE
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Office name
          </Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
            value={officeName}
            onChangeText={setOfficeName}
            placeholder="e.g. Strativ Dhaka"
            placeholderTextColor={colors.textSecondary}
          />
          <Text style={[styles.help, { color: colors.textSecondary }]}>
            Printed as the heading of every Bill Approval Sheet.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.tint }]}
            onPress={handleSaveOffice}
            disabled={savingOffice}
          >
            {savingOffice ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Export columns */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          EXPORT
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Pressable style={styles.disclosure} onPress={() => setShowColumns((v) => !v)}>
            <Text style={[styles.disclosureLabel, { color: colors.text }]}>
              Sheet columns
            </Text>
            <IconSymbol
              name={showColumns ? 'arrow.up.circle' : 'arrow.down.circle'}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>

          {showColumns ? (
            <View style={styles.columnList}>
              <Text style={[styles.help, { color: colors.textSecondary }]}>
                Choose the columns and their order in the exported sheet.
              </Text>
              {columns.map((column, index) => (
                <View
                  key={column.field}
                  style={[styles.columnRow, { borderTopColor: colors.border }]}
                >
                  <Switch
                    value={column.enabled}
                    onValueChange={() => toggleColumn(column.field)}
                    trackColor={{ true: colors.tint, false: colors.surfaceSecondary }}
                  />
                  <Text style={[styles.columnLabel, { color: colors.text }]} numberOfLines={1}>
                    {column.label}
                  </Text>
                  <TouchableOpacity
                    onPress={() => moveColumn(index, -1)}
                    disabled={index === 0}
                    style={styles.moveButton}
                    accessibilityLabel={`Move ${column.label} up`}
                  >
                    <IconSymbol
                      name="arrow.up.circle"
                      size={24}
                      color={index === 0 ? colors.surfaceSecondary : colors.textSecondary}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => moveColumn(index, 1)}
                    disabled={index === columns.length - 1}
                    style={styles.moveButton}
                    accessibilityLabel={`Move ${column.label} down`}
                  >
                    <IconSymbol
                      name="arrow.down.circle"
                      size={24}
                      color={
                        index === columns.length - 1
                          ? colors.surfaceSecondary
                          : colors.textSecondary
                      }
                    />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.linkButton} onPress={handleResetColumns}>
                <IconSymbol name="arrow.counterclockwise" size={16} color={colors.tint} />
                <Text style={[styles.linkText, { color: colors.tint }]}>
                  Reset to default
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* Danger zone */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          DATA
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.help, { color: colors.textSecondary }]}>
            {remoteOn
              ? 'Re-upload sends every receipt again — use it if the records were cleared and need refilling. Delete removes the receipts from this device only; office name and sheet columns are kept.'
              : 'Deletes every receipt stored on this device. Office name and sheet columns are kept.'}
          </Text>
          {remoteOn ? (
            <TouchableOpacity
              style={[styles.reuploadButton, { borderColor: colors.border }]}
              onPress={handleReupload}
              disabled={reuploading}
            >
              {reuploading ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <>
                  <IconSymbol name="arrow.clockwise" size={18} color={colors.tint} />
                  <Text style={[styles.reuploadText, { color: colors.text }]}>
                    Re-upload all receipts
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[styles.dangerButton, { borderColor: colors.danger }]}
            onPress={handleDeleteAll}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <>
                <IconSymbol name="trash" size={18} color={colors.danger} />
                <Text style={[styles.dangerButtonText, { color: colors.danger }]}>
                  Delete all receipts
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Updates */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          UPDATES
        </Text>
        <UpdateStatus />

        {/* About */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          ABOUT
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <InfoRow label="App version" value={appVersion} />
          <InfoRow label="Update channel" value={channel} />
          <InfoRow label="Runtime version" value={Updates.runtimeVersion || 'N/A'} last />
        </View>

        {/* AI */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          AI EXTRACTION
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <InfoRow label="Model" value={AI_MODEL_LABEL} last />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View
      style={[
        styles.infoRow,
        !last && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 150,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    fontFamily: Type.display,
    letterSpacing: -0.3,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: Type.semibold,
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 8,
    marginHorizontal: 20,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  fieldLabel: {
    fontSize: 13,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 46,
    marginTop: 8,
  },
  help: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: Type.semibold,
  },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  disclosureLabel: {
    fontSize: 15,
    fontFamily: Type.medium,
  },
  columnList: {
    paddingBottom: 12,
  },
  columnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  columnLabel: {
    flex: 1,
    fontSize: 15,
  },
  moveButton: {
    padding: 4,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 14,
  },
  linkText: {
    fontSize: 14,
    fontFamily: Type.semibold,
  },
  reuploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    marginTop: 12,
  },
  reuploadText: {
    fontSize: 15,
    fontFamily: Type.semibold,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    marginVertical: 12,
  },
  dangerButtonText: {
    fontSize: 15,
    fontFamily: Type.semibold,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  infoLabel: {
    fontSize: 15,
  },
  infoValue: {
    fontSize: 15,
    fontFamily: Type.medium,
    flexShrink: 1,
  },
});
