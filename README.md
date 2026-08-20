# AI Receipt Scanner

A mobile app that photographs receipts and automatically extracts structured financial data using AI vision (Google Gemini 2.5 Flash via [OpenRouter](https://openrouter.ai)). Optimized for English and Bengali/Bangla receipts, including handwriting.

## Features

- **Capture Receipts**: Take photos using the camera or import from gallery
- **AI-Powered Extraction**: Extracts merchant name, date, line items, totals, and more — with multilingual (English + Bangla) and handwriting support
- **Invoice Type Detection**: Classifies receipts as retail, restaurant, utility, service, or unknown
- **Local Storage**: All receipts stored on-device in SQLite (no cloud)
- **Manual Editing**: Review and correct extracted fields before relying on them
- **Export Options**: JSON or CSV (Google Sheets compatible)
- **Dashboard**: Statistics and recent receipts at a glance
- **Search & Filter**: Find receipts by merchant name or filter by type
- **OTA Updates**: Ship JS updates without a store release (Settings tab)

## Quickstart

### Prerequisites

- Node.js 18+ and pnpm
- An OpenRouter API key ([openrouter.ai/keys](https://openrouter.ai/keys))
- iOS Simulator, Android Emulator, or a physical device with a **development build** installed — the app uses native modules (camera, SQLite), so **Expo Go will not work**

### Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create a `.env` file (see `.env.example`):

```env
EXPO_PUBLIC_OPENROUTER_API_KEY=sk-or-...
```

3. Start the dev server:

```bash
pnpm start
```

4. If you don't have a development build yet:

```bash
npm run development-builds
```

## Scripts

| Script | What it does |
|---|---|
| `pnpm start` | Start the Expo dev server |
| `npx expo lint` | ESLint |
| `npx tsc --noEmit` | Typecheck |
| `npm run development-builds` | EAS workflow: build dev clients |
| `npm run build:preview` | EAS preview build (both platforms) |
| `npm run draft` | EAS workflow: publish preview update |
| `npm run deploy` | EAS workflow: deploy to production |

## Documentation

- [docs/developer-guide.html](docs/developer-guide.html) — architecture, data flow, module reference, conventions, testing (PDF: `docs/developer-guide.pdf`)
- [docs/system-documentation.html](docs/system-documentation.html) — data model, sync, security, environments, operations (PDF: `docs/system-documentation.pdf`)
- [MAINTENANCE.md](MAINTENANCE.md) — releases, OTA updates, key rotation, model swaps, upgrades
- [CLAUDE.md](CLAUDE.md) — guidance for AI coding assistants

## Sample Output

```json
{
  "merchant_name": "ABC Store",
  "receipt_date": "2025-01-12",
  "receipt_number": "R-93821",
  "invoice_type": "retail",
  "items": [{ "name": "Milk", "quantity": 1, "price": 50 }],
  "subtotal": 50,
  "tax": 5,
  "total": 55,
  "currency": "BDT",
  "payment_method": "Cash",
  "confidence_score": 0.92
}
```

## Technologies

Expo SDK 54 / React Native · Expo Router · expo-sqlite · OpenRouter (Gemini 2.5 Flash) · expo-camera / expo-image-picker · expo-updates (OTA)

## License

0BSD
