/**
 * Configuration Management Tests
 * Tests for getAppConfig, setOfficeName, setDatabaseUrl, getExportColumns, setExportColumns
 *
 * Requirements: 4.1, 4.2, 4.3, 2.6, 2.7, 5.6
 */

import {
  ExportColumnConfig,
  createReceipt,
  deleteAllReceipts,
  getAppConfig,
  getExportColumns,
  getReceipts,
  initDatabase,
  setDatabaseUrl,
  setExportColumns,
  setOfficeName,
} from "../storage";

describe("deleteAllReceipts", () => {
  it("removes every receipt and reports the count", async () => {
    const input = {
      merchant_name: "Shwapno",
      receipt_date: "2026-08-15",
      receipt_number: null,
      invoice_type: "retail" as const,
      items: [],
      subtotal: null,
      tax: null,
      total: 100,
      currency: "BDT",
      payment_method: null,
      confidence_score: 0.9,
      image_uri: "file:///a.jpg",
      raw_text: null,
      error_message: null,
    };
    await createReceipt(input);
    await createReceipt({ ...input, total: 50 });

    const deleted = await deleteAllReceipts();
    expect(deleted).toBeGreaterThanOrEqual(2);
    expect(await getReceipts()).toHaveLength(0);
  });

  it("keeps the office configuration", async () => {
    await setOfficeName("Strativ Dhaka");
    await deleteAllReceipts();

    expect((await getAppConfig()).officeName).toBe("Strativ Dhaka");

    // Shared in-memory DB: hand the default back to the tests that expect it
    await setOfficeName("Office");
  });
});

describe("Configuration Management", () => {
  beforeAll(async () => {
    // Initialize database before tests
    await initDatabase();
  });

  describe("getAppConfig", () => {
    it("should retrieve default office name and database URL", async () => {
      const config = await getAppConfig();

      expect(config).toBeDefined();
      expect(config.officeName).toBe("Office");
      expect(config.databaseUrl).toBeNull();
      expect(config.lastUpdated).toBeDefined();
    });

    it("should retrieve updated office name after setOfficeName", async () => {
      await setOfficeName("Test Office");
      const config = await getAppConfig();

      expect(config.officeName).toBe("Test Office");
    });

    it("should retrieve updated database URL after setDatabaseUrl", async () => {
      await setDatabaseUrl("https://example.com/db");
      const config = await getAppConfig();

      expect(config.databaseUrl).toBe("https://example.com/db");
    });
  });

  describe("setOfficeName", () => {
    it("should update office name successfully", async () => {
      await setOfficeName("New Office Name");
      const config = await getAppConfig();

      expect(config.officeName).toBe("New Office Name");
    });

    it("should handle empty string office name", async () => {
      await setOfficeName("");
      const config = await getAppConfig();

      expect(config.officeName).toBe("");
    });

    it("should handle special characters in office name", async () => {
      const specialName = "Office & Co. (Division #1)";
      await setOfficeName(specialName);
      const config = await getAppConfig();

      expect(config.officeName).toBe(specialName);
    });

    it("should update lastUpdated timestamp", async () => {
      const beforeTime = new Date().toISOString();
      await setOfficeName("Time Test Office");
      const config = await getAppConfig();

      expect(config.lastUpdated).toBeDefined();
      expect(new Date(config.lastUpdated).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeTime).getTime(),
      );
    });
  });

  describe("setDatabaseUrl", () => {
    it("should update database URL successfully", async () => {
      const url = "postgresql://user:pass@localhost:5432/db";
      await setDatabaseUrl(url);
      const config = await getAppConfig();

      expect(config.databaseUrl).toBe(url);
    });

    it("should handle null database URL", async () => {
      await setDatabaseUrl(null);
      const config = await getAppConfig();

      expect(config.databaseUrl).toBeNull();
    });

    it("should convert null to empty string in database", async () => {
      await setDatabaseUrl(null);
      const config = await getAppConfig();

      // When null is stored, getAppConfig should return null (not empty string)
      expect(config.databaseUrl).toBeNull();
    });

    it("should handle various database URL formats", async () => {
      const urls = [
        "mysql://user:pass@localhost:3306/db",
        "mongodb://user:pass@localhost:27017/db",
        "https://api.example.com/receipts",
      ];

      for (const url of urls) {
        await setDatabaseUrl(url);
        const config = await getAppConfig();
        expect(config.databaseUrl).toBe(url);
      }
    });
  });

  describe("getExportColumns", () => {
    it("should retrieve default export columns", async () => {
      const columns = await getExportColumns();

      expect(columns).toBeDefined();
      expect(columns.length).toBeGreaterThan(0);

      // Check default columns exist
      const fields = columns.map((col) => col.field);
      expect(fields).toContain("receipt_date");
      expect(fields).toContain("merchant_name");
      expect(fields).toContain("total");
    });

    it("should return columns ordered by order_index", async () => {
      const columns = await getExportColumns();

      // Verify columns are sorted by order
      for (let i = 0; i < columns.length - 1; i++) {
        expect(columns[i].order).toBeLessThanOrEqual(columns[i + 1].order);
      }
    });

    it("should include enabled field as boolean", async () => {
      const columns = await getExportColumns();

      columns.forEach((col) => {
        expect(typeof col.enabled).toBe("boolean");
      });
    });

    it("should have required fields in each column", async () => {
      const columns = await getExportColumns();

      columns.forEach((col) => {
        expect(col.field).toBeDefined();
        expect(typeof col.field).toBe("string");
        expect(col.label).toBeDefined();
        expect(typeof col.label).toBe("string");
        expect(typeof col.enabled).toBe("boolean");
        expect(typeof col.order).toBe("number");
      });
    });
  });

  describe("setExportColumns", () => {
    it("should update export columns successfully", async () => {
      const newColumns: ExportColumnConfig[] = [
        { field: "receipt_date", label: "Date", enabled: true, order: 0 },
        { field: "merchant_name", label: "Merchant", enabled: true, order: 1 },
        { field: "total", label: "Total Amount", enabled: true, order: 2 },
      ];

      await setExportColumns(newColumns);
      const columns = await getExportColumns();

      expect(columns.length).toBe(3);
      expect(columns[0].field).toBe("receipt_date");
      expect(columns[1].field).toBe("merchant_name");
      expect(columns[2].field).toBe("total");
    });

    it("should handle reordering columns", async () => {
      const reorderedColumns: ExportColumnConfig[] = [
        { field: "total", label: "Amount", enabled: true, order: 0 },
        { field: "receipt_date", label: "Date", enabled: true, order: 1 },
        { field: "merchant_name", label: "Merchant", enabled: true, order: 2 },
      ];

      await setExportColumns(reorderedColumns);
      const columns = await getExportColumns();

      expect(columns[0].field).toBe("total");
      expect(columns[1].field).toBe("receipt_date");
      expect(columns[2].field).toBe("merchant_name");
    });

    it("should handle disabling columns", async () => {
      const columnsWithDisabled: ExportColumnConfig[] = [
        { field: "receipt_date", label: "Date", enabled: true, order: 0 },
        { field: "merchant_name", label: "Merchant", enabled: false, order: 1 },
        { field: "total", label: "Amount", enabled: true, order: 2 },
      ];

      await setExportColumns(columnsWithDisabled);
      const columns = await getExportColumns();

      const merchantColumn = columns.find(
        (col) => col.field === "merchant_name",
      );
      expect(merchantColumn?.enabled).toBe(false);
    });

    it("should replace all columns (not append)", async () => {
      // First set 5 columns
      const manyColumns: ExportColumnConfig[] = [
        { field: "field1", label: "Field 1", enabled: true, order: 0 },
        { field: "field2", label: "Field 2", enabled: true, order: 1 },
        { field: "field3", label: "Field 3", enabled: true, order: 2 },
        { field: "field4", label: "Field 4", enabled: true, order: 3 },
        { field: "field5", label: "Field 5", enabled: true, order: 4 },
      ];
      await setExportColumns(manyColumns);

      // Then set only 2 columns
      const fewColumns: ExportColumnConfig[] = [
        { field: "fieldA", label: "Field A", enabled: true, order: 0 },
        { field: "fieldB", label: "Field B", enabled: true, order: 1 },
      ];
      await setExportColumns(fewColumns);

      const columns = await getExportColumns();
      expect(columns.length).toBe(2);
      expect(columns[0].field).toBe("fieldA");
      expect(columns[1].field).toBe("fieldB");
    });

    it("should handle empty columns array", async () => {
      await setExportColumns([]);
      const columns = await getExportColumns();

      expect(columns.length).toBe(0);
    });

    it("should handle column label changes", async () => {
      const columnsWithNewLabels: ExportColumnConfig[] = [
        {
          field: "receipt_date",
          label: "Transaction Date",
          enabled: true,
          order: 0,
        },
        {
          field: "merchant_name",
          label: "Vendor Name",
          enabled: true,
          order: 1,
        },
      ];

      await setExportColumns(columnsWithNewLabels);
      const columns = await getExportColumns();

      expect(columns[0].label).toBe("Transaction Date");
      expect(columns[1].label).toBe("Vendor Name");
    });
  });

  describe("Integration: Full Configuration Workflow", () => {
    it("should handle complete configuration update workflow", async () => {
      // Set office configuration
      await setOfficeName("Integration Test Office");
      await setDatabaseUrl("https://test-db.example.com");

      // Set export columns
      const columns: ExportColumnConfig[] = [
        { field: "receipt_date", label: "Date", enabled: true, order: 0 },
        { field: "merchant_name", label: "Merchant", enabled: true, order: 1 },
        { field: "total", label: "Amount", enabled: true, order: 2 },
        { field: "tax", label: "Tax", enabled: false, order: 3 },
      ];
      await setExportColumns(columns);

      // Retrieve all configuration
      const config = await getAppConfig();
      const retrievedColumns = await getExportColumns();

      // Verify configuration
      expect(config.officeName).toBe("Integration Test Office");
      expect(config.databaseUrl).toBe("https://test-db.example.com");
      expect(retrievedColumns.length).toBe(4);
      expect(retrievedColumns[0].field).toBe("receipt_date");
      expect(retrievedColumns[3].enabled).toBe(false);
    });

    it("should persist configuration across multiple operations", async () => {
      // Initial setup
      await setOfficeName("Persistence Test");
      const columns: ExportColumnConfig[] = [
        { field: "test1", label: "Test 1", enabled: true, order: 0 },
        { field: "test2", label: "Test 2", enabled: true, order: 1 },
      ];
      await setExportColumns(columns);

      // Verify initial state
      let config = await getAppConfig();
      let retrievedColumns = await getExportColumns();
      expect(config.officeName).toBe("Persistence Test");
      expect(retrievedColumns.length).toBe(2);

      // Update only office name
      await setOfficeName("Updated Persistence Test");

      // Verify columns unchanged
      config = await getAppConfig();
      retrievedColumns = await getExportColumns();
      expect(config.officeName).toBe("Updated Persistence Test");
      expect(retrievedColumns.length).toBe(2);
      expect(retrievedColumns[0].field).toBe("test1");

      // Update only database URL
      await setDatabaseUrl("https://new-url.example.com");

      // Verify everything else unchanged
      config = await getAppConfig();
      retrievedColumns = await getExportColumns();
      expect(config.officeName).toBe("Updated Persistence Test");
      expect(config.databaseUrl).toBe("https://new-url.example.com");
      expect(retrievedColumns.length).toBe(2);
    });
  });
});
