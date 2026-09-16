/**
 * XLSX Export Service
 *
 * Generates the monthly "Bill Approval Sheet" — the document the office team
 * processes at month end. Written for non-technical readers: merged title
 * block, labelled columns, real numbers (so Excel can sum them), a summary
 * block, and a signature block to print and sign.
 *
 * Uses xlsx-js-style rather than plain `xlsx`: the community SheetJS build
 * silently drops cell styles on write, so borders/bold/fills would vanish.
 */

import * as FileSystem from "expo-file-system/legacy";
import XLSX from "xlsx-js-style";
import { LineItem, Receipt } from "@/types/receipt";
import { hasBreakdown, quantityOf, unitPriceOf } from "@/utils/line-item";
import { getColumns, getOfficeName } from "./config";
import { ExportColumnConfig, formatMonthlyPeriod } from "./storage";

const EXPORT_DIR = `${FileSystem.documentDirectory}exports/`;

/** Strativ Orange — header band of the printed sheet */
const BRAND = "FE5001";
const WARM_BLACK = "1A0E1C";
const ZEBRA = "F7F5F6";
/** Explicit paper white: without a fill, viewers in dark mode render the sheet
 *  on their own dark background and it stops looking like a document. */
const WHITE = "FFFFFF";

type Person = { name: string; designation: string };

const MONEY_FMT = "#,##0.00";

/**
 * Export configuration for monthly receipt export
 */
export interface MonthlyExportConfig {
  receipts: Receipt[];
  officeName: string;
  year: number;
  month: number;
  columns: ExportColumnConfig[];
  /** Cash drawn from the account for the month; defaults to the bill total */
  amountReceived?: number;
  /** Overrides the "Month: …" heading for an ad-hoc selection of receipts */
  periodLabel?: string;
  includeImages?: boolean;
}

/**
 * Signature section configuration
 */
export interface SignatureConfig {
  preparedBy: { name: string; designation: string };
  checkedBy: { name: string; designation: string };
  reviewedBy: { name: string; designation: string };
  approvedBy: { name: string; designation: string };
}

/**
 * Summary totals calculated from receipts
 */
export interface SummaryTotals {
  totalBillAmount: number;
  amountReceived: number;
  excessOrLess: number;
}

const thin = { style: "thin", color: { rgb: "B9B4BA" } } as const;
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };

type Cell = { v: string | number; t: "s" | "n"; s?: any; z?: string };

function text(v: string, style?: any): Cell {
  return { v, t: "s", s: style };
}

function money(v: number, style?: any): Cell {
  return { v, t: "n", z: MONEY_FMT, s: { ...style, numFmt: MONEY_FMT } };
}

/**
 * Human-readable date: "15 Jan 2026" — never MM/DD vs DD/MM ambiguous, which
 * matters for a sheet read by both local and overseas staff.
 */
function displayDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function titleCase(v: string): string {
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : "";
}

/** Columns that hold money, and therefore stay numeric in the sheet */
const MONEY_FIELDS = new Set([
  "total",
  "tax",
  "subtotal",
  "item_price",
  "item_unit_price",
]);

/**
 * The columns written once per line item instead of once per receipt, and so
 * never merged down the block. None of them is a field on Receipt — all four
 * are drawn straight off `receipt.items` by the data table.
 */
const ITEM_FIELDS = new Set([
  "items",
  "item_qty",
  "item_unit_price",
  "item_price",
]);

/** The two of those that only exist when a receipt split a line into count x rate */
const BREAKDOWN_FIELDS = new Set(["item_qty", "item_unit_price"]);

/**
 * En dash for a figure the receipt deliberately did not state — the accounting
 * convention, and unambiguous next to an empty cell, which reads as an
 * oversight. Text, so Excel's SUM skips it and the column still totals.
 */
const BLANK_FIGURE = "–";

/**
 * Line items for the stacked sub-rows. Unnamed items are dropped rather than
 * printed as blank rows — a receipt whose items the AI could not read should
 * take one row, not five empty ones.
 */
function lineItems(receipt: Receipt): LineItem[] {
  return (receipt.items ?? []).filter((item) => item.name?.trim());
}

/** Plain number cell — quantities are counts, not money */
function count(v: number, style?: any): Cell {
  return { v, t: "n", s: style };
}

function enabledColumns(columns: ExportColumnConfig[]): ExportColumnConfig[] {
  return [...columns]
    .filter((c) => c.enabled)
    .sort((a, b) => a.order - b.order);
}

/**
 * Calculate summary totals from receipts.
 * `amountReceived` is what the office actually disbursed; when it is not
 * supplied we assume it matched the bills exactly (excess/less of zero).
 */
export function calculateSummary(
  receipts: Receipt[],
  amountReceived?: number,
): SummaryTotals {
  const totalBillAmount = receipts.reduce(
    (sum, receipt) => sum + (receipt.total || 0),
    0,
  );
  const received = amountReceived ?? totalBillAmount;

  return {
    totalBillAmount,
    amountReceived: received,
    excessOrLess: received - totalBillAmount,
  };
}

/**
 * Format receipt data according to column configuration.
 * Money stays a number so Excel can total the column; everything else is
 * rendered for a human reader.
 */
export function formatReceiptRow(
  receipt: Receipt,
  columns: ExportColumnConfig[],
): Record<string, any> {
  const row: Record<string, any> = {};

  for (const column of enabledColumns(columns)) {
    const field = column.field as keyof Receipt;
    const value = receipt[field];

    if (ITEM_FIELDS.has(column.field)) {
      // Not a Receipt field. The sheet stacks these down sub-rows (see the data
      // table below); the joined names are here for any plain-row consumer.
      row[column.label] =
        column.field === "items"
          ? lineItems(receipt).map((item) => item.name.trim()).join(", ")
          : "";
    } else if (field === "receipt_date") {
      row[column.label] = displayDate(value as string | null);
    } else if (MONEY_FIELDS.has(field)) {
      row[column.label] = typeof value === "number" ? value : 0;
    } else if (field === "invoice_type" || field === "payment_method") {
      row[column.label] = titleCase((value as string) ?? "");
    } else {
      row[column.label] = value ?? "";
    }
  }

  return row;
}

async function ensureExportDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(EXPORT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(EXPORT_DIR, { intermediates: true });
  }
}

/**
 * Generate monthly receipt export as XLSX file.
 * Returns the file URI of the generated workbook.
 */
export async function generateMonthlyXLSX(
  config: MonthlyExportConfig,
  signatures: SignatureConfig,
): Promise<string> {
  const { ws, periodLabel } = buildBillApprovalSheet(config, signatures);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, periodLabel.slice(0, 31));

  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });

  await ensureExportDir();
  const safeOffice = config.officeName
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const filename = `${safeOffice || "Office"}_Bill_Approval_${periodLabel.replace(/ /g, "_")}.xlsx`;
  const filepath = `${EXPORT_DIR}${filename}`;

  await FileSystem.writeAsStringAsync(filepath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return filepath;
}

/**
 * Build the worksheet. Separate from file writing so the layout — merges, row
 * heights, fills — can be asserted directly: the XLSX *reader* discards cell
 * styles, so a write/read round-trip cannot check any of the formatting.
 */
export function buildBillApprovalSheet(
  config: MonthlyExportConfig,
  signatures: SignatureConfig,
): { ws: Record<string, any>; periodLabel: string } {
  const { receipts, officeName, year, month } = config;

  if (receipts.length === 0) {
    throw new Error("No receipts found for this period.");
  }

  const enabled = enabledColumns(config.columns);
  if (enabled.length === 0) {
    throw new Error("No export columns are enabled. Check Settings.");
  }

  // Qty and Unit Price earn their width only if something in this export
  // actually used them. A month of service invoices — a logo design, a repair,
  // an internet bill — would otherwise carry two columns blank top to bottom.
  // Where they do appear, a row that lacks a breakdown gets BLANK_FIGURE rather
  // than an empty cell, so the approver can tell "the receipt stated no
  // quantity" from "the scan missed it".
  const anyBreakdown = receipts.some((receipt) =>
    lineItems(receipt).some(hasBreakdown),
  );
  const kept = anyBreakdown
    ? enabled
    : enabled.filter((col) => !BREAKDOWN_FIELDS.has(col.field));
  // Only if someone enabled nothing but those two, which would print no sheet
  const columns = kept.length > 0 ? kept : enabled;

  // The signature block needs four columns; widen the sheet if the table is
  // narrower so the blocks never collide.
  const width = Math.max(columns.length, 4);
  const lastCol = width - 1;
  const periodLabel =
    config.periodLabel ?? formatMonthlyPeriod({ year, month, label: "" });

  const ws: Record<string, any> = {};
  const merges: any[] = [];
  const rowHeights: Record<number, number> = {};
  let r = 0;

  const put = (row: number, col: number, cell: Cell) => {
    ws[XLSX.utils.encode_cell({ r: row, c: col })] = cell;
  };
  const mergeRow = (row: number, from: number, to: number) => {
    merges.push({ s: { r: row, c: from }, e: { r: row, c: to } });
  };
  const mergeColumn = (col: number, from: number, to: number) => {
    merges.push({ s: { r: from, c: col }, e: { r: to, c: col } });
  };

  // ── Header block ────────────────────────────────────────────────────────
  const paper = { fill: { fgColor: { rgb: WHITE } } };

  put(r, 0, text(officeName.toUpperCase(), {
    ...paper,
    font: { bold: true, sz: 16, color: { rgb: WARM_BLACK } },
    alignment: { horizontal: "center", vertical: "center" },
  }));
  mergeRow(r, 0, lastCol);
  rowHeights[r] = 28;
  r++;

  put(r, 0, text("Bill Approval Sheet", {
    ...paper,
    font: { bold: true, sz: 14, color: { rgb: WARM_BLACK } },
    alignment: { horizontal: "center" },
  }));
  mergeRow(r, 0, lastCol);
  rowHeights[r] = 22;
  r++;

  r++; // spacer

  const half = Math.max(1, Math.floor(width / 2));
  put(r, 0, text(`Month: ${periodLabel}`, { ...paper, font: { bold: true } }));
  mergeRow(r, 0, half - 1);

  // Label, then an empty bordered cell to write the date into. Merging the
  // label all the way to the last column left it flush against the edge of the
  // sheet with nowhere to write.
  const dateLabelStyle = { ...paper, alignment: { horizontal: "right" } };
  put(r, half, text("Approval Date:", dateLabelStyle));
  for (let c = half + 1; c < lastCol; c++) put(r, c, text("", dateLabelStyle));
  if (lastCol - 1 > half) mergeRow(r, half, lastCol - 1);
  put(r, lastCol, text("", { ...paper, border: BORDER }));

  rowHeights[r] = 22;
  r++;

  r++; // spacer

  // ── Data table ──────────────────────────────────────────────────────────
  const headerStyle = {
    font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: BRAND } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: BORDER,
  };
  columns.forEach((col, c) => put(r, c, text(col.label, headerStyle)));
  // Pad the header band across the signature width so it reads as one table
  for (let c = columns.length; c < width; c++) put(r, c, text("", headerStyle));
  const headerRow = r;
  r++;

  rowHeights[r] = 26;
  const stacksItems = columns.some((col) => ITEM_FIELDS.has(col.field));

  receipts.forEach((receipt, i) => {
    const values = formatReceiptRow(receipt, columns);
    const zebra = {
      fill: { fgColor: { rgb: i % 2 === 1 ? ZEBRA : WHITE } },
    };

    // One sub-row per line item, so Particulars and its price read as a list
    // the way a hand-written bill sheet does. Every other column — the receipt
    // total included — is written once on the first row and merged down.
    const items = stacksItems ? lineItems(receipt) : [];
    const firstRow = r;
    const blockEnd = firstRow + Math.max(1, items.length) - 1;
    const stacked = blockEnd > firstRow;

    for (let row = firstRow; row <= blockEnd; row++) {
      columns.forEach((col, c) => {
        const isMoney = MONEY_FIELDS.has(col.field);
        const base = {
          ...zebra,
          border: BORDER,
          alignment: {
            horizontal: isMoney || col.field === "item_qty" ? "right" : "left",
            // Top, not centre, once a receipt spans rows: the date should line
            // up with the first item, not float halfway down the block.
            vertical: stacked ? "top" : "center",
            wrapText: false,
          },
        };
        if (ITEM_FIELDS.has(col.field)) {
          const item = items[row - firstRow];
          if (!item) {
            put(row, c, text("", base));
          } else if (col.field === "items") {
            put(row, c, text(item.name.trim(), base));
          } else if (col.field === "item_qty") {
            // A dash, never 1: see hasBreakdown in utils/line-item.ts
            put(row, c, hasBreakdown(item)
              ? count(quantityOf(item), base)
              : text(BLANK_FIGURE, base));
          } else if (col.field === "item_unit_price") {
            put(row, c, hasBreakdown(item)
              ? money(unitPriceOf(item), base)
              : text(BLANK_FIGURE, base));
          } else {
            put(row, c, money(item.price ?? 0, base));
          }
          return;
        }
        if (row > firstRow) {
          put(row, c, text("", base));
          return;
        }
        const value = values[col.label];
        put(row, c, isMoney ? money(Number(value) || 0, base) : text(String(value ?? ""), base));
      });
      for (let c = columns.length; c < width; c++) {
        put(row, c, text("", { ...zebra, border: BORDER }));
      }
    }

    if (stacked) {
      columns.forEach((col, c) => {
        if (!ITEM_FIELDS.has(col.field)) mergeColumn(c, firstRow, blockEnd);
      });
      for (let c = columns.length; c < width; c++) {
        mergeColumn(c, firstRow, blockEnd);
      }
    }

    r = blockEnd + 1;
  });

  r++; // spacer

  // ── Summary block ───────────────────────────────────────────────────────
  const summary = calculateSummary(receipts, config.amountReceived);
  const labelStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: WHITE } },
    alignment: { horizontal: "right" },
    border: BORDER,
  };
  const valueStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: WHITE } },
    alignment: { horizontal: "right" },
    border: BORDER,
  };

  const summaryRows: [string, number][] = [
    ["Total Bill Amount", summary.totalBillAmount],
    ["Amount Received from Account", summary.amountReceived],
    ["Excess / (Less) Amount", summary.excessOrLess],
  ];

  const valueCol = lastCol;
  // "Amount Received from Account" is ~28 characters; a two-column merge
  // clipped it to "unt Received from Account". Give the label half the sheet.
  const labelFrom = Math.max(0, Math.min(valueCol - 1, Math.floor(width / 2) - 1));
  for (const [label, value] of summaryRows) {
    put(r, labelFrom, text(label, labelStyle));
    if (labelFrom < valueCol - 1) mergeRow(r, labelFrom, valueCol - 1);
    // Keep the cells the label merges over inside the border grid
    for (let c = labelFrom + 1; c < valueCol; c++) put(r, c, text("", labelStyle));
    put(r, valueCol, money(value, valueStyle));
    r++;
  }

  r += 2; // spacer before signatures

  // ── Signature block ─────────────────────────────────────────────────────
  const roles: [string, { name: string; designation: string }][] = [
    ["Prepared By", signatures.preparedBy],
    ["Checked By", signatures.checkedBy],
    ["Reviewed By", signatures.reviewedBy],
    ["Approved By", signatures.approvedBy],
  ];

  // Proportional split, so the remainder is shared instead of dumped on the
  // last block: floor(i*width/4) gave 1,1,1,4 columns for a 7-column sheet.
  const blockStart = (i: number) => Math.floor((i * width) / 4);
  const blockEnd = (i: number) => Math.floor(((i + 1) * width) / 4) - 1;

  const roleStyle = {
    font: { bold: true, color: { rgb: WARM_BLACK } },
    fill: { fgColor: { rgb: WHITE } },
    alignment: { horizontal: "center", vertical: "center" },
    border: BORDER,
  };
  const fieldStyle = {
    fill: { fgColor: { rgb: WHITE } },
    // wrapText: a 7-column sheet cannot split 4 ways evenly, so the narrowest
    // block must be able to hold "Designation: Accounts Officer" on two lines
    // rather than clipping it.
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    border: BORDER,
  };

  const writeBlockRow = (
    render: (role: string, person: Person) => string,
    style: any,
  ) => {
    roles.forEach(([role, person], i) => {
      const from = blockStart(i);
      const to = Math.max(from, blockEnd(i));
      put(r, from, text(render(role, person), style));
      for (let c = from + 1; c <= to; c++) put(r, c, text("", style));
      if (to > from) mergeRow(r, from, to);
    });
    r++;
  };

  writeBlockRow((role) => role, roleStyle);

  // No underscore runs: they overflowed a narrow block and got clipped. The
  // bordered cell is the space to write in, and the row is tall enough to sign.
  const signatureRows: [(person: Person) => string, number | null][] = [
    // No fixed height on these two: wrapped text needs to grow the row itself
    [(person: Person) => `Name: ${person.name}`.trimEnd(), null],
    [(person: Person) => `Designation: ${person.designation}`.trimEnd(), null],
    // Taller: this is the row someone signs by hand
    [() => "Signature:", 34],
  ];

  for (const [render, height] of signatureRows) {
    if (height !== null) rowHeights[r] = height;
    writeBlockRow((_role, person) => render(person), fieldStyle);
  }

  // ── Sheet metadata ──────────────────────────────────────────────────────
  const lastRow = r - 1;

  // Paint every untouched cell — spacer rows and the gaps beside the summary —
  // so the whole document reads as white paper instead of picking up the
  // viewer's dark theme.
  for (let row = 0; row <= lastRow; row++) {
    for (let c = 0; c <= lastCol; c++) {
      const address = XLSX.utils.encode_cell({ r: row, c });
      if (!ws[address]) {
        ws[address] = { v: "", t: "s", s: { fill: { fgColor: { rgb: WHITE } } } };
      }
    }
  }

  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: lastRow, c: lastCol },
  });
  ws["!merges"] = merges;
  ws["!cols"] = Array.from({ length: width }, (_, c) => {
    const field = columns[c]?.field;
    if (field === "merchant_name") return { wch: 26 };
    if (field === "items") return { wch: 34 };
    if (field === "receipt_date") return { wch: 14 };
    if (field === "item_qty") return { wch: 7 };
    return { wch: 16 };
  });
  ws["!rows"] = Array.from({ length: lastRow + 1 }, (_, row) =>
    rowHeights[row] ? { hpt: rowHeights[row] } : {},
  );
  // No autofilter and no freeze panes: the filter arrows sat in the middle of
  // the printed header, and both are the "some Excel features can't be
  // displayed" warning that viewers show. This is a document to read and sign,
  // not a workbook to slice.

  return { ws, periodLabel };
}

/** Signatories are left blank on ad-hoc exports and print as lines to sign */
const BLANK_SIGNATURES: SignatureConfig = {
  preparedBy: { name: "", designation: "" },
  checkedBy: { name: "", designation: "" },
  reviewedBy: { name: "", designation: "" },
  approvedBy: { name: "", designation: "" },
};

/**
 * Produce the house sheet for any set of receipts — one receipt from its detail
 * screen, or a filtered list from History. Same layout as the monthly export so
 * there is only ever one document format to read.
 */
export async function exportReceiptsAsSheet(
  receipts: Receipt[],
  label?: string,
): Promise<string> {
  if (receipts.length === 0) {
    throw new Error("No receipts to export.");
  }

  const [officeName, columns] = await Promise.all([getOfficeName(), getColumns()]);

  // Date the sheet by the newest receipt; say "Selected Receipts" when the
  // selection straddles months, rather than labelling it with one of them.
  const monthOf = (r: Receipt) => (r.receipt_date || r.created_at).slice(0, 7);
  const newest = receipts.reduce((a, b) => (monthOf(a) >= monthOf(b) ? a : b));
  const [year, month] = monthOf(newest).split("-").map(Number);
  const spansMonths = new Set(receipts.map(monthOf)).size > 1;

  return generateMonthlyXLSX(
    {
      receipts,
      officeName,
      year,
      month,
      columns,
      periodLabel: label ?? (spansMonths ? "Selected Receipts" : undefined),
    },
    BLANK_SIGNATURES,
  );
}
