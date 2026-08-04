# AI Receipt Scanner — App Documentation

## 1) Overview

AI Receipt Scanner is an Expo/React Native app that captures receipt/invoice images and extracts structured financial data using **Google Gemini 2.5 Flash via OpenRouter**. Extracted data is normalized, stored locally in SQLite, and can be exported as JSON or Google-Sheets-friendly CSV.

**Primary users**: accounting/finance teams who want to reduce manual receipt entry. Extraction is tuned for English and Bengali/Bangla receipts, including handwritten ones.

For setup and quickstart see [README.md](README.md). For operational tasks (releases, key rotation, model swaps) see [MAINTENANCE.md](MAINTENANCE.md).

---

## 2) Core Data Flow

```
capture (camera/gallery)
  → validateImage            (exists, ≤20MB, ≤33MP)
  → processImageForUpload    (resize/compress to ≤4MB base64, 3-tier cascade)
  → OpenRouter chat completions (Gemini 2.5 Flash, JSON mode, temp 0)
  → normalizeResponse        (types, dates, Bangla digits, confidence)
  → ReceiptsProvider.addReceipt → SQLite
  → export (JSON/CSV, share sheet)
```

---

## 3) Module Reference

### 3.1 Routing (`app/`)

- `app/(tabs)/index.tsx` — Dashboard: stats cards, category breakdown, quick actions, recent receipts. Skeletons on first load; error banner on load failure.
- `app/(tabs)/capture.tsx` — Capture + AI processing state machine (`idle → processing → success | error`). Success state resets when the tab loses focus.
- `app/(tabs)/history.tsx` — Receipt list with type filter chips and debounced (300ms) merchant search. Background refreshes keep the last list rendered (no full-screen spinner).
- `app/(tabs)/settings.tsx` — OTA update status/check (hosts `UpdateStatus`), app version/channel, AI model info.
- `app/receipt/[id].tsx` — Detail: image viewer, JSON schema preview modal, edit, delete, export.
- `app/_layout.tsx` — Root: `GestureHandlerRootView → SafeAreaProvider → ThemeProvider → ReceiptsProvider → Stack`. Also triggers OTA check on start.

### 3.2 State (`contexts/receipts-context.tsx`)

`ReceiptsProvider` is the single source of truth. It initializes the database once, then owns:

- **State**: `receipts` (current filtered list), `recent` (last 5), `stats`, `filter { type, searchQuery }`, `status` (`initializing | loading | ready | error`), `error`
- **Actions**:
  - `refresh()` — reloads list + recent + stats, always honoring the active filter/search
  - `setFilter(partial)` — updates filter and refreshes
  - `addReceipt(input)` / `updateReceiptById(id, input)` / `removeReceipt(id)` — write to SQLite, then refresh in the background so every screen stays in sync

Screens never call `initDatabase` or fetch lists directly; they consume `useReceipts()`. `status === 'initializing'` drives first-load skeletons.

### 3.3 AI Vision (`services/ai-vision.ts`)

Public API (only two exports):

```ts
validateImage(imageUri): Promise<{ valid: boolean; error?: string }>
parseReceiptWithRetry(imageUri, maxRetries = 3): Promise<AIReceiptResponse>
```

Internals worth knowing:

- **Endpoint**: `https://openrouter.ai/api/v1/chat/completions`, model `google/gemini-2.5-flash` (single `MODEL_ID` constant), JSON mode, temperature 0, base64 `image_url` data URI.
- **Auth**: `EXPO_PUBLIC_OPENROUTER_API_KEY` env var. Requests carry `HTTP-Referer` / `X-Title` attribution headers.
- **Prompt**: extensive multilingual prompt with a Bangla alphabet reference, handwriting-recognition guidance, and Bangla→English numeral conversion rules. Retry attempts 2+ use a harder "second pass" handwriting prompt.
- **Retry**: image is processed once and reused across attempts; exponential backoff (2s, 4s); the best-scoring result is kept if no attempt passes the acceptance gate (`total` present and calibrated confidence ≥ 0.45). **401/402 responses abort immediately** (bad key / no credits — retrying can't help).
- **Normalization**: invalid `invoice_type` → `unknown`; dates → ISO `YYYY-MM-DD` (handles DMY, 2-digit years, Bangla digits); confidence clamped to 0..1 and recalibrated against field completeness and math consistency; missing values → `null`. Parse failures return a safe error object — the function never throws.
- **Image constraints**: ≤4MB base64 (auto-compressed via `expo-image-manipulator`, 3-tier cascade), ≤33MP, ≤20MB file.

### 3.4 Storage (`services/storage.ts`)

SQLite (`expo-sqlite`), table `receipts`; `items` stored as JSON text; indexes on `created_at`, `invoice_type`, `merchant_name`. Full CRUD plus `getReceiptStats()` and `searchReceipts(query)`. Includes stale-connection retry/re-init logic for the Android `NativeDatabase.execAsync` NPE.

### 3.5 Export (`services/export.ts`)

JSON and CSV (per-receipt and bulk, plus a flat items CSV), written via `expo-file-system/legacy` and shared with `expo-sharing`.

### 3.6 Types (`types/receipt.ts`)

`Receipt`, `ReceiptInput`, `LineItem`, `AIReceiptResponse` (the normalized API result — `total` nullable here, non-null in `Receipt`), `ReceiptFilter`, `ReceiptStats`, `ProcessingState`.

---

## 4) Theming

`constants/theme.ts` defines the design tokens — every color in the app comes from here, in light/dark pairs:

| Token group | Tokens |
|---|---|
| Base | `text`, `background`, `tint`, `icon`, `textSecondary` |
| Surfaces | `surface`, `surfaceSecondary`, `card`, `border`, `overlay`, `skeleton` |
| Status | `success`, `danger`, `warning`, `info` |
| Accents | `accentOrange`, `accentPurple`, `neutral` |
| Layout | `Spacing` (4–24), `Radius` (8/12/16/pill) |

Supporting modules:

- `constants/receipt-ui.ts` — invoice-type icons/labels/colors (single source; `getInvoiceTypeColor(type, colors)` resolves per-scheme)
- `utils/format.ts` — `formatCurrency`, `formatDate`
- `components/ui/icon-symbol.tsx` — SF Symbols on iOS, MaterialIcons elsewhere. `name` is strictly typed (`IconSymbolName`); a new icon must be added to `MAPPING` or the build fails — this is what keeps Android from rendering "?" icons.
- `components/ui/skeleton.tsx` — `Skeleton` + `ReceiptCardSkeleton` pulse placeholders (reanimated)

Rule of thumb: **no hardcoded hex colors in screens or components** — add a token instead.

---

## 5) Screens & UX details

- Safe areas come from `useSafeAreaInsets()` (provider mounted at root) — no hardcoded top padding.
- Haptics: shutter (`impactAsync Medium`), scan success/failure (`notificationAsync`), filter chips (`selectionAsync`), delete confirm (`Warning`).
- `expo-image` used everywhere with `transition`, and blurhash `placeholder` in list cards.
- Edit modal (`components/receipt/receipt-edit-modal.tsx`): `KeyboardAvoidingView` on iOS; date is a text field validated as `YYYY-MM-DD` on save; totals recompute via a pure `withTotals` helper inside functional state updates.

---

## 6) Environment & Secrets

- **Local dev**: `EXPO_PUBLIC_OPENROUTER_API_KEY` in `.env` / `.env.local` (see `.env.example`). Both files are gitignored.
- **EAS builds**: set the same variable as an EAS project env var — see [MAINTENANCE.md](MAINTENANCE.md).
- Note: `EXPO_PUBLIC_*` vars are embedded in the client bundle. Anyone with the binary can extract the key — use a spend-capped OpenRouter key.

---

## 7) Troubleshooting

- **"OpenRouter API key not found"** — `.env` missing or dev server started before the var was added; restart with `pnpm start --clear`.
- **402 error on scan** — OpenRouter credits exhausted; top up or swap the key.
- **SQLite `NativeDatabase.execAsync` NPE** — stale DB handle; storage layer retries automatically. If persistent: restart the app, clear the dev client cache.
- **App won't run in Expo Go** — expected; build a dev client (`npm run development-builds`).
- **Icon renders as "?" on Android** — the SF Symbol name is missing from `MAPPING` in `components/ui/icon-symbol.tsx` (the strict type should have caught this at compile time).
