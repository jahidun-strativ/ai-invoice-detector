/**
 * Generates a real workbook, reads it back, and checks the parts a
 * non-technical reader depends on: the heading, the labelled columns, numeric
 * money cells, and the summary arithmetic.
 */

import XLSX from 'xlsx-js-style';
import {
  buildBillApprovalSheet,
  calculateSummary,
  exportReceiptsAsSheet,
  formatReceiptRow,
  generateMonthlyXLSX,
} from '../xlsx-export';
import { ExportColumnConfig, setOfficeName } from '../storage';
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
  // cellStyles: the reader discards fills and borders without it
  const wb = XLSX.read(written!.data, { type: 'base64', cellStyles: true });
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

  it('prints filled signatories and leaves the rest to sign by hand', async () => {
    await generateMonthlyXLSX(config, SIGNATURES);
    const { values } = readCells();

    expect(values).toEqual(
      expect.arrayContaining([
        'Prepared By',
        'Approved By',
        'Name: Rahim',
        'Designation: Accounts Officer',
      ])
    );
    // Unfilled roles get a bare label; the bordered cell is the writing space,
    // since underscore runs overflowed a narrow block and were clipped
    expect(values).toEqual(expect.arrayContaining(['Name:', 'Signature:']));
    expect(values.some((v) => typeof v === 'string' && v.includes('____'))).toBe(false);
  });

  it('leaves out the filter arrows that viewers warn about', async () => {
    await generateMonthlyXLSX(config, SIGNATURES);
    const { sheet } = readCells();
    expect(sheet['!autofilter']).toBeUndefined();
  });

  it('names the file after the office and month', async () => {
    await generateMonthlyXLSX(config, SIGNATURES);
    expect(written!.path).toContain('Strativ_Dhaka_Bill_Approval_August_2026.xlsx');
  });

  // The CSV export mangled Bangla into "à¦«à§à¦¨à§" because a spreadsheet
  // opening a CSV guesses the code page. XLSX carries UTF-8 inside the file.
  it('round-trips a Bangla merchant name intact', async () => {
    const bangla = 'ফেনী স্টেশনারী';
    await generateMonthlyXLSX(
      { ...config, receipts: [receipt({ merchant_name: bangla })] },
      SIGNATURES
    );

    const { values } = readCells();
    expect(values).toContain(bangla);
    expect(values.some((v) => typeof v === 'string' && v.includes('Ã'))).toBe(false);
  });

  it('keeps a Bangla office name in the heading', async () => {
    await generateMonthlyXLSX({ ...config, officeName: 'ঢাকা অফিস' }, SIGNATURES);
    const { sheet } = readCells();
    expect(sheet.A1.v).toContain('ঢাকা');
  });
});

// Formatting is asserted on the worksheet, not on a re-read file: the XLSX
// reader discards cell styles, so a round-trip cannot see fills or borders.
describe('sheet formatting', () => {
  const CONFIG = {
    receipts: [receipt(), receipt({ id: 'r2', total: 85 })],
    officeName: 'Strativ Dhaka',
    year: 2026,
    month: 8,
    columns: COLUMNS,
  };

  const build = () => buildBillApprovalSheet(CONFIG, SIGNATURES).ws;

  const cellsOf = (ws: Record<string, any>) =>
    Object.keys(ws).filter((k) => !k.startsWith('!'));

  it('paints every cell white so a dark-mode viewer still shows paper', () => {
    const ws = build();
    const unpainted = cellsOf(ws).filter((k) => !ws[k].s?.fill?.fgColor?.rgb);
    expect(unpainted).toEqual([]);
  });

  it('gives the summary label room for its longest text', () => {
    const ws = build();
    const labelKey = cellsOf(ws).find(
      (k) => ws[k].v === 'Amount Received from Account'
    )!;
    const { r, c } = XLSX.utils.decode_cell(labelKey);
    const merge = ws['!merges'].find((m: any) => m.s.r === r && m.s.c === c);

    // "Amount Received from Account" is 28 chars; columns are 16 wide, so it
    // needs at least two of them merged (it used to get exactly one).
    expect(merge.e.c - merge.s.c + 1).toBeGreaterThanOrEqual(2);
  });

  // The reported bug needed 7 columns: floor(7/4)=1 gave blocks of 1,1,1,4 and
  // "Approved By" sprawled across half the sheet.
  it.each([4, 5, 6, 7, 9])(
    'splits the four signature blocks evenly across %i columns',
    (count) => {
      const columns = Array.from({ length: count }, (_, i) => ({
        field: i === 0 ? 'receipt_date' : `field_${i}`,
        label: `Col ${i}`,
        enabled: true,
        order: i,
      }));

      const ws = buildBillApprovalSheet({ ...CONFIG, columns }, SIGNATURES).ws;
      const roleKey = cellsOf(ws).find((k) => ws[k].v === 'Prepared By')!;
      const row = XLSX.utils.decode_cell(roleKey).r;
      const merged = ws['!merges'].filter((m: any) => m.s.r === row);

      // Reconstruct each block's width, counting single unmerged columns too
      const spans = [0, 1, 2, 3].map((i) => {
        const start = Math.floor((i * count) / 4);
        const m = merged.find((x: any) => x.s.c === start);
        return m ? m.e.c - m.s.c + 1 : 1;
      });

      expect(spans.reduce((a, b) => a + b, 0)).toBe(count);
      expect(Math.max(...spans) - Math.min(...spans)).toBeLessThanOrEqual(1);
    }
  );

  it('wraps signatory text instead of clipping it in a narrow block', () => {
    const ws = build();
    const key = cellsOf(ws).find(
      (k) => ws[k].v === 'Designation: Accounts Officer'
    )!;
    expect(ws[key].s.alignment.wrapText).toBe(true);
  });

  it('makes the signature row tall enough to sign', () => {
    const ws = build();
    const key = cellsOf(ws).find((k) => ws[k].v === 'Signature:')!;
    const row = XLSX.utils.decode_cell(key).r;
    expect(ws['!rows'][row].hpt).toBeGreaterThanOrEqual(30);
  });

});

describe('exportReceiptsAsSheet', () => {
  it('labels a single-month selection with that month', async () => {
    await exportReceiptsAsSheet([
      receipt({ receipt_date: '2026-08-15' }),
      receipt({ id: 'r2', receipt_date: '2026-08-20' }),
    ]);

    const { values } = readCells();
    expect(values).toEqual(expect.arrayContaining(['Month: August 2026']));
  });

  it('does not pretend a cross-month selection is one month', async () => {
    await exportReceiptsAsSheet([
      receipt({ receipt_date: '2026-07-15' }),
      receipt({ id: 'r2', receipt_date: '2026-08-20' }),
    ]);

    const { values } = readCells();
    expect(values).toEqual(expect.arrayContaining(['Month: Selected Receipts']));
  });

  it('refuses an empty selection', async () => {
    await expect(exportReceiptsAsSheet([])).rejects.toThrow(/No receipts/);
  });

  // The detail screen's "Excel" button — the path that produced the broken CSV
  it('gives one receipt the full house layout', async () => {
    // Ad-hoc exports take the heading from Settings, not from a caller argument
    await setOfficeName('Strativ Dhaka');

    await exportReceiptsAsSheet([receipt({ merchant_name: 'ফেনী স্টেশনারী' })]);
    const { sheet, values } = readCells();

    expect(sheet.A1.v).toBe('STRATIV DHAKA');
    expect(sheet.A2.v).toBe('Bill Approval Sheet');
    expect(values).toEqual(
      expect.arrayContaining([
        'Date',
        'ফেনী স্টেশনারী',
        'Total Bill Amount',
        'Prepared By',
        'Signature:',
      ])
    );
    // Its own month, not today's
    expect(values).toEqual(expect.arrayContaining(['Month: August 2026']));
  });
});
