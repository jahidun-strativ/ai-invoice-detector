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

  describe('Particulars column', () => {
    const ITEM_COLUMNS: ExportColumnConfig[] = [
      { field: 'receipt_date', label: 'Date', enabled: true, order: 0 },
      { field: 'items', label: 'Particulars', enabled: true, order: 1 },
      { field: 'item_qty', label: 'Qty', enabled: true, order: 2 },
      { field: 'item_unit_price', label: 'Unit Price', enabled: true, order: 3 },
      { field: 'item_price', label: 'Item Total', enabled: true, order: 4 },
      { field: 'total', label: 'Amount', enabled: true, order: 5 },
    ];
    const COL = Object.fromEntries(ITEM_COLUMNS.map((c, i) => [c.label, i]));

    const item = (name: string, price = 10) => ({ name, quantity: 1, price });
    const withItems = (id: string, names: string[]) =>
      receipt({ id, items: names.map((n) => item(n)) });

    const buildItems = (receipts: Receipt[]) =>
      buildBillApprovalSheet(
        { ...CONFIG, receipts, columns: ITEM_COLUMNS },
        SIGNATURES
      ).ws;

    const at = (ws: Record<string, any>, ref: string) => ws[ref]?.v;
    /** First data row: the row under the header band */
    const firstDataRow = (ws: Record<string, any>) =>
      XLSX.utils.decode_cell(
        cellsOf(ws).find((k) => ws[k].v === 'Particulars')!
      ).r + 1;

    it('stacks one item per sub-row and merges the date down over them', () => {
      const ws = buildItems([withItems('r1', ['Cement', 'Sand', 'Rod'])]);
      const first = firstDataRow(ws);
      const nameAt = (offset: number) =>
        at(ws, XLSX.utils.encode_cell({ r: first + offset, c: COL.Particulars }));

      expect([0, 1, 2].map(nameAt)).toEqual(['Cement', 'Sand', 'Rod']);

      // Date written once, merged over the three item rows — not repeated
      expect(at(ws, XLSX.utils.encode_cell({ r: first, c: COL.Date }))).toBe('15 Aug 2026');
      expect(at(ws, XLSX.utils.encode_cell({ r: first + 1, c: COL.Date }))).toBe('');
      const merge = ws['!merges'].find(
        (m: any) => m.s.c === COL.Date && m.e.c === COL.Date && m.s.r === first
      );
      expect(merge.e.r).toBe(first + 2);

      // The total belongs to the receipt, so it stays a single number
      expect(at(ws, XLSX.utils.encode_cell({ r: first, c: COL.Amount }))).toBe(115);
      expect(at(ws, XLSX.utils.encode_cell({ r: first + 1, c: COL.Amount }))).toBe('');
    });

    it('gives each item its own quantity, unit price and line total', () => {
      const ws = buildItems([
        receipt({
          id: 'r1',
          items: [
            { name: 'Cement', quantity: 5, price: 1250, unit_price: 250 },
            // No unit_price stored: it has to come back out of the line total
            { name: 'Sand', quantity: 2, price: 160 },
          ],
        }),
      ]);
      const first = firstDataRow(ws);
      const column = (label: string) =>
        [0, 1].map((i) => ws[XLSX.utils.encode_cell({ r: first + i, c: COL[label] })]);

      expect(column('Qty').map((cell) => cell.v)).toEqual([5, 2]);
      expect(column('Unit Price').map((cell) => cell.v)).toEqual([250, 80]);
      expect(column('Item Total').map((cell) => cell.v)).toEqual([1250, 160]);

      // Numbers, not text — otherwise Excel cannot total the columns
      for (const label of ['Qty', 'Unit Price', 'Item Total']) {
        expect(column(label).every((cell) => cell.t === 'n')).toBe(true);
      }
    });

    // A logo design invoice has no count and no rate. Printing a quantity of 1
    // would put a figure on a signed sheet that nobody wrote.
    it('drops Qty and Unit Price entirely when nothing in the export used them', () => {
      const ws = buildItems([
        receipt({ id: 'r1', items: [{ name: 'Logo design', quantity: null, price: 12000 }] }),
        receipt({ id: 'r2', items: [{ name: 'Internet bill', quantity: null, price: 1200 }] }),
      ]);
      const headers = cellsOf(ws).map((k) => ws[k].v);

      expect(headers).not.toContain('Qty');
      expect(headers).not.toContain('Unit Price');
      // What the receipt does say is still there
      expect(headers).toContain('Particulars');
      expect(headers).toContain('Logo design');
      expect(headers).toContain(12000);
    });

    // The ambiguous case: blank here could mean "the scan missed the quantity"
    it('dashes the rows without a breakdown when other rows have one', () => {
      const ws = buildItems([
        receipt({
          id: 'r1',
          items: [
            { name: 'Cement', quantity: 5, price: 1250 },
            { name: 'Delivery charge', quantity: null, price: 300 },
          ],
        }),
      ]);
      const first = firstDataRow(ws);
      const cell = (label: string, offset: number) =>
        ws[XLSX.utils.encode_cell({ r: first + offset, c: COL[label] })];

      expect(cell('Qty', 0).v).toBe(5);
      expect(cell('Qty', 1).v).toBe('–');
      expect(cell('Unit Price', 1).v).toBe('–');
      // Text, so Excel's SUM over the column still works
      expect(cell('Unit Price', 1).t).toBe('s');
      expect(cell('Item Total', 1).v).toBe(300);
    });

    it('never merges a per-item column, only the receipt-level ones', () => {
      const ws = buildItems([withItems('r1', ['Cement', 'Sand', 'Rod'])]);
      const first = firstDataRow(ws);
      const mergedDown = (c: number) =>
        ws['!merges'].some((m: any) => m.s.c === c && m.e.r > m.s.r);

      for (const label of ['Particulars', 'Qty', 'Unit Price', 'Item Total']) {
        expect(mergedDown(COL[label])).toBe(false);
      }
      expect(
        ws['!merges'].some((m: any) => m.s.c === COL.Amount && m.e.r === first + 2)
      ).toBe(true);
    });

    it('gives the next receipt the row after the last item, not the next row', () => {
      const ws = buildItems([
        withItems('r1', ['Cement', 'Sand', 'Rod']),
        withItems('r2', ['Tap']),
      ]);
      const dates = cellsOf(ws).filter((k) => ws[k].v === '15 Aug 2026');
      const rows = dates.map((k) => XLSX.utils.decode_cell(k).r).sort((a, b) => a - b);

      // Three item rows for the first receipt, so the second starts three below
      expect(rows[1] - rows[0]).toBe(3);
    });

    it('takes a single row for a receipt whose items could not be read', () => {
      const ws = buildItems([
        withItems('r1', []),
        withItems('r2', ['Tap']),
      ]);
      const rows = cellsOf(ws)
        .filter((k) => ws[k].v === '15 Aug 2026')
        .map((k) => XLSX.utils.decode_cell(k).r)
        .sort((a, b) => a - b);

      expect(rows[1] - rows[0]).toBe(1);
    });
  });

  it('wraps signatory text instead of clipping it in a narrow block', () => {
    const ws = build();
    const key = cellsOf(ws).find(
      (k) => ws[k].v === 'Designation: Accounts Officer'
    )!;
    expect(ws[key].s.alignment.wrapText).toBe(true);
  });

  it('leaves a box to write the approval date in', () => {
    const ws = build();
    const labelKey = cellsOf(ws).find((k) => ws[k].v === 'Approval Date:')!;
    const { r, c } = XLSX.utils.decode_cell(labelKey);
    const lastCol = XLSX.utils.decode_range(ws['!ref']).e.c;

    // The label must not run to the edge of the sheet...
    const merge = ws['!merges'].find((m: any) => m.s.r === r && m.s.c === c);
    expect(merge ? merge.e.c : c).toBeLessThan(lastCol);

    // ...and the cell it leaves behind must be an empty bordered box
    const box = ws[XLSX.utils.encode_cell({ r, c: lastCol })];
    expect(box.v).toBe('');
    expect(box.s.border).toBeDefined();
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
