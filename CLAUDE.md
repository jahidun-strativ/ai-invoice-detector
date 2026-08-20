# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI Receipt Scanner — an Expo SDK 54 / React Native app that photographs receipts, extracts structured data with Google Gemini 2.5 Flash via OpenRouter, stores it in local SQLite, and exports a monthly XLSX "Bill Approval Sheet" (plus ad-hoc JSON). Tuned for English + Bengali/Bangla receipts including handwriting. Uses pnpm. Tests: `pnpm test` (jest-expo; `expo-sqlite` is mocked onto `node:sqlite` so storage tests run real SQL).

The office workflow is monthly and local-first: staff scan receipts all month with no network dependency, then export one signed-off sheet per month. There is deliberately **no Google Sheets integration** — writing to an org sheet needs OAuth the app never had; see `.kiro/specs/monthly-receipt-export/`.

Detailed architecture lives in `docs/developer-guide.html` (codebase) and `docs/system-documentation.html` (data model, sync, security, operations) — both rendered to PDF by `docs/build-pdf.sh`; operational tasks (releases, OTA, key rotation) in `MAINTENANCE.md`; Expo-specific agent guidance (doc links, EAS workflows) in `AGENTS.md`.

## Commands

```bash
pnpm start                    # Expo dev server (use --clear to reset cache)
npx expo lint                 # ESLint
npx tsc --noEmit              # Typecheck
npx expo install <pkg>        # Install packages with Expo-compatible versions
```

EAS: `npm run development-builds` / `npm run draft` / `npm run deploy` run workflows in `.eas/workflows/`; `npm run build:preview[:android|:ios]` builds directly. Profiles in `eas.json` (channels: development, main for preview, production). Requires a development build (`expo-dev-client`) — Expo Go won't run this app.

Environment: `EXPO_PUBLIC_OPENROUTER_API_KEY` must be set (`.env` locally — see `.env.example`; EAS env var for builds). Read in `services/ai-vision.ts`.

## Architecture

Core data flow: **capture → validate → on-device quality gate → OpenRouter (Gemini 2.5 Flash) → normalize → SQLite via context → export**.

- `utils/image-quality.ts` — pre-flight heuristic (no AI, no native modules): rejects blurry/dark/non-receipt photos on a 160px thumbnail (Laplacian sharpness, brightness, bright-pixel and edge-density ratios) before any API call. Thresholds are hand-tuned constants at the top; capture offers "Process Anyway" as override.

- `contexts/receipts-context.tsx` — **single source of truth**. `ReceiptsProvider` (mounted in root layout) owns DB init, the receipt list, recent receipts, stats, and filter/search state. All mutations (`addReceipt`, `updateReceiptById`, `removeReceipt`) go through it; screens consume `useReceipts()` and never call `initDatabase` or fetch lists directly. `status === 'initializing'` drives first-load skeletons.
- `services/ai-vision.ts` — the AI layer. Exports only `validateImage` and `parseReceiptWithRetry`. OpenRouter chat completions (model in the single `MODEL_ID` constant), JSON mode, base64 image, prompt tuned for Bangla handwriting with numeral conversion. Retry with backoff and best-result tracking; 401/402 abort immediately. Normalizes everything (dates → ISO, invalid types → `'unknown'`, confidence recalibrated); returns a safe error object instead of throwing.
- `services/storage.ts` — SQLite CRUD + stats; `items` stored as JSON text; includes stale-connection retry for Android `execAsync` NPEs. Schema uses `CREATE TABLE IF NOT EXISTS` — column changes need guarded `ALTER TABLE` (see MAINTENANCE.md).
- `services/export.ts` — raw JSON export + `shareFile`. **CSV was removed on purpose**: spreadsheets guess the code page when opening a CSV, so Bangla merchant names arrived as mojibake (`à¦«à§à¦¨à§`), and the flat `=== RECEIPT SUMMARY ===` layout was unreadable for the people approving bills. Don't reintroduce it — XLSX carries UTF-8 inside the file.
- `services/xlsx-export.ts` — the only document format in the app. `exportReceiptsAsSheet()` produces the same sheet for one receipt (detail screen) or a filtered list (History), so there is one layout to read everywhere. The monthly Bill Approval Sheet: merged office-name heading, dynamic columns from config, numeric money cells (`#,##0.00`, so Excel can total them), summary block (total / received / excess-less), four signature blocks. Must use **`xlsx-js-style`**, never plain `xlsx` — the community SheetJS build silently discards cell styles on write.
- `services/config.ts` — office name, export columns, optional remote endpoint; validation over the SQLite `config` / `export_columns` tables in `storage.ts`.
- `services/remote-db.ts` — optional remote mirror of each receipt, fire-and-forget: a sync failure must never surface as a failed scan. The endpoint is **build config** (`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`) and the database is deliberately invisible in the UI — no field, no status, no sync button. Offline scans are caught up automatically on app start via `syncPendingReceipts()`, driven by the `receipts.synced_at` column (null = still pending); only ids the endpoint accepted get marked. Supabase goes over PostgREST (upsert on `id`; table DDL + write-only RLS policies are in the file header) with plain `fetch` — do **not** add `@supabase/supabase-js` for this. Raw `postgresql://`/`mysql://` URLs are rejected (no TCP socket on a phone). Sync is **two-way**: each device pushes its own scans and pulls the whole office's, so one phone shows another phone's receipts and the monthly sheet covers the team rather than one device. Ownership rule in `importRemoteReceipts()`: a row this device scanned (a `file://` `image_uri`) is never overwritten by the pull; rows that arrived from the database are refreshed. Do not go back to "empty `image_uri` means imported" — a scan whose photo failed to upload would then be treated as someone else's and clobbered. Photos go to the **private** `receipt-images` bucket (Supabase Storage over plain REST, `FileSystem.uploadAsync`, object path `<receipt id>.jpg` in the `receipts.image_path` column), resized to 1600px/0.7 first — full camera frames would fill the 1 GB free tier in a few hundred receipts. The bucket is private because receipt ids embed a timestamp, so a public URL would be half guessable; reads therefore need the anon key attached, which is what `remoteImageSource()` is for — use it at every `<Image>` site instead of `{{ uri: receipt.image_uri }}`. A photo that will not upload never blocks its receipt: the row syncs with `image_path` null and Settings → Re-upload all receipts retries it. **Never delete local rows to match the remote**: an empty read is indistinguishable from a blocked or failed one, so "the table looks empty, clear the phone" would destroy data — including scans not yet uploaded. The pull only ever adds or refreshes. Agreement after a truncate is restored by `reuploadAllReceipts()` (Settings → DATA), which clears `synced_at` and pushes again.
- `contexts/export-context.tsx` — export screen state only (periods, selected month, generating, share). Deliberately separate from `receipts-context`.
- `types/receipt.ts` — `Receipt`, `ReceiptInput`, `AIReceiptResponse` (API result; `total` nullable there, non-null in `Receipt`), filters, stats.
- `app/` — Expo Router tabs: dashboard (`index`, with the current-month card), `capture` (state machine; success resets on tab blur), `history` (debounced search + filter chips), `export` (month cards → `components/receipt/export-config-modal.tsx`), `settings` (office name, sheet columns, data actions, OTA updates via `components/update-status.tsx`). Detail: `receipt/[id].tsx`.

## Conventions

- **Branding (Strativ)**: the theme follows the official Strativ design system. Hard rules: accent is Strativ Orange `#FE5001` (one accent — no purple/indigo); **no gradients anywhere** (solid fills only); "black" is Warm Black `#1A0E1C`, never `#000`; dark mode uses the neutral dark scale (`#0B0E13` family), not warm-black; no emoji in product UI; the Strativ logo (assets in `assets/brand/`) must stay visible (dashboard header lockup). Category colors come from the Strativ data-viz palette in `constants/receipt-ui.ts` — never brand orange.
- **Theming**: all colors come from tokens in `constants/theme.ts` (light/dark pairs: surface, card, border, success/danger/warning/info, etc.). Never hardcode hex colors in screens — add a token. Currency/date formatting in `utils/format.ts`.
- **Typography**: two fonts only — Expletus Sans for headings (`Type.display`/`Type.displayBold`), Inter for everything else (loaded in the root layout). Use the `Type` families from `constants/theme.ts` instead of `fontWeight` — Android doesn't synthesize weights for custom fonts.
- **Icons**: `components/ui/icon-symbol.tsx` maps SF Symbol names to MaterialIcons with a strict `IconSymbolName` type — new icons must be added to `MAPPING` or tsc fails (this prevents "?" icons on Android).
- **Safe areas**: use `useSafeAreaInsets()` (provider in root layout), never hardcoded top padding.
- Kebab-case file names, function components with hooks, TypeScript throughout.
- **Release notes**: one living document, `RELEASE_NOTES.docx`, newest release block at the top — never a new file per release. Edit `RELEASE_NOTES.html` (the source, which diffs in git) and regenerate the .docx from it with `textutil`, never hand-edit the .docx. Write it with the `strativ-plugins:strativ-changelog` skill (one entry per user-visible change, not per commit; no hashes; plain English in New Features/Fixes, jargon only under Technical). Always read the date from `date` and the scope from `git log`, never from memory, and check `git status` first — uncommitted work is invisible to the log. Full procedure and the `textutil` colour-space fix: MAINTENANCE.md §8.
