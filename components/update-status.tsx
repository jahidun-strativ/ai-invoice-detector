/**
 * Update Status Component
 * Displays OTA update status and allows manual update checking
 */

import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOTAUpdates } from '@/hooks/use-ota-updates';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconSymbol } from './ui/icon-symbol';

export function UpdateStatus() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const {
    isUpdateAvailable,
    isUpdatePending,
    isChecking,
    error,
    isEnabled,
    checkForUpdate,
    fetchAndApplyUpdate,
    getUpdateInfo,
  } = useOTAUpdates({
    checkOnMount: false, // Don't auto-check in this component
  });

  const updateInfo = getUpdateInfo();

  if (!isEnabled) {
    return (
      <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.row}>
          <IconSymbol name="info.circle" size={20} color={colors.text} />
          <Text style={[styles.text, { color: colors.text }]}>
            OTA updates are not available in development mode
          </Text>
        </View>
      </View>
    );
  }

  const handleCheckForUpdate = async () => {
    const hasUpdate = await checkForUpdate();
    if (hasUpdate) {
      // Optionally show a confirmation before applying
      await fetchAndApplyUpdate();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <IconSymbol name="arrow.down.circle" size={24} color={colors.tint} />
        <Text style={[styles.title, { color: colors.text }]}>App Updates</Text>
      </View>

      {updateInfo && (
        <View style={styles.infoContainer}>
          <Text style={[styles.infoText, { color: colors.tabIconDefault }]}>
            Version: {updateInfo.runtimeVersion || 'N/A'}
          </Text>
          {updateInfo.channel && (
            <Text style={[styles.infoText, { color: colors.tabIconDefault }]}>
              Channel: {updateInfo.channel}
            </Text>
          )}
        </View>
      )}

      {isChecking && (
        <View style={styles.statusContainer}>
          <ActivityIndicator size="small" color={colors.tint} />
          <Text style={[styles.statusText, { color: colors.text }]}>
            Checking for updates...
          </Text>
        </View>
      )}

      {isUpdateAvailable && !isChecking && (
        <View style={styles.statusContainer}>
          <IconSymbol name="checkmark.circle.fill" size={20} color={colors.success} />
          <Text style={[styles.statusText, { color: colors.text }]}>
            Update available! Downloading...
          </Text>
        </View>
      )}

      {isUpdatePending && (
        <View style={styles.statusContainer}>
          <IconSymbol name="checkmark.circle.fill" size={20} color={colors.success} />
          <Text style={[styles.statusText, { color: colors.text }]}>
            Update downloaded! App will reload...
          </Text>
        </View>
      )}

      {error && (
        <View style={styles.statusContainer}>
          <IconSymbol name="exclamationmark.triangle.fill" size={20} color={colors.danger} />
          <Text style={[styles.errorText, { color: colors.danger }]}>
            {error.message || 'Failed to check for updates'}
          </Text>
        </View>
      )}

      {!isUpdateAvailable && !isChecking && !error && (
        <View style={styles.statusContainer}>
          <IconSymbol name="checkmark.circle" size={20} color={colors.tabIconDefault} />
          <Text style={[styles.statusText, { color: colors.tabIconDefault }]}>
            App is up to date
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.tint }]}
        onPress={handleCheckForUpdate}
        disabled={isChecking || isUpdatePending}
      >
        {isChecking ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <IconSymbol name="arrow.clockwise" size={18} color="#fff" />
            <Text style={styles.buttonText}>Check for Updates</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 12,
    marginVertical: 8,
    marginHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontFamily: Type.semibold,
  },
  infoContainer: {
    marginBottom: 12,
    gap: 4,
  },
  infoText: {
    fontSize: 12,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    flex: 1,
  },
  errorText: {
    fontSize: 14,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontSize: 14,
    flex: 1,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: Type.semibold,
  },
});
