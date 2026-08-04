# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI Receipt Scanner — an Expo SDK 54 / React Native app that photographs receipts, extracts structured data with Groq Vision (Llama 4 Scout), stores it in local SQLite, and exports JSON/CSV. Uses pnpm. No test suite exists.

Detailed app documentation lives in `APP_DOC.md`; Expo-specific agent guidance (doc links, EAS workflows) in `AGENTS.md`.

## Commands

```bash
pnpm start                    # Expo dev server (use --clear to reset cache)
npx expo lint                 # ESLint
npx expo doctor               # Dependency/project health check
npx expo install <pkg>        # Install packages with Expo-compatible versions
```

EAS: `npm run development-builds` / `npm run draft` / `npm run deploy` run workflows in `.eas/workflows/`; `npm run build:preview[:android|:ios]` builds directly. Build profiles are in `eas.json` (channels: development, main for preview, production). Requires a development build (`expo-dev-client`) — Expo Go won't run this app.

Environment: `EXPO_PUBLIC_GROQ_API_KEY` must be set (`.env` locally, EAS secrets for builds). Read in `services/groq-vision.ts`.

## Architecture

Core data flow: **capture → validate → Groq Vision → normalize → SQLite → export**.

- `app/` — Expo Router file-based routes. Tabs: `(tabs)/index.tsx` (dashboard), `(tabs)/capture.tsx` (scan + AI processing flow), `(tabs)/history.tsx` (list/filter). Detail: `receipt/[id].tsx`.
- `services/groq-vision.ts` — the AI layer. Calls Groq's OpenAI-compatible chat completions endpoint with a base64 image and a strict JSON-mode prompt (tuned for Bengali/Bangla handwriting; all numerals normalized to English). Key functions: `validateImage` (Groq limits: 4MB base64, 33MP), `processImageForUpload`, `parseReceiptWithRetry`. Normalizes every response: invalid `invoice_type` → `'unknown'`, dates → ISO `YYYY-MM-DD`, `confidence_score` → 0..1, missing fields → null; parse failures return a safe error object rather than throwing.
- `services/storage.ts` — SQLite (`expo-sqlite`) schema + CRUD + stats. `items` stored as JSON text. Includes stale-connection retry logic (`resetConnection`) for `NativeDatabase.execAsync` NPEs on Android.
- `services/export.ts` — JSON/CSV (Google-Sheets-friendly) export + share via `expo-sharing`.
- `types/receipt.ts` — single source of truth for `Receipt`, `LineItem`, `GroqReceiptResponse`, filters, stats. Groq's response also carries `detected_fields` used by the edit modal (`components/receipt/receipt-edit-modal.tsx`).
- `hooks/use-ota-updates.ts` + `components/update-status.tsx` — OTA update checks via `expo-updates` (on app start + manual).

Conventions: kebab-case file names, function components with hooks, TypeScript throughout, themed UI via `themed-text`/`themed-view` + `use-theme-color`. `components/ui/icon-symbol.tsx` maps SF Symbol names to MaterialIcons — new icons need a mapping there or they're missing on Android.
