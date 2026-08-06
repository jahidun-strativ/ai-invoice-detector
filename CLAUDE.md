# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI Receipt Scanner — an Expo SDK 54 / React Native app that photographs receipts, extracts structured data with Google Gemini 2.5 Flash via OpenRouter, stores it in local SQLite, and exports JSON/CSV. Tuned for English + Bengali/Bangla receipts including handwriting. Uses pnpm. No test suite exists.

Detailed architecture lives in `APP_DOC.md`; operational tasks (releases, OTA, key rotation) in `MAINTENANCE.md`; Expo-specific agent guidance (doc links, EAS workflows) in `AGENTS.md`.

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
- `services/export.ts` — JSON/CSV export + share.
- `types/receipt.ts` — `Receipt`, `ReceiptInput`, `AIReceiptResponse` (API result; `total` nullable there, non-null in `Receipt`), filters, stats.
- `app/` — Expo Router tabs: dashboard (`index`), `capture` (state machine; success resets on tab blur), `history` (debounced search + filter chips), `settings` (OTA updates via `components/update-status.tsx`, app info). Detail: `receipt/[id].tsx`.

## Conventions

- **Branding (Strativ)**: the theme follows the official Strativ design system. Hard rules: accent is Strativ Orange `#FE5001` (one accent — no purple/indigo); **no gradients anywhere** (solid fills only); "black" is Warm Black `#1A0E1C`, never `#000`; dark mode uses the neutral dark scale (`#0B0E13` family), not warm-black; no emoji in product UI; the Strativ logo (assets in `assets/brand/`) must stay visible (dashboard header lockup). Category colors come from the Strativ data-viz palette in `constants/receipt-ui.ts` — never brand orange.
- **Theming**: all colors come from tokens in `constants/theme.ts` (light/dark pairs: surface, card, border, success/danger/warning/info, etc.). Never hardcode hex colors in screens — add a token. Currency/date formatting in `utils/format.ts`.
- **Typography**: two fonts only — Expletus Sans for headings (`Type.display`/`Type.displayBold`), Inter for everything else (loaded in the root layout). Use the `Type` families from `constants/theme.ts` instead of `fontWeight` — Android doesn't synthesize weights for custom fonts.
- **Icons**: `components/ui/icon-symbol.tsx` maps SF Symbol names to MaterialIcons with a strict `IconSymbolName` type — new icons must be added to `MAPPING` or tsc fails (this prevents "?" icons on Android).
- **Safe areas**: use `useSafeAreaInsets()` (provider in root layout), never hardcoded top padding.
- Kebab-case file names, function components with hooks, TypeScript throughout.
