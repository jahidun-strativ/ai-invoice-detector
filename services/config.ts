/**
 * Config Service
 * App-level configuration (office name, optional remote DB, export columns).
 * Thin validation layer over the SQLite config tables in storage.ts.
 */

import {
  ExportColumnConfig,
  getAppConfig,
  getExportColumns,
  getUnsyncedReceipts,
  markReceiptsSynced,
  resetSyncState,
  setExportColumns,
  setOfficeName,
} from "./storage";
import {
  batchSyncReceipts,
  isMisconfigured,
  isRemoteConfigured,
  refreshRemoteConfig,
} from "./remote-db";

const MAX_OFFICE_NAME = 60;

/** Columns offered in Settings, in the order they appear on the sheet */
export const DEFAULT_COLUMNS: ExportColumnConfig[] = [
  { field: "receipt_date", label: "Date", enabled: true, order: 0 },
  { field: "merchant_name", label: "Merchant", enabled: true, order: 1 },
  { field: "receipt_number", label: "Receipt #", enabled: true, order: 2 },
  { field: "invoice_type", label: "Type", enabled: true, order: 3 },
  { field: "total", label: "Amount", enabled: true, order: 4 },
  { field: "currency", label: "Currency", enabled: true, order: 5 },
  { field: "payment_method", label: "Payment Method", enabled: false, order: 6 },
  { field: "tax", label: "Tax", enabled: false, order: 7 },
  { field: "subtotal", label: "Subtotal", enabled: false, order: 8 },
  { field: "items", label: "Items", enabled: false, order: 9 },
];

export async function getOfficeName(): Promise<string> {
  const config = await getAppConfig();
  return config.officeName;
}

export async function updateOfficeName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Office name cannot be empty.");
  }
  if (trimmed.length > MAX_OFFICE_NAME) {
    throw new Error(`Office name must be ${MAX_OFFICE_NAME} characters or fewer.`);
  }
  await setOfficeName(trimmed);
}

/**
 * Push receipts that never reached the database — scans taken with no signal.
 * Runs automatically on app start; there is no button for it, because keeping
 * a copy of the office's data in sync is not the scanning staff's job.
 *
 * Only ids the endpoint accepted are marked, so a partial failure simply
 * retries next launch.
 */
export async function syncPendingReceipts(): Promise<{
  synced: number;
  failed: number;
}> {
  await refreshRemoteConfig();
  if (!isRemoteConfigured()) return { synced: 0, failed: 0 };

  if (isMisconfigured()) {
    console.warn(
      "Supabase URL is set but EXPO_PUBLIC_SUPABASE_ANON_KEY is missing — sync will be rejected.",
    );
    return { synced: 0, failed: 0 };
  }

  const pending = await getUnsyncedReceipts();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  const { syncedIds, failed } = await batchSyncReceipts(pending);
  await markReceiptsSynced(syncedIds);

  if (failed > 0) {
    console.warn(`${failed} receipt(s) still waiting to reach the database.`);
  }
  return { synced: syncedIds.length, failed };
}

export async function getColumns(): Promise<ExportColumnConfig[]> {
  const columns = await getExportColumns();
  return columns.length > 0 ? columns : DEFAULT_COLUMNS;
}

export async function updateColumns(columns: ExportColumnConfig[]): Promise<void> {
  if (!columns.some((c) => c.enabled)) {
    throw new Error("Keep at least one column enabled.");
  }
  // Renumber so order is always dense and matches the on-screen list
  await setExportColumns(columns.map((c, i) => ({ ...c, order: i })));
}

export async function resetColumnsToDefault(): Promise<void> {
  await setExportColumns(DEFAULT_COLUMNS);
}

/**
 * Re-send every receipt to the database. The upsert is keyed on receipt id, so
 * running this against a table that already has the rows changes nothing —
 * and against an emptied table it refills it.
 *
 * ponytail: batches of 500 with a hard stop at 20 rounds (10k receipts). Raise
 * the bound if an office ever accumulates more than that in one device.
 */
export async function reuploadAllReceipts(): Promise<{
  synced: number;
  failed: number;
}> {
  await refreshRemoteConfig();
  if (!isRemoteConfigured()) {
    throw new Error("This build has no database configured.");
  }

  await resetSyncState();

  let synced = 0;
  let failed = 0;
  for (let round = 0; round < 20; round++) {
    const result = await syncPendingReceipts();
    synced += result.synced;
    failed += result.failed;
    // Nothing moved, or the endpoint started rejecting — stop retrying
    if (result.synced === 0 || result.failed > 0) break;
  }

  return { synced, failed };
}

export { isRemoteConfigured } from "./remote-db";
