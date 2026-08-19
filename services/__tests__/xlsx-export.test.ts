/**
 * Generates a real workbook, reads it back, and checks the parts a
 * non-technical reader depends on: the heading, the labelled columns, numeric
 * money cells, and the summary arithmetic.
 */

import XLSX from 'xlsx-js-style';
import {
  calculateSummary,
  formatReceiptRow,
  generateMonthlyXLSX,
} from '../xlsx-export';
import { ExportColumnConfig } from '../storage';
import { Receipt } from '@/types/receipt';

let written: { path: string; data: string } | null = null;

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => {
    written = { path, data };
  }),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
}));

const COLUMNS: ExportColumnConfig[] = [
  { field: 'receipt_date', label: 'Date', enabled: true, order: 0 },
  { field: 'merchant_name', label: 'Merchant', enabled: true, order: 1 },
  { field: 'total', label: 'Amount', enabled: true, order: 2 },
  { field: 'currency', label: 'Currency', enabled: true, order: 3 },
  { field: 'tax', label: 'Tax', enabled: false, order: 4 },
];

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'r1',
    merchant_name: 'Shwapno',
    receipt_date: '2026-08-15',
    receipt_number: 'R-001',
    invoice_type: 'retail',
    items: [],
    subtotal: 100,
    tax: 15,
    total: 115,
    currency: 'BDT',
    payment_method: 'cash',
    confidence_score: 0.9,
    image_uri: 'file:///img.jpg',
    raw_text: null,
    error_message: null,
    created_at: '2026-08-15T10:00:00.000Z',
    ...overrides,
  };
}

const SIGNATURES = {
  preparedBy: { name: 'Rahim', designation: 'Accounts Officer' },
  checkedBy: { name: '', designation: '' },
  reviewedBy: { name: '', designation: '' },
  approvedBy: { name: 'Karim', designation: 'Director' },
};

/** Flatten the generated sheet to the list of its cell values */
function readCells(): { values: any[]; sheet: any } {
  expect(written).not.toBeNull();
  const wb = XLSX.read(written!.data, { type: 'base64' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const values = Object.keys(sheet)
    .filter((k) => !k.startsWith('!'))
    .map((k) => sheet[k].v);
  return { values, sheet };
}

beforeEach(() => {
  written = null;
});

describe('calculateSummary', () => {
  it('totals the bills', () => {
    const summary = calculateSummary([receipt(), receipt({ total: 85 })]);
    expect(summary.totalBillAmount).toBe(200);
  });

  it('reports excess when more cash was drawn than spent', () => {
    const summary = calculateSummary([receipt({ total: 500 })], 700);
    expect(summary.amountReceived).toBe(700);
    expect(summary.excessOrLess).toBe(200);
  });

  it('reports a shortfall as a negative number', () => {
    const summary = calculateSummary([receipt({ total: 500 })], 300);
    expect(summary.excessOrLess).toBe(-200);
  });

  it('assumes cash matched the bills when not supplied', () => {
    expect(calculateSummary([receipt({ total: 42 })]).excessOrLess).toBe(0);
  });
});

describe('formatReceiptRow', () => {
  it('keeps money numeric so Excel can total the column', () => {
    const row = formatReceiptRow(receipt(), COLUMNS);
    expect(row.Amount).toBe(115);
    expect(typeof row.Amount).toBe('number');
  });

  it('writes an unambiguous date', () => {
    expect(formatReceiptRow(receipt(), COLUMNS).Date).toBe('15 Aug 2026');
  });

  it('omits disabled columns', () => {
    expect(formatReceiptRow(receipt(), COLUMNS)).not.toHaveProperty('Tax');
  });

  it('survives a receipt the AI could not read', () => {
    const row = formatReceiptRow(
      receipt({ receipt_date: null, merchant_name: null }),
      COLUMNS
    );
    expect(row.Date).toBe('');
    expect(row.Merchant).toBe('');
  });
});

describe('generateMonthlyXLSX', () => {
  const config = {
    receipts: [receipt(), receipt({ id: 'r2', total: 85, merchant_name: 'Agora' })],
    officeName: 'Strativ Dhaka',
    year: 2026,
    month: 8,
    columns: COLUMNS,
  };

  it('refuses to build an empty sheet', async () => {
    await expect(
      generateMonthlyXLSX({ ...config, receipts: [] }, SIGNATURES)
    ).rejects.toThrow(/No receipts/);
  });

  it('refuses when every column is switched off', async () => {
    const off = COLUMNS.map((c) => ({ ...c, enabled: false }));
    await expect(
      generateMonthlyXLSX({ ...config, columns: off }, SIGNATURES)
    ).rejects.toThrow(/column/i);
  });

  it('writes the office name and title at the top', async () => {
    await generateMonthlyXLSX(config, SIGNATURES);
    const { sheet } = readCells();
    expect(sheet.A1.v).toBe('STRATIV DHAKA');
    expect(sheet.A2.v).toBe('Bill Approval Sheet');
  });

  it('labels the columns and names the month', async () => {
    await generateMonthlyXLSX(config, SIGNATURES);
    const { values } = readCells();
    expect(values).toEqual(expect.arrayContaining(['Date', 'Merchant', 'Amount']));
    expect(values).toEqual(expect.arrayContaining(['Month: August 2026']));
  });

  it('carries every receipt into the sheet', async () => {
    await generateMonthlyXLSX(config, SIGNATURES);
    const { values } = readCells();
    expect(values).toEqual(expect.arrayContaining(['Shwapno', 'Agora']));
  });

  it('writes the summary block with correct arithmetic', async () => {
    await generateMonthlyXLSX({ ...config, amountReceived: 250 }, SIGNATURES);
    const { values } = readCells();
    expect(values).toEqual(expect.arrayContaining(['Total Bill Amount']));
    expect(values).toContain(200); // 115 + 85
    expect(values).toContain(250); // received
    expect(values).toContain(50); // excess
  });

  it('prints filled signatories and a blank line for the rest', async () => {
    await generateMonthlyXLSX(config, SIGNATURES);
    const { values } = readCells();
    expect(values).toEqual(
      expect.arrayContaining(['Prepared By', 'Approved By', 'Name: Rahim'])
    );
    expect(values.some((v) => typeof v === 'string' && v.startsWith('Name: ____'))).toBe(
      true
    );
  });

  it('names the file after the office and month', async () => {
    await generateMonthlyXLSX(config, SIGNATURES);
    expect(written!.path).toContain('Strativ_Dhaka_Bill_Approval_August_2026.xlsx');
  });
});
