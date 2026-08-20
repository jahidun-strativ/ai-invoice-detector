/**
 * Storage Service
 * SQLite database operations for receipts
 */

import {
  InvoiceType,
  Receipt,
  ReceiptFilter,
  ReceiptInput,
  ReceiptStats,
} from "@/types/receipt";
import * as SQLite from "expo-sqlite";

const DB_NAME = "receipts.db";

/**
 * Monthly period identifier
 */
export interface MonthlyPeriod {
  year: number;
  month: number; // 1-12
  label: string; // "January 2024"
}

/**
 * Monthly period summary
 */
export interface MonthlyPeriodSummary {
  period: MonthlyPeriod;
  receiptCount: number;
  totalAmount: number;
  currency: string;
}

/**
 * App configuration stored in SQLite
 */
export interface AppConfig {
  officeName: string;
  databaseUrl: string | null;
  lastUpdated: string;
}

/**
 * Column configuration for export
 */
export interface ExportColumnConfig {
  field: string; // Receipt field name
  label: string; // Column header label
  enabled: boolean;
  order: number;
}

let db: SQLite.SQLiteDatabase | null = null;
let isInitialized = false;
// Two callers hitting a cold database at once (e.g. Promise.all over config
// reads) would each run the schema migration. Share the in-flight init.
let initPromise: Promise<void> | null = null;

/**
 * Initialize the database and create tables
 */
export async function initDatabase(): Promise<void> {
  if (isInitialized && db) {
    return; // Already initialized
  }
  if (initPromise) {
    return initPromise; // Another caller is already doing it
  }

  initPromise = runInit().finally(() => {
    initPromise = null;
  });
  return initPromise;
}

async function runInit(): Promise<void> {
  try {
    db = await SQLite.openDatabaseAsync(DB_NAME);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        merchant_name TEXT,
        receipt_date TEXT,
        receipt_number TEXT,
        invoice_type TEXT NOT NULL DEFAULT 'unknown',
        items TEXT NOT NULL,
        subtotal REAL,
        tax REAL,
        total REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'BDT',
        payment_method TEXT,
        confidence_score REAL,
        image_uri TEXT NOT NULL,
        raw_text TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts(created_at);
      CREATE INDEX IF NOT EXISTS idx_receipts_invoice_type ON receipts(invoice_type);
      CREATE INDEX IF NOT EXISTS idx_receipts_merchant_name ON receipts(merchant_name);
    `);

    // Run migration to add monthly export tables
    await migrateToMonthlyExport(db);

    isInitialized = true;
  } catch (error) {
    console.error("Failed to initialize database:", error);
    db = null;
    isInitialized = false;
    throw error;
  }
}

/**
 * Database migration: Add monthly export tables and indexes
 * Creates config and export_columns tables with default values
 */
export async function migrateToMonthlyExport(
  database: SQLite.SQLiteDatabase,
): Promise<void> {
  try {
    await database.execAsync(`
      BEGIN TRANSACTION;
      
      -- Add config table for app settings
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      -- Add export_columns table for configurable columns
      CREATE TABLE IF NOT EXISTS export_columns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        order_index INTEGER NOT NULL DEFAULT 0
      );
      
      -- Add index for monthly queries on receipts
      CREATE INDEX IF NOT EXISTS idx_receipts_year_month 
        ON receipts(substr(receipt_date, 1, 7));
      
      -- Insert default config values (only if not exists)
      INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
        ('office_name', 'Office', datetime('now')),
        ('database_url', '', datetime('now'));
      
      -- Insert default export columns (only if not exists)
      INSERT OR IGNORE INTO export_columns (field, label, enabled, order_index) VALUES
        ('receipt_date', 'Date', 1, 0),
        ('merchant_name', 'Merchant', 1, 1),
        ('receipt_number', 'Receipt #', 1, 2),
        ('invoice_type', 'Type', 1, 3),
        ('total', 'Amount', 1, 4),
        ('currency', 'Currency', 1, 5),
        ('payment_method', 'Payment Method', 1, 6),
        ('tax', 'Tax', 0, 7),
        ('subtotal', 'Subtotal', 0, 8);
      
      COMMIT;
    `);

    // Track which receipts reached the remote database. SQLite has no
    // "ADD COLUMN IF NOT EXISTS", so check the table first — this runs on
    // every start, including installs created before the column existed.
    const columns = await database.getAllAsync<{ name: string }>(
      "PRAGMA table_info(receipts)",
    );
    if (!columns.some((column) => column.name === "synced_at")) {
      try {
        await database.execAsync("ALTER TABLE receipts ADD COLUMN synced_at TEXT");
      } catch (error) {
        // Belt and braces: PRAGMA reads can come back empty on some drivers,
        // and adding a column that already exists is not a failure.
        if (!String(error).includes("duplicate column")) throw error;
      }
    }
  } catch (error) {
    console.error("Failed to run monthly export migration:", error);
    throw error;
  }
}

/**
 * Merge receipts pulled from the shared database into local storage, so every
 * phone shows the whole office's scans and exports one combined sheet.
 *
 * Ownership rule: a receipt scanned on THIS device is never overwritten — its
 * row keeps the local image path and any local edit. Rows that arrived from the
 * database are refreshed, so a correction made on the phone that owns a receipt
 * reaches everyone else.
 *
 * Locally scanned is recognised by a `file://` image_uri. Imported rows hold
 * either a bucket URL or nothing, so an empty image_uri is not the test — a
 * scan whose photo failed to upload would then be treated as someone else's.
 *
 * Returns how many rows were added or refreshed.
 */
export async function importRemoteReceipts(receipts: Receipt[]): Promise<number> {
  if (receipts.length === 0) return 0;

  const database = await getDb();
  const now = new Date().toISOString();
  let changed = 0;

  for (const receipt of receipts) {
    const existing = await database.getFirstAsync<{ image_uri: string }>(
      "SELECT image_uri FROM receipts WHERE id = ?",
      [receipt.id],
    );

    if (existing?.image_uri.startsWith("file:")) {
      continue; // scanned here — this device owns it
    }

    const values = [
      receipt.merchant_name,
      receipt.receipt_date,
      receipt.receipt_number,
      receipt.invoice_type,
      JSON.stringify(receipt.items),
      receipt.subtotal,
      receipt.tax,
      receipt.total,
      receipt.currency,
      receipt.payment_method,
      receipt.confidence_score,
      receipt.raw_text,
      receipt.error_message,
      receipt.created_at,
      now,
      receipt.image_uri,
      receipt.id,
    ];

    if (existing) {
      await database.runAsync(
        `UPDATE receipts SET
          merchant_name = ?, receipt_date = ?, receipt_number = ?, invoice_type = ?,
          items = ?, subtotal = ?, tax = ?, total = ?, currency = ?, payment_method = ?,
          confidence_score = ?, raw_text = ?, error_message = ?, created_at = ?,
          synced_at = ?, image_uri = ?
        WHERE id = ?`,
        values,
      );
    } else {
      await database.runAsync(
        `INSERT INTO receipts (
          merchant_name, receipt_date, receipt_number, invoice_type,
          items, subtotal, tax, total, currency, payment_method,
          confidence_score, raw_text, error_message, created_at,
          synced_at, image_uri, id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values,
      );
    }
    changed++;
  }

  return changed;
}

/**
 * Delete every receipt. Returns how many rows went, so the caller can confirm
 * something specific rather than a bare "done".
 *
 * Only touches `receipts` — office name, export columns and other config
 * survive, because wiping test scans should not also reset the setup.
 */
export async function deleteAllReceipts(): Promise<number> {
  const database = await getDb();

  const before = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM receipts",
  );
  await database.runAsync("DELETE FROM receipts");

  return before?.count ?? 0;
}

/**
 * Receipts that have not reached the remote database yet — scans taken with no
 * signal. Bounded so one launch never tries to push a year of history at once.
 */
export async function getUnsyncedReceipts(limit: number = 500): Promise<Receipt[]> {
  const database = await getDb();

  const rows = await database.getAllAsync<ReceiptRow>(
    `SELECT * FROM receipts WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT ?`,
    [limit],
  );

  return rows.map(rowToReceipt);
}

/**
 * Mark every receipt as pending again, so the next sync re-sends all of them.
 * This is how local and the database are put back in agreement after the table
 * is truncated — by pushing, never by deleting anything local.
 */
export async function resetSyncState(): Promise<number> {
  const database = await getDb();

  const total = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM receipts",
  );
  await database.runAsync("UPDATE receipts SET synced_at = NULL");

  return total?.count ?? 0;
}

/**
 * Mark receipts as mirrored. Only ever called with ids the endpoint accepted.
 */
export async function markReceiptsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const database = await getDb();
  const now = new Date().toISOString();
  const placeholders = ids.map(() => "?").join(", ");

  await database.runAsync(
    `UPDATE receipts SET synced_at = ? WHERE id IN (${placeholders})`,
    [now, ...ids],
  );
}

/**
 * Get database instance, initializing if needed
 */
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  // Always try to reinitialize if db is null or not initialized
  if (!db || !isInitialized) {
    await initDatabase();
  }

  // If still null after init attempt, try opening fresh
  if (!db) {
    db = await SQLite.openDatabaseAsync(DB_NAME);
    isInitialized = true;
  }

  return db;
}

/**
 * Generate a unique ID for receipts
 */
function generateId(): string {
  return `receipt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new receipt
 */
export async function createReceipt(input: ReceiptInput): Promise<Receipt> {
  const database = await getDb();
  const id = generateId();
  const created_at = new Date().toISOString();

  const receipt: Receipt = {
    ...input,
    id,
    created_at,
  };

  await database.runAsync(
    `INSERT INTO receipts (
      id, merchant_name, receipt_date, receipt_number, invoice_type,
      items, subtotal, tax, total, currency, payment_method,
      confidence_score, image_uri, raw_text, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      receipt.id,
      receipt.merchant_name,
      receipt.receipt_date,
      receipt.receipt_number,
      receipt.invoice_type,
      JSON.stringify(receipt.items),
      receipt.subtotal,
      receipt.tax,
      receipt.total,
      receipt.currency,
      receipt.payment_method,
      receipt.confidence_score,
      receipt.image_uri,
      receipt.raw_text,
      receipt.error_message,
      receipt.created_at,
    ],
  );

  return receipt;
}

/**
 * Get a receipt by ID
 */
export async function getReceiptById(id: string): Promise<Receipt | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<ReceiptRow>(
    "SELECT * FROM receipts WHERE id = ?",
    [id],
  );

  if (!row) return null;
  return rowToReceipt(row);
}

/**
 * Reset database connection (call this if connection becomes stale)
 */
export function resetConnection(): void {
  db = null;
  isInitialized = false;
}

/**
 * Get all receipts with optional filtering
 */
export async function getReceipts(filter?: ReceiptFilter): Promise<Receipt[]> {
  let database: SQLite.SQLiteDatabase;

  try {
    database = await getDb();
  } catch {
    // Reset and retry once if initial connection fails
    resetConnection();
    database = await getDb();
  }

  let query = "SELECT * FROM receipts WHERE 1=1";
  const params: (string | number)[] = [];

  if (filter) {
    if (filter.invoice_type) {
      query += " AND invoice_type = ?";
      params.push(filter.invoice_type);
    }
    if (filter.start_date) {
      query += " AND receipt_date >= ?";
      params.push(filter.start_date);
    }
    if (filter.end_date) {
      query += " AND receipt_date <= ?";
      params.push(filter.end_date);
    }
    if (filter.merchant_name) {
      query += " AND merchant_name LIKE ?";
      params.push(`%${filter.merchant_name}%`);
    }
    if (filter.min_total !== undefined) {
      query += " AND total >= ?";
      params.push(filter.min_total);
    }
    if (filter.max_total !== undefined) {
      query += " AND total <= ?";
      params.push(filter.max_total);
    }
  }

  query += " ORDER BY created_at DESC";

  const rows = await database.getAllAsync<ReceiptRow>(query, params);
  return rows.map(rowToReceipt);
}

/**
 * Get recent receipts (for dashboard)
 */
export async function getRecentReceipts(limit: number = 5): Promise<Receipt[]> {
  let database: SQLite.SQLiteDatabase;

  try {
    database = await getDb();
  } catch {
    // Reset and retry once if initial connection fails
    resetConnection();
    database = await getDb();
  }

  const rows = await database.getAllAsync<ReceiptRow>(
    "SELECT * FROM receipts ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(rowToReceipt);
}

/**
 * Update a receipt
 */
export async function updateReceipt(
  id: string,
  updates: Partial<ReceiptInput>,
): Promise<Receipt | null> {
  const database = await getDb();
  const existing = await getReceiptById(id);

  if (!existing) return null;

  const updated: Receipt = {
    ...existing,
    ...updates,
    items: updates.items ?? existing.items,
  };

  await database.runAsync(
    `UPDATE receipts SET
      merchant_name = ?,
      receipt_date = ?,
      receipt_number = ?,
      invoice_type = ?,
      items = ?,
      subtotal = ?,
      tax = ?,
      total = ?,
      currency = ?,
      payment_method = ?,
      confidence_score = ?,
      image_uri = ?,
      raw_text = ?,
      error_message = ?,
      -- Any edit invalidates the copy in the remote database, so the row goes
      -- back to pending and the next sync re-sends it. Without this, a receipt
      -- corrected after scanning would keep its wrong values there forever.
      synced_at = NULL
    WHERE id = ?`,
    [
      updated.merchant_name,
      updated.receipt_date,
      updated.receipt_number,
      updated.invoice_type,
      JSON.stringify(updated.items),
      updated.subtotal,
      updated.tax,
      updated.total,
      updated.currency,
      updated.payment_method,
      updated.confidence_score,
      updated.image_uri,
      updated.raw_text,
      updated.error_message,
      id,
    ],
  );

  return updated;
}

/**
 * Delete a receipt
 */
export async function deleteReceipt(id: string): Promise<boolean> {
  const database = await getDb();
  const result = await database.runAsync("DELETE FROM receipts WHERE id = ?", [
    id,
  ]);
  return result.changes > 0;
}

/**
 * Get receipt statistics for dashboard
 */
export async function getReceiptStats(): Promise<ReceiptStats> {
  let database: SQLite.SQLiteDatabase;

  try {
    database = await getDb();
  } catch {
    // Reset and retry once if initial connection fails
    resetConnection();
    database = await getDb();
  }

  // Total count and amount
  const totals = await database.getFirstAsync<{
    count: number;
    amount: number | null;
  }>("SELECT COUNT(*) as count, SUM(total) as amount FROM receipts");

  // This month's data
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];

  const monthlyTotals = await database.getFirstAsync<{
    count: number;
    amount: number | null;
  }>(
    `SELECT COUNT(*) as count, SUM(total) as amount FROM receipts 
     WHERE created_at >= ?`,
    [firstOfMonth],
  );

  // By type
  const typeRows = await database.getAllAsync<{
    invoice_type: string;
    count: number;
  }>(
    `SELECT invoice_type, COUNT(*) as count FROM receipts GROUP BY invoice_type`,
  );

  const byType: Record<InvoiceType, number> = {
    retail: 0,
    restaurant: 0,
    utility: 0,
    service: 0,
    unknown: 0,
  };

  for (const row of typeRows) {
    if (row.invoice_type in byType) {
      byType[row.invoice_type as InvoiceType] = row.count;
    }
  }

  // By currency
  const currencyRows = await database.getAllAsync<{
    currency: string;
    amount: number;
  }>(`SELECT currency, SUM(total) as amount FROM receipts GROUP BY currency`);

  const byCurrency: Record<string, number> = {};
  for (const row of currencyRows) {
    byCurrency[row.currency] = row.amount;
  }

  // Receipts that need a human look (low confidence or extraction error)
  const needsReview = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM receipts
     WHERE confidence_score < 0.5 OR error_message IS NOT NULL`,
  );

  return {
    total_count: totals?.count ?? 0,
    total_amount: totals?.amount ?? 0,
    this_month_count: monthlyTotals?.count ?? 0,
    this_month_amount: monthlyTotals?.amount ?? 0,
    needs_review_count: needsReview?.count ?? 0,
    by_type: byType,
    by_currency: byCurrency,
  };
}

/**
 * Search receipts by merchant name
 */
export async function searchReceipts(query: string): Promise<Receipt[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<ReceiptRow>(
    `SELECT * FROM receipts WHERE merchant_name LIKE ? ORDER BY created_at DESC`,
    [`%${query}%`],
  );
  return rows.map(rowToReceipt);
}

// Helper types and functions

interface ReceiptRow {
  id: string;
  merchant_name: string | null;
  receipt_date: string | null;
  receipt_number: string | null;
  invoice_type: string;
  items: string;
  subtotal: number | null;
  tax: number | null;
  total: number;
  currency: string;
  payment_method: string | null;
  confidence_score: number | null;
  image_uri: string;
  raw_text: string | null;
  error_message: string | null;
  created_at: string;
}

function rowToReceipt(row: ReceiptRow): Receipt {
  return {
    id: row.id,
    merchant_name: row.merchant_name,
    receipt_date: row.receipt_date,
    receipt_number: row.receipt_number,
    invoice_type: row.invoice_type as InvoiceType,
    items: JSON.parse(row.items),
    subtotal: row.subtotal,
    tax: row.tax,
    total: row.total,
    currency: row.currency,
    payment_method: row.payment_method,
    confidence_score: row.confidence_score ?? 0,
    image_uri: row.image_uri,
    raw_text: row.raw_text,
    error_message: row.error_message,
    created_at: row.created_at,
  };
}

/**
 * Get app configuration (office name and database URL)
 * Retrieves configuration from the config table
 */
export async function getAppConfig(): Promise<AppConfig> {
  const database = await getDb();

  const officeNameRow = await database.getFirstAsync<{
    value: string;
    updated_at: string;
  }>("SELECT value, updated_at FROM config WHERE key = ?", ["office_name"]);

  const databaseUrlRow = await database.getFirstAsync<{
    value: string;
    updated_at: string;
  }>("SELECT value, updated_at FROM config WHERE key = ?", ["database_url"]);

  return {
    officeName: officeNameRow?.value ?? "Office",
    databaseUrl: databaseUrlRow?.value || null,
    lastUpdated:
      officeNameRow?.updated_at ??
      databaseUrlRow?.updated_at ??
      new Date().toISOString(),
  };
}


/**
 * Set office name configuration
 * Updates the office_name in the config table
 */
export async function setOfficeName(name: string): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();

  await database.runAsync(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)`,
    ["office_name", name, now],
  );
}

/**
 * Set database URL configuration
 * Updates the database_url in the config table
 */
export async function setDatabaseUrl(url: string | null): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();

  await database.runAsync(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)`,
    ["database_url", url ?? "", now],
  );
}

/**
 * Get export column configuration
 * Retrieves columns ordered by order_index
 */
export async function getExportColumns(): Promise<ExportColumnConfig[]> {
  const database = await getDb();

  const rows = await database.getAllAsync<{
    field: string;
    label: string;
    enabled: number;
    order_index: number;
  }>(
    "SELECT field, label, enabled, order_index FROM export_columns ORDER BY order_index ASC",
  );

  return rows.map((row) => ({
    field: row.field,
    label: row.label,
    enabled: row.enabled === 1,
    order: row.order_index,
  }));
}

/**
 * Set export column configuration
 * Updates the column configuration in the export_columns table
 */
export async function setExportColumns(
  columns: ExportColumnConfig[],
): Promise<void> {
  const database = await getDb();

  await database.execAsync("BEGIN TRANSACTION");

  try {
    // Clear existing columns
    await database.runAsync("DELETE FROM export_columns");

    // Insert new configuration
    for (const column of columns) {
      await database.runAsync(
        `INSERT INTO export_columns (field, label, enabled, order_index) VALUES (?, ?, ?, ?)`,
        [column.field, column.label, column.enabled ? 1 : 0, column.order],
      );
    }

    await database.execAsync("COMMIT");
  } catch (error) {
    await database.execAsync("ROLLBACK");
    throw error;
  }
}

/**
 * Get receipts for a specific monthly period
 * Uses date substring matching on receipt_date (format: YYYY-MM-DD)
 */
export async function getReceiptsByMonth(
  year: number,
  month: number,
): Promise<Receipt[]> {
  const database = await getDb();

  // Format month as YYYY-MM for substring matching
  const monthStr = month.toString().padStart(2, "0");
  const yearMonthPrefix = `${year}-${monthStr}`;

  // COALESCE: a receipt whose date the AI could not read still belongs to the
  // month it was scanned in (Req 3.1), otherwise it lands in no period at all
  // and can never be exported (Req 8.4).
  const rows = await database.getAllAsync<ReceiptRow>(
    `SELECT * FROM receipts
     WHERE substr(COALESCE(NULLIF(receipt_date, ''), created_at), 1, 7) = ?
     ORDER BY receipt_date DESC, created_at DESC`,
    [yearMonthPrefix],
  );

  return rows.map(rowToReceipt);
}

/**
 * Get all monthly periods that have receipts
 * Returns aggregated data with receipt counts and totals per period
 */
export async function getMonthlyPeriods(): Promise<MonthlyPeriodSummary[]> {
  const database = await getDb();

  // Query to get unique year-month combinations with counts and totals
  const rows = await database.getAllAsync<{
    year_month: string;
    receipt_count: number;
    total_amount: number;
    currency: string;
  }>(
    `SELECT
      substr(COALESCE(NULLIF(receipt_date, ''), created_at), 1, 7) as year_month,
      COUNT(*) as receipt_count,
      SUM(total) as total_amount,
      currency
    FROM receipts
    GROUP BY year_month, currency
    ORDER BY year_month DESC`,
  );

  // Group by year_month to handle multiple currencies
  const periodMap = new Map<string, MonthlyPeriodSummary>();

  for (const row of rows) {
    const [year, month] = row.year_month.split("-").map(Number);
    const period: MonthlyPeriod = {
      year,
      month,
      label: formatMonthlyPeriod({ year, month, label: "" }),
    };

    const key = row.year_month;
    const existing = periodMap.get(key);

    if (existing) {
      // Accumulate counts and amounts for different currencies
      existing.receiptCount += row.receipt_count;
      existing.totalAmount += row.total_amount;
      // Keep the primary currency (first encountered)
    } else {
      periodMap.set(key, {
        period,
        receiptCount: row.receipt_count,
        totalAmount: row.total_amount,
        currency: row.currency,
      });
    }
  }

  return Array.from(periodMap.values());
}

/**
 * Get the current monthly period
 * Returns current year and month as a MonthlyPeriod object
 */
export function getCurrentMonthlyPeriod(): MonthlyPeriod {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // getMonth() returns 0-11, we need 1-12

  return {
    year,
    month,
    label: formatMonthlyPeriod({ year, month, label: "" }),
  };
}

/**
 * Format monthly period for display
 * Converts year and month to readable format like "January 2024"
 */
export function formatMonthlyPeriod(period: MonthlyPeriod): string {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const monthName = monthNames[period.month - 1]; // month is 1-12, array is 0-11
  return `${monthName} ${period.year}`;
}
