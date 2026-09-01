# Maintenance Guide

Operational reference for keeping AI Receipt Scanner running: builds, releases, OTA updates, secrets, model changes, and upgrades. For architecture see [docs/developer-guide.html](docs/developer-guide.html) and [docs/system-documentation.html](docs/system-documentation.html).

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

- Verify afterwards with `npx eas-cli channel:view main` — the newest group should be on top, with its runtime and commit.
- To pick an update up on a phone: force-close the app and reopen it twice. expo-updates downloads on one launch and applies on the next.

**Check the fingerprint before every push.** `runtimeVersion` is
`{"policy":"fingerprint"}`, so an update only reaches installs whose native
fingerprint is identical to the tree you publish from. A mismatch does **not**
error — the update publishes, reaches nobody, and reports success:

```bash
npx expo-updates fingerprint:generate --platform android   # this tree
npx eas-cli build:list --limit 5                           # what is installed
```

If nothing installed carries that hash, a new native build is needed first
(added or removed a native module or config plugin, or changed native config in
`app.json`). Pure JS/TS changes always keep the fingerprint and always ship OTA.

Each runtime version is served independently, which is what lets several
generations coexist. Channel `main` currently carries both:

| Runtime | Reaches |
|---|---|
| `1.0.0` | The old SDK 54 APKs, built under the `appVersion` policy |
| `c900fbf7…` | SDK 57 builds, fingerprint policy |

Publishing to one cannot touch the other. Before the policy switch both claimed
`1.0.0`, and an SDK 57 bundle delivered to an SDK 54 phone would have crashed it
on launch — see §8 of the system documentation.

**`/ota [channel]`** (in `.claude/commands/`) runs all of the above as one
gated step: commit check, typecheck/lint/tests, fingerprint match, who-it-reaches,
publish, verify.

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
- **Optional remote database**, configured by the build (never in the UI). Two kinds,
  detected from the URL:
  - **Supabase** (`https://<ref>.supabase.co`) — rows are upserted on `id` into the
    `receipts` table over PostgREST, so re-syncing never duplicates. Run
    `supabase/schema.sql` once in the SQL editor; it is re-runnable and also creates the
    photo bucket. No `@supabase/supabase-js` dependency: it bundles realtime/auth/storage
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
- **Photos sync too**, into the private `receipt-images` bucket (resized to 1600px/0.7, so
  ~250 KB a receipt rather than a 2–4 MB camera frame). The object path lives in
  `receipts.image_path`; a pulled receipt renders it straight from the bucket. The bucket is
  private, so reads carry the anon key — `remoteImageSource()` attaches it, and every
  `<Image>` must go through that helper. A photo that fails to upload never blocks its
  receipt: the row syncs with `image_path` null, and Re-upload all receipts retries it.
  A blank thumbnail therefore means "no photo in the bucket", not "another device's scan".
- **After truncating the table**: Settings → DATA → **Re-upload all receipts** clears
  `synced_at` on every row and pushes them again (batches of 500, up to 10k). Safe to run
  any time — the upsert is keyed on receipt id, so re-running against a full table is a
  no-op.
- **The anon key ships in the app** like any client credential, and is extractable from the
  APK. It grants insert, update and select — select is what makes the shared team view work,
  so anyone holding the key can read merchant names, dates and amounts. That is the accepted
  trade-off for internal expense data; add Supabase Auth if it stops being acceptable. What
  the key can **never** do is delete: no delete policy exists on the table or the bucket, so
  a leaked key cannot destroy records. Never paste the service key into the app.

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

Any OpenRouter model slug works **if it supports vision/image input** and JSON mode. Also update `AI_MODEL_LABEL` in `app/(tabs)/settings.tsx` and the model mentions in README and `docs/developer-guide.html`. Test with printed English, printed Bangla, and handwritten Bangla receipts before shipping.

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

1. `npx tsc --noEmit`, `npx expo lint` and `pnpm test` clean
2. Manual pass in a dev client, light **and** dark mode: scan (printed EN / printed BN / handwritten BN) → save → dashboard updates → history filter/search → detail → edit (incl. totals typing) → export Excel + JSON → delete
3. Export tab: month list correct, generated sheet opens in Excel/Sheets with Bangla intact
4. Settings tab: office name, version/channel correct, update check works
5. Wrong-API-key path shows a clean error (no retry storm)
6. Update `RELEASE_NOTES.docx` (see §8)
7. Decide OTA vs native build (see §1), then `npm run draft` / `npm run deploy`

## 8) Release Notes

**One living document: `RELEASE_NOTES.docx` at the repo root**, generated from
`RELEASE_NOTES.html` beside it. Add each release as a new block **at the top**;
never start a new file per release, and never rename either file. The date heading
is the only version marker that matters to readers.

### Block structure (copy the previous block and overwrite it)

```
19 August 2026                                    <- H2, Strativ Orange #FE5001
App version 1.0.0 · Android · Update channel: main <- 9.5pt, #4C434E
  New Features      <- H3, Warm Black #1A0E1C
  Fixes
  Technical
```

Omit a section that has no entries — never leave a heading with "None" under it.

### Gathering the data — do this every time, do not recall it

| Field | Where it comes from |
|---|---|
| Release date | `date "+%d %B %Y"` — never assume today's date |
| Scope | `git log --oneline <last-release-date-tag-or-hash>..HEAD` |
| App version | `version` in `app.json` |
| Channel | the `channel` of the profile being shipped, in `eas.json` |
| Test count | the total line from `pnpm test` |

Two traps that have already bitten:

- **Uncommitted work is invisible to `git log`.** Check `git status` first; if the
  release is still in the working tree, the log will describe the *previous* state.
- **A feature added and removed inside the same release is not news.** Collapse it
  to the outcome a reader cares about, or drop it entirely.

### Wording

Follow the `strativ-plugins:strativ-changelog` skill — it is the authority. In short:
one entry per user-visible change (not per commit), active voice, benefit first, no
commit hashes, no branch names, no jargon in New Features or Fixes. Anything only a
developer would notice belongs in Technical.

The **Post-Deploy Steps** section that skill describes is for Magento 2 and
WordPress only. This is an Expo app, so deploy steps go in the release *message*
(`eas update -m "…"`) and in §1, not in the document.

### Editing the document

`RELEASE_NOTES.docx` is **generated**, not hand-edited — its source is
`RELEASE_NOTES.html` at the repo root. Add the new block to the HTML (which
diffs in git, unlike the .docx) and regenerate. There is no `python-docx` or
`pandoc` on the build machine; macOS `textutil` does the job:

```bash
textutil -convert docx -output RELEASE_NOTES.docx RELEASE_NOTES.html
```

Editing the .docx by hand instead is allowed but one-way: the HTML then no
longer matches, and the next regeneration silently reverts your edit. If you
open it in Word, mirror the change back into the HTML.

**Then fix the colours.** Cocoa converts sRGB to generic RGB on import, so
`#FE5001` lands as `FA3808` and warm black as `140C15` — both off-brand:

```bash
unzip -q RELEASE_NOTES.docx -d /tmp/docx && \
  sed -i '' 's/FA3808/FE5001/g; s/140C15/1A0E1C/g; s/3B333D/4C434E/g' \
    /tmp/docx/word/document.xml && \
  (cd /tmp/docx && zip -q -r -X ../fixed.docx .) && mv /tmp/fixed.docx RELEASE_NOTES.docx
```

Verify with `unzip -p RELEASE_NOTES.docx word/document.xml | grep -o 'w:val="FE5001"'`.

## 9) Documentation

| Document | Format | Update when |
|---|---|---|
| `docs/developer-guide.html` → `.pdf` | Generated | The codebase structure, a service's contract, a convention, or the test setup changes |
| `docs/system-documentation.html` → `.pdf` | Generated | The data model, sync behaviour, security posture, environments, or an operational limit changes |
| `MAINTENANCE.md` | Markdown (this file) | A procedure changes. This file is the authority for *how*; the PDFs describe *what and why* |
| `CLAUDE.md` | Markdown | A hard rule changes. Loaded automatically by agents, so a stale line here misleads every future session |
| `RELEASE_NOTES.docx` | Generated | Every release — see §8 |

Regenerate both PDFs after editing either HTML file:

```bash
./docs/build-pdf.sh
```

Chrome headless is the renderer (no pandoc or wkhtmltopdf on the machine), and it is
the same engine the pages were styled against — open the HTML in a browser to preview.
Shared styling is in `docs/doc.css`; keep the brand rules (single orange accent, warm
black, no gradients).

**Commit the PDFs.** They are build output, but the whole point is that someone can be
handed a document without a toolchain. A stale committed PDF is worse than none, so
regenerating is part of the same commit as the HTML edit.

**The trap that has already bitten:** `APP_DOC.md` drifted for months — it still described
CSV export, a purple accent and a Settings screen that no longer existed, because nothing
ever forced a reader to notice. If a change makes a sentence in these documents false,
fix the sentence in the same commit. There is no separate documentation pass.
