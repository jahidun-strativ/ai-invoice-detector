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
} from '@/types/receipt';
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'receipts.db';

let db: SQLite.SQLiteDatabase | null = null;
let isInitialized = false;

/**
 * Initialize the database and create tables
 */
export async function initDatabase(): Promise<void> {
  if (isInitialized && db) {
    return; // Already initialized
  }

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

    isInitialized = true;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    db = null;
    isInitialized = false;
    throw error;
  }
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
    ]
  );

  return receipt;
}

/**
 * Get a receipt by ID
 */
export async function getReceiptById(id: string): Promise<Receipt | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<ReceiptRow>(
    'SELECT * FROM receipts WHERE id = ?',
    [id]
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
  
  let query = 'SELECT * FROM receipts WHERE 1=1';
  const params: (string | number)[] = [];

  if (filter) {
    if (filter.invoice_type) {
      query += ' AND invoice_type = ?';
      params.push(filter.invoice_type);
    }
    if (filter.start_date) {
      query += ' AND receipt_date >= ?';
      params.push(filter.start_date);
    }
    if (filter.end_date) {
      query += ' AND receipt_date <= ?';
      params.push(filter.end_date);
    }
    if (filter.merchant_name) {
      query += ' AND merchant_name LIKE ?';
      params.push(`%${filter.merchant_name}%`);
    }
    if (filter.min_total !== undefined) {
      query += ' AND total >= ?';
      params.push(filter.min_total);
    }
    if (filter.max_total !== undefined) {
      query += ' AND total <= ?';
      params.push(filter.max_total);
    }
  }

  query += ' ORDER BY created_at DESC';

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
    'SELECT * FROM receipts ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
  return rows.map(rowToReceipt);
}

/**
 * Update a receipt
 */
export async function updateReceipt(
  id: string,
  updates: Partial<ReceiptInput>
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
      error_message = ?
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
    ]
  );

  return updated;
}

/**
 * Delete a receipt
 */
export async function deleteReceipt(id: string): Promise<boolean> {
  const database = await getDb();
  const result = await database.runAsync('DELETE FROM receipts WHERE id = ?', [
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
  }>('SELECT COUNT(*) as count, SUM(total) as amount FROM receipts');

  // This month's data
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const monthlyTotals = await database.getFirstAsync<{
    count: number;
    amount: number | null;
  }>(
    `SELECT COUNT(*) as count, SUM(total) as amount FROM receipts 
     WHERE created_at >= ?`,
    [firstOfMonth]
  );

  // By type
  const typeRows = await database.getAllAsync<{
    invoice_type: string;
    count: number;
  }>(
    `SELECT invoice_type, COUNT(*) as count FROM receipts GROUP BY invoice_type`
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
  }>(
    `SELECT currency, SUM(total) as amount FROM receipts GROUP BY currency`
  );

  const byCurrency: Record<string, number> = {};
  for (const row of currencyRows) {
    byCurrency[row.currency] = row.amount;
  }

  // Receipts that need a human look (low confidence or extraction error)
  const needsReview = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM receipts
     WHERE confidence_score < 0.5 OR error_message IS NOT NULL`
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
    [`%${query}%`]
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
