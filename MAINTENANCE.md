# Maintenance Guide

Operational reference for keeping AI Receipt Scanner running: builds, releases, OTA updates, secrets, model changes, and upgrades. For architecture see [APP_DOC.md](APP_DOC.md).

---

## 1) Builds & Release Channels

Build profiles live in `eas.json`:

| Profile | Channel | Purpose |
|---|---|---|
| `development` | `development` | Dev client with `expo-dev-client`, internal distribution |
| `development-simulator` | `development-simulator` | Dev client for iOS simulator |
| `preview` | `main` | Internal preview builds |
| `production` | `production` | Store builds, auto-incremented version |

EAS Workflows (`.eas/workflows/`) automate the common paths:

```bash
npm run development-builds   # build Android + iOS device + iOS simulator dev clients
npm run draft                # on any branch push: publish preview update + deploy website
npm run deploy               # main branch: fingerprint, reuse or rebuild, submit to stores
```

Direct builds without workflows:

```bash
npm run build:preview            # both platforms, preview profile
npm run build:preview:android    # or per platform
eas build --platform android --profile production
```

**When is a new native build required?** After adding/removing a native module or config plugin, or changing `app.json` native config. Pure JS/TS changes can ship over the air instead.

## 2) OTA Updates (expo-updates)

- The app checks for updates 3s after launch (`hooks/use-ota-updates.ts`, wired in `app/_layout.tsx`). Users can also check manually from the **Settings** tab.
- OTA is disabled in dev builds (`Updates.isEnabled && !__DEV__`).
- Publish an update to a channel:

```bash
eas update --channel production --message "fix: ..."
eas update --channel main --message "preview: ..."    # preview builds
```

- An OTA update only reaches builds with a **matching runtime version/fingerprint**. If `eas update` warns about fingerprint mismatch, a new native build is needed first.

## 3) API Key (OpenRouter)

The key is read from `EXPO_PUBLIC_OPENROUTER_API_KEY` in `services/ai-vision.ts` (single read site).

- **Local**: put it in `.env` (see `.env.example`); restart the dev server after changes.
- **EAS builds**: set a project env var so it's embedded at build time:

```bash
eas env:create --name EXPO_PUBLIC_OPENROUTER_API_KEY --scope project
eas env:list
```

- **Rotation**: create the new key at [openrouter.ai/keys](https://openrouter.ai/keys), update `.env` + the EAS env var, delete the old key, then rebuild (the key is baked into the binary — an OTA update also works since env vars are inlined into the JS bundle at publish time).
- **Important**: `EXPO_PUBLIC_*` values ship inside the client bundle and are extractable. Always use a **spend-capped** key.
- Remove any legacy `EXPO_PUBLIC_GROQ_API_KEY` secrets from EAS — no longer used.

## 3b) Monthly Export (replaces the old Google Sheet upload)

The Google Sheets integration is **gone** — writing to an org sheet needed OAuth the app
never had. `services/sheet.ts` and `EXPO_PUBLIC_SHEET_WEBHOOK_URL` are deleted; remove
that env var from EAS if it was ever created:

```bash
eas env:delete --name EXPO_PUBLIC_SHEET_WEBHOOK_URL
```

The workflow is now local-first and monthly:

1. Staff scan receipts through the month — everything lands in SQLite, no network needed.
2. **Export** tab lists each month with a receipt count and total.
3. Export asks for the four signatories and the cash drawn from the account, then writes
   an XLSX "Bill Approval Sheet" to `documentDirectory/exports/` and opens the share sheet.

- Office name (the sheet's heading) and the sheet's columns are set in **Settings**; both
  live in the SQLite `config` / `export_columns` tables, not in env vars.
- Sheet layout, styling and the summary maths are in `services/xlsx-export.ts`, covered by
  `services/__tests__/xlsx-export.test.ts` (generates a workbook and reads it back).
- Styling requires **`xlsx-js-style`**, not `xlsx` — the community SheetJS build silently
  drops cell styles on write, which would lose every border and bold heading.
- **Optional remote database**: Settings → Advanced. Two kinds, detected from the URL:
  - **Supabase** (`https://<ref>.supabase.co`) — rows are upserted on `id` into the
    `receipts` table over PostgREST, so re-syncing never duplicates. The table DDL and the
    write-only RLS policies are in the header of `services/remote-db.ts` — run them once in
    the SQL editor. No `@supabase/supabase-js` dependency: it bundles realtime/auth/storage
    for what is one POST with two headers.
  - Any other `https://` endpoint — receives `{type:'receipt', receipt}` POSTs. Only
    reachable via the `database_url` config row (no UI); the env var is the supported path.
  - Raw `postgresql://` / `mysql://` strings are rejected: a phone has no TCP socket, so
    those need an API in front.
- **The endpoint is build config, not a setting.** There is no database field in Settings —
  staff have no reason to see a URL, and every field is another way to break sync. Set:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>

eas env:create --name EXPO_PUBLIC_SUPABASE_URL --scope project
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --scope project
```

  Changing the project = change the env var and ship a build or OTA update; every phone
  follows. **Nothing about the database appears in the app UI at all** — no URL, no status,
  no sync button. If a Supabase URL ships without its anon key, sync is skipped with a
  console warning rather than 401-ing on every scan.
- **Offline scans handle themselves.** `receipts.synced_at` is null until the endpoint
  accepts the row, so a scan taken with no signal is retried automatically on the next app
  start (`syncPendingReceipts()`, capped at 500 per launch). Only ids the endpoint actually
  accepted are marked, so a partial batch failure simply retries.
- **Diagnosing "rows aren't arriving"**: there is no in-app indicator by design. Check the
  device log for `receipt(s) still waiting to reach the database`, or query the table with
  the service key and compare counts against the app's month totals.
- **Sync is two-way, and every device sees the whole office.** Each phone pushes its own
  scans and pulls everyone else's on app start and whenever the Export tab is opened, so
  the monthly sheet covers the team instead of one device. Requires the `select` policy
  from the DDL — without it the pull returns 401 and each phone shows only its own scans.
- **The pull never deletes.** An empty read is indistinguishable from a blocked or failed
  one, so clearing local rows to match the table would wipe good data, including scans not
  yet uploaded. Import only adds or refreshes.
- **Photos stay on the device that took them.** Imported receipts have an empty `image_uri`
  and show a blank thumbnail; only the phone that scanned a receipt has its picture.
- **After truncating the table**: Settings → DATA → **Re-upload all receipts** clears
  `synced_at` on every row and pushes them again (batches of 500, up to 10k). Safe to run
  any time — the upsert is keyed on receipt id, so re-running against a full table is a
  no-op.
- **The anon key ships in the app** like any client credential. It is safe *only* because
  the RLS policies grant insert/update and no select — it cannot read the table back. Never
  paste the service key into the app.

## 3c) App Icon

SVG sources live in `assets/brand/` — the PNGs in `assets/images/` are generated, never
hand-edited:

| Source | Generated | Used by |
| --- | --- | --- |
| `app-icon.svg` | `icon.png` (1024), `favicon.png` (48) | iOS / web |
| `app-icon-foreground.svg` | `android-icon-foreground.png` (1024) | Android adaptive foreground (transparent; background is `adaptiveIcon.backgroundColor`) |
| `app-icon-mono.svg` | `android-icon-monochrome.png` (1024) | Android 13+ themed icon (alpha silhouette) |
| `symbol-orange.svg` | `splash-icon.png` (512×684) | Splash |

```bash
npx -y sharp-cli --input assets/brand/app-icon.svg --output assets/images/icon.png resize 1024 1024
```

- macOS `qlmanage` also renders SVG but **flattens transparency onto white** — it can only
  produce `icon.png`/`favicon.png`, never the foreground/mono/splash layers.
- The foreground mark is scaled to `0.86` so it survives any launcher mask (Android's safe
  zone is the middle 66%). Keep that scale if you redraw it.
- Icons are baked into the native binary — changing them needs a rebuild, not an OTA update.

## 4) Swapping the AI Model

One constant in `services/ai-vision.ts`:

```ts
const MODEL_ID = "google/gemini-2.5-flash";
```

Any OpenRouter model slug works **if it supports vision/image input** and JSON mode. Also update `AI_MODEL_LABEL` in `app/(tabs)/settings.tsx` and the model mentions in README/APP_DOC. Test with printed English, printed Bangla, and handwritten Bangla receipts before shipping.

### API error behavior

| Status | Meaning | App behavior |
|---|---|---|
| 401 | Bad/missing key | Fails immediately, no retries |
| 402 | OpenRouter credits exhausted | Fails immediately, no retries |
| 429 | Rate limited | Retried with exponential backoff (2s, 4s) |
| other | Transient/provider error | Retried up to 3 attempts, best result kept |

## 5) Database Schema Changes

The schema is created in `initDatabase()` (`services/storage.ts`) with `CREATE TABLE IF NOT EXISTS` — it does **not** migrate existing installs. To add/change columns:

1. Add an `ALTER TABLE ... ADD COLUMN` guarded by a check (e.g. `PRAGMA table_info(receipts)`) inside `initDatabase`, after the create.
2. Update `types/receipt.ts`, the row-mapping helpers, and `createReceipt`/`updateReceipt` column lists in `storage.ts`.
3. Remember existing users keep their data — never drop/recreate the table outside of dev.

## 6) Dependency Upgrades

```bash
npx expo install --check   # report packages incompatible with the SDK
npx expo install --fix     # bump them to compatible versions
npx expo doctor            # overall project health
```

For Expo SDK major upgrades, follow the official upgrade guide, then rebuild dev clients (`npm run development-builds`) — native modules change between SDKs.

## 7) Pre-release Checklist

1. `npx tsc --noEmit` and `npx expo lint` clean
2. Manual pass in a dev client, light **and** dark mode: scan (printed EN / printed BN / handwritten BN) → save → dashboard updates → history filter/search → detail → edit (incl. totals typing) → export JSON/CSV → delete
3. Settings tab: version/channel correct, update check works
4. Wrong-API-key path shows a clean error (no retry storm)
5. Decide OTA vs native build (see §1), then `npm run draft` / `npm run deploy`
