# Changelog — AI Receipt Scanner

Release date: 19 August 2026

## New Features

- Receipts now build a monthly **Bill Approval Sheet** in Excel, with the office
  name as the heading, one row per receipt, the month's totals, and a signature
  block for Prepared By, Checked By, Reviewed By and Approved By
- The team can pick any past month from the new Export tab and produce that
  month's sheet in one step, ready to print and sign
- Scans now appear on every team member's phone, so one sheet covers the whole
  office instead of one sheet per person
- Scanning a receipt no longer requires signing in to Google — staff can scan
  all month with no account and no network
- The home screen shows the current month's receipt count and total at a glance
- The office name is now set once in Settings and appears on every exported
  sheet, and the columns on the sheet can be chosen and reordered
- The Scan button now sits in the centre of the navigation bar as a raised
  button, making it the obvious primary action

## Fixes

- Bangla merchant names now appear correctly in exported files, instead of the
  garbled text the previous CSV export produced
- The approval date now has a bordered box to write in, rather than a label
  pressed against the edge of the page
- The summary line "Amount Received from Account" is no longer cut short
- The four signature blocks are now spaced evenly across the page instead of one
  stretching across half of it
- Exported sheets stay white when opened on a phone in dark mode
- Corrections made to a receipt after scanning now reach the shared records,
  where previously the original values were kept
- Receipts whose date could not be read are now included in their month's sheet
  instead of being left out of every month
- A receipt scanned without a signal is now sent automatically the next time the
  app opens, so nothing is missed when working offline

## Technical

- Added a Supabase `receipts` table with row-level security policies allowing the
  app to add and read records but never delete them
- Two-way sync between each device and the shared database, keyed on receipt ID
  so re-sending never creates duplicates
- Replaced the CSV export with XLSX (`xlsx-js-style`), which carries UTF-8 inside
  the file and supports cell formatting
- Added a `synced_at` column to track which receipts have reached the database
- Per-environment build configuration for development, preview and production
- Excluded the web platform from builds, so the update bundle no longer fails on
  a WebAssembly dependency it never needed
- Test suite added and now runs: 89 tests covering the sheet layout, sync
  behaviour and configuration storage
