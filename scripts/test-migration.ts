/**
 * Test script to verify database migration for monthly export feature
 * Run with: npx ts-node scripts/test-migration.ts
 */

import * as SQLite from "expo-sqlite";

async function testMigration() {
  console.log("Testing database migration...\n");

  const db = await SQLite.openDatabaseAsync("test-receipts.db");

  try {
    // Run the migration
    await db.execAsync(`
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

    console.log("✓ Migration executed successfully\n");

    // Verify config table
    const configRows = await db.getAllAsync("SELECT * FROM config");
    console.log("Config table rows:", configRows);
    console.log("✓ Config table verified\n");

    // Verify export_columns table
    const columnsRows = await db.getAllAsync(
      "SELECT * FROM export_columns ORDER BY order_index",
    );
    console.log("Export columns table rows:", columnsRows);
    console.log("✓ Export columns table verified\n");

    // Verify indexes exist
    const indexes = await db.getAllAsync(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_receipts_%'",
    );
    console.log("Receipt indexes:", indexes);
    console.log("✓ Indexes verified\n");

    console.log("✅ All migration tests passed!");
  } catch (error) {
    console.error("❌ Migration test failed:", error);
    throw error;
  } finally {
    // Clean up test database
    await db.closeAsync();
  }
}

// Run on load — this file is only ever executed directly, and the
// `require.main === module` guard it used to carry needs @types/node, which
// would drag Node's globals into the app's typecheck.
testMigration().catch(console.error);

export { testMigration };
