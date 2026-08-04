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
