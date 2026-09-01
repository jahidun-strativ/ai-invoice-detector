/**
 * Export Service
 * Raw JSON export (for backup/debugging), file sharing, and saving an export
 * to a folder on the device.
 *
 * The office document is XLSX — see `services/xlsx-export.ts`. CSV was removed
 * deliberately: a spreadsheet opening a CSV assumes the system code page, so
 * Bangla merchant names arrived as mojibake ("à¦«à§à¦¨à§"), and the flat
 * "=== RECEIPT SUMMARY ===" layout was unreadable for the people who approve
 * the bills. XLSX stores text as UTF-8 inside the file, so the problem cannot
 * recur.
 */

import { Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Receipt } from '@/types/receipt';

const EXPORT_DIR = `${FileSystem.documentDirectory}exports/`;

const MIME_TYPES: Record<string, string> = {
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Ensure export directory exists
 */
async function ensureExportDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(EXPORT_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(EXPORT_DIR, { intermediates: true });
  }
}

/**
 * Generate filename with timestamp
 */
function generateFilename(prefix: string, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}_${timestamp}.${extension}`;
}

/**
 * Export a single receipt to JSON
 */
export async function exportReceiptToJson(receipt: Receipt): Promise<string> {
  await ensureExportDir();

  const filename = generateFilename(`receipt_${receipt.id}`, 'json');
  const filepath = `${EXPORT_DIR}${filename}`;

  await FileSystem.writeAsStringAsync(filepath, JSON.stringify(receipt, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return filepath;
}

/**
 * Export multiple receipts to JSON
 */
export async function exportReceiptsToJson(receipts: Receipt[]): Promise<string> {
  await ensureExportDir();

  const filename = generateFilename('receipts_export', 'json');
  const filepath = `${EXPORT_DIR}${filename}`;

  const exportData = {
    exported_at: new Date().toISOString(),
    total_receipts: receipts.length,
    total_amount: receipts.reduce((sum, r) => sum + r.total, 0),
    receipts,
  };

  await FileSystem.writeAsStringAsync(filepath, JSON.stringify(exportData, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return filepath;
}

/**
 * Export receipts as raw JSON (one receipt or many)
 */
export async function exportReceiptsAsJson(receipts: Receipt[]): Promise<string> {
  return receipts.length === 1
    ? exportReceiptToJson(receipts[0])
    : exportReceiptsToJson(receipts);
}

/**
 * Share an exported file
 */
export async function shareFile(filepath: string): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();

  if (!isAvailable) {
    throw new Error('Sharing is not available on this device');
  }

  const extension = filepath.split('.').pop()?.toLowerCase() ?? '';

  await Sharing.shareAsync(filepath, {
    mimeType: MIME_TYPES[extension] ?? 'application/octet-stream',
    dialogTitle: 'Export Receipt Data',
    UTI: extension === 'xlsx' ? 'org.openxmlformats.spreadsheetml.sheet' : undefined,
  });
}

/**
 * Save an exported file into a folder the user picks, so the sheet lands in
 * Downloads (or Drive, or an SD card) as a real file instead of only ever
 * passing through the share sheet.
 *
 * Android only has this: the app's own documentDirectory is private storage no
 * file manager can see, so the Storage Access Framework is the only way to put
 * a file somewhere the user can open it later. iOS has no SAF, and its share
 * sheet already offers "Save to Files", so there this just shares.
 *
 * Returns the filename written, or null if the user backed out of the picker.
 */
export async function saveFileToDevice(filepath: string): Promise<string | null> {
  const filename = filepath.split('/').pop() ?? 'export';
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = MIME_TYPES[extension] ?? 'application/octet-stream';

  if (Platform.OS !== 'android') {
    await shareFile(filepath);
    return filename;
  }

  // ponytail: the folder is picked on every save. Persist
  // permission.directoryUri in the config table if that gets tedious.
  const permission =
    await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;

  // Base64 round-trip so the same path works for the binary XLSX and the JSON.
  const contents = await FileSystem.readAsStringAsync(filepath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  // createFileAsync appends the extension itself, from the MIME type.
  const target = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    filename.replace(/\.[^.]+$/, ''),
    mimeType,
  );
  await FileSystem.writeAsStringAsync(target, contents, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return filename;
}

/**
 * Hand a finished export to the user: share it, or save it to the device.
 * Every export site funnels through here so the choice is the same everywhere.
 */
export async function deliverFile(filepath: string): Promise<void> {
  if (Platform.OS !== 'android') {
    await shareFile(filepath);
    return;
  }

  const run = (action: () => Promise<unknown>) => () => {
    // Alert callbacks are sync — a rejection here would be an unhandled
    // promise, and the user would see nothing happen at all.
    action().catch((error: unknown) =>
      Alert.alert(
        'Export Failed',
        error instanceof Error ? error.message : 'Could not deliver the file.',
      ),
    );
  };

  Alert.alert(filepath.split('/').pop() ?? 'Export ready', 'Where should it go?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Share', onPress: run(() => shareFile(filepath)) },
    {
      text: 'Save to device',
      onPress: run(async () => {
        const saved = await saveFileToDevice(filepath);
        if (saved) Alert.alert('Saved', `${saved} was saved to the folder you picked.`);
      }),
    },
  ]);
}

/**
 * Export raw JSON and share in one step
 */
export async function exportAndShareJson(receipts: Receipt[]): Promise<void> {
  await deliverFile(await exportReceiptsAsJson(receipts));
}

/**
 * Get all exported files
 */
export async function getExportedFiles(): Promise<string[]> {
  await ensureExportDir();
  const files = await FileSystem.readDirectoryAsync(EXPORT_DIR);
  return files.map((f) => `${EXPORT_DIR}${f}`);
}

/**
 * Delete an exported file
 */
export async function deleteExportedFile(filepath: string): Promise<void> {
  await FileSystem.deleteAsync(filepath, { idempotent: true });
}

/**
 * Clear all exported files
 */
export async function clearExportedFiles(): Promise<void> {
  await FileSystem.deleteAsync(EXPORT_DIR, { idempotent: true });
  await ensureExportDir();
}
