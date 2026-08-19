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
import { Receipt } from "@/types/receipt";
import { ExportColumnConfig, formatMonthlyPeriod } from "./storage";

const EXPORT_DIR = `${FileSystem.documentDirectory}exports/`;

/** Strativ Orange — header band of the printed sheet */
const BRAND = "FE5001";
const WARM_BLACK = "1A0E1C";
const ZEBRA = "F7F5F6";

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
const MONEY_FIELDS = new Set(["total", "tax", "subtotal"]);

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

    if (field === "receipt_date") {
      row[column.label] = displayDate(value as string | null);
    } else if (MONEY_FIELDS.has(field)) {
      row[column.label] = typeof value === "number" ? value : 0;
    } else if (field === "invoice_type" || field === "payment_method") {
      row[column.label] = titleCase((value as string) ?? "");
    } else if (field === "items") {
      row[column.label] = Array.isArray(value)
        ? value.map((i: any) => i.name).join(", ")
        : "";
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
  const { receipts, officeName, year, month } = config;

  if (receipts.length === 0) {
    throw new Error("No receipts found for this period.");
  }

  const columns = enabledColumns(config.columns);
  if (columns.length === 0) {
    throw new Error("No export columns are enabled. Check Settings.");
  }

  // The signature block needs four columns; widen the sheet if the table is
  // narrower so the blocks never collide.
  const width = Math.max(columns.length, 4);
  const lastCol = width - 1;
  const periodLabel = formatMonthlyPeriod({ year, month, label: "" });

  const ws: Record<string, any> = {};
  const merges: any[] = [];
  let r = 0;

  const put = (row: number, col: number, cell: Cell) => {
    ws[XLSX.utils.encode_cell({ r: row, c: col })] = cell;
  };
  const mergeRow = (row: number, from: number, to: number) => {
    merges.push({ s: { r: row, c: from }, e: { r: row, c: to } });
  };

  // ── Header block ────────────────────────────────────────────────────────
  put(r, 0, text(officeName.toUpperCase(), {
    font: { bold: true, sz: 16, color: { rgb: WARM_BLACK } },
    alignment: { horizontal: "center", vertical: "center" },
  }));
  mergeRow(r, 0, lastCol);
  r++;

  put(r, 0, text("Bill Approval Sheet", {
    font: { bold: true, sz: 14, color: { rgb: WARM_BLACK } },
    alignment: { horizontal: "center" },
  }));
  mergeRow(r, 0, lastCol);
  r++;

  r++; // spacer

  const half = Math.max(1, Math.floor(width / 2));
  put(r, 0, text(`Month: ${periodLabel}`, { font: { bold: true } }));
  mergeRow(r, 0, half - 1);
  put(r, half, text("Approval Date: ____________________", {
    alignment: { horizontal: "right" },
  }));
  mergeRow(r, half, lastCol);
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

  const firstDataRow = r;
  receipts.forEach((receipt, i) => {
    const values = formatReceiptRow(receipt, columns);
    const zebra = i % 2 === 1 ? { fill: { fgColor: { rgb: ZEBRA } } } : {};

    columns.forEach((col, c) => {
      const value = values[col.label];
      const isMoney = MONEY_FIELDS.has(col.field);
      const base = {
        ...zebra,
        border: BORDER,
        alignment: {
          horizontal: isMoney ? "right" : "left",
          vertical: "center",
          wrapText: false,
        },
      };
      put(r, c, isMoney ? money(Number(value) || 0, base) : text(String(value ?? ""), base));
    });
    for (let c = columns.length; c < width; c++) {
      put(r, c, text("", { ...zebra, border: BORDER }));
    }
    r++;
  });
  const lastDataRow = r - 1;

  r++; // spacer

  // ── Summary block ───────────────────────────────────────────────────────
  const summary = calculateSummary(receipts, config.amountReceived);
  const labelStyle = {
    font: { bold: true },
    alignment: { horizontal: "right" },
    border: BORDER,
  };
  const valueStyle = {
    font: { bold: true },
    alignment: { horizontal: "right" },
    border: BORDER,
  };

  const summaryRows: [string, number][] = [
    ["Total Bill Amount", summary.totalBillAmount],
    ["Amount Received from Account", summary.amountReceived],
    ["Excess / (Less) Amount", summary.excessOrLess],
  ];

  const valueCol = lastCol;
  const labelFrom = Math.max(0, valueCol - 2);
  for (const [label, value] of summaryRows) {
    put(r, labelFrom, text(label, labelStyle));
    if (labelFrom < valueCol - 1) mergeRow(r, labelFrom, valueCol - 1);
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

  // Spread the four blocks evenly across the sheet width
  const span = Math.max(1, Math.floor(width / 4));
  const roleStyle = {
    font: { bold: true, color: { rgb: WARM_BLACK } },
    alignment: { horizontal: "center" },
    border: BORDER,
  };
  const fieldStyle = { border: BORDER, alignment: { horizontal: "left" } };

  const blockStart = (i: number) => i * span;
  const blockEnd = (i: number) => (i === 3 ? lastCol : (i + 1) * span - 1);

  roles.forEach(([role], i) => {
    put(r, blockStart(i), text(role, roleStyle));
    if (blockEnd(i) > blockStart(i)) mergeRow(r, blockStart(i), blockEnd(i));
  });
  r++;

  const fieldRows: ((s: { name: string; designation: string }) => string)[] = [
    (s) => `Name: ${s.name || "________________"}`,
    (s) => `Designation: ${s.designation || "________________"}`,
    () => "Signature: ________________",
  ];

  for (const render of fieldRows) {
    roles.forEach(([, person], i) => {
      put(r, blockStart(i), text(render(person), fieldStyle));
      if (blockEnd(i) > blockStart(i)) mergeRow(r, blockStart(i), blockEnd(i));
    });
    r++;
  }

  // ── Sheet metadata ──────────────────────────────────────────────────────
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: r - 1, c: lastCol },
  });
  ws["!merges"] = merges;
  ws["!cols"] = Array.from({ length: width }, (_, c) => {
    const field = columns[c]?.field;
    if (field === "merchant_name") return { wch: 26 };
    if (field === "items") return { wch: 34 };
    if (field === "receipt_date") return { wch: 14 };
    if (field === "currency") return { wch: 10 };
    return { wch: 16 };
  });
  ws["!rows"] = [{ hpt: 24 }, { hpt: 20 }];
  // Repeat the header row when the sheet runs over several printed pages
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: headerRow, c: 0 },
      e: { r: lastDataRow, c: columns.length - 1 },
    }),
  };
  ws["!freeze"] = { xSplit: 0, ySplit: firstDataRow };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, periodLabel.slice(0, 31));

  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });

  await ensureExportDir();
  const safeOffice = officeName.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const filename = `${safeOffice || "Office"}_Bill_Approval_${periodLabel.replace(" ", "_")}.xlsx`;
  const filepath = `${EXPORT_DIR}${filename}`;

  await FileSystem.writeAsStringAsync(filepath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return filepath;
}
