/**
 * Google Sheet Upload
 * Appends a confirmed receipt as one row to a Google Sheet via an Apps Script
 * Web App — no OAuth, no Google SDK, just a POST.
 *
 * One-time setup:
 *  1. In the Sheet: Extensions > Apps Script, paste and save:
 *
 *       function doPost(e) {
 *         const { headers, row } = JSON.parse(e.postData.contents);
 *         const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
 *         if (sheet.getLastRow() === 0) sheet.appendRow(headers);
 *         // Column A is the receipt id: append new ones, overwrite re-sends
 *         // so a receipt edited after upload updates its row instead of
 *         // adding a duplicate.
 *         const at = sheet.getRange('A:A').getValues().flat().indexOf(row[0]);
 *         if (at === -1) sheet.appendRow(row);
 *         else sheet.getRange(at + 1, 1, 1, row.length).setValues([row]);
 *         return ContentService.createTextOutput('ok');
 *       }
 *
 *  2. Deploy > New deployment > Web app — "Execute as: Me",
 *     "Who has access: Anyone". Copy the /exec URL.
 *  3. Add it to .env (and the EAS env vars for builds):
 *       EXPO_PUBLIC_SHEET_WEBHOOK_URL=https://script.google.com/.../exec
 */

import { Receipt } from '@/types/receipt';

// Same columns as the flat CSV export, so the sheet matches an exported file
const HEADERS = [
  'ID',
  'Merchant Name',
  'Receipt Date',
  'Receipt Number',
  'Invoice Type',
  'Items (JSON)',
  'Item Count',
  'Subtotal',
  'Tax',
  'Total',
  'Currency',
  'Payment Method',
  'Confidence Score',
  'Created At',
];

export function isSheetConfigured(): boolean {
  return !!process.env.EXPO_PUBLIC_SHEET_WEBHOOK_URL;
}

export async function uploadReceiptToSheet(receipt: Receipt): Promise<void> {
  const url = process.env.EXPO_PUBLIC_SHEET_WEBHOOK_URL;
  if (!url) {
    throw new Error(
      'No sheet configured. Set EXPO_PUBLIC_SHEET_WEBHOOK_URL to your Apps Script Web App URL.'
    );
  }

  const row = [
    receipt.id,
    receipt.merchant_name,
    receipt.receipt_date,
    receipt.receipt_number,
    receipt.invoice_type,
    JSON.stringify(receipt.items),
    receipt.items.length,
    receipt.subtotal,
    receipt.tax,
    receipt.total,
    receipt.currency,
    receipt.payment_method,
    receipt.confidence_score,
    receipt.created_at,
  ];

  // RN's fetch has no default timeout — a dead network would hang the button
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      // text/plain keeps Apps Script from rejecting the request; doPost reads
      // e.postData.contents either way
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ headers: HEADERS, row }),
      signal: abort.signal,
    });

    if (!response.ok) {
      throw new Error(`Sheet upload failed (${response.status})`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Sheet upload timed out. Check your connection.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
