/**
 * Export Service
 * Raw JSON export (for backup/debugging) and file sharing.
 *
 * The office document is XLSX — see `services/xlsx-export.ts`. CSV was removed
 * deliberately: a spreadsheet opening a CSV assumes the system code page, so
 * Bangla merchant names arrived as mojibake ("à¦«à§à¦¨à§"), and the flat
 * "=== RECEIPT SUMMARY ===" layout was unreadable for the people who approve
 * the bills. XLSX stores text as UTF-8 inside the file, so the problem cannot
 * recur.
 */

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
 * Export raw JSON and share in one step
 */
export async function exportAndShareJson(receipts: Receipt[]): Promise<void> {
  await shareFile(await exportReceiptsAsJson(receipts));
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
