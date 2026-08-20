/**
 * Remote Database Sync (optional)
 *
 * Requirements 2.6–2.10: when a remote endpoint is configured, receipts are
 * mirrored to it, and a failure must never cost the local copy. SQLite stays
 * the source of truth — staff scan all month, often with no signal.
 *
 * Two endpoint kinds are supported, detected from the URL:
 *
 *  1. **Supabase** — paste the project URL (https://<ref>.supabase.co) and the
 *     anon key. Rows go to the `receipts` table over PostgREST, upserted on
 *     `id` so re-syncing never duplicates. No `@supabase/supabase-js`: its
 *     realtime/auth/storage bundle buys nothing over one POST with two headers.
 *  2. **Any other https:// endpoint** — receives `{type, receipt}` JSON.
 *
 * A raw `postgresql://` / `mysql://` connection string cannot work: React
 * Native has no TCP socket. Those are rejected with that explanation.
 *
 * ── Supabase setup (once, in the SQL editor) ────────────────────────────────
 *
 *   create table if not exists receipts (
 *     id                text primary key,
 *     office_name       text,
 *     merchant_name     text,
 *     receipt_date      date,
 *     receipt_number    text,
 *     invoice_type      text,
 *     items             jsonb,
 *     subtotal          numeric,
 *     tax               numeric,
 *     total             numeric not null,
 *     currency          text,
 *     payment_method    text,
 *     confidence_score  numeric,
 *     raw_text          text,
 *     error_message     text,
 *     created_at        timestamptz,
 *     synced_at         timestamptz default now()
 *   );
 *
 *   alter table receipts enable row level security;
 *
 *   create policy "app inserts" on receipts
 *     for insert to anon with check (true);
 *   create policy "app upserts" on receipts
 *     for update to anon using (true) with check (true);
 *
 *   -- Shared team view: every device reads the whole office's receipts, which
 *   -- is what makes one phone show another phone's scans. Note the trade-off —
 *   -- the anon key is extractable from the APK, so anyone holding it can read
 *   -- merchant names, amounts and dates. Add Supabase Auth if that matters.
 *   create policy "app reads" on receipts
 *     for select to anon using (true);
 *
 * No delete policy on purpose: a leaked key must not be able to wipe records.
 *
 * ── Receipt photos (Supabase Storage) ──────────────────────────────────────
 *
 * The photo is uploaded alongside the row so a receipt scanned on one phone is
 * viewable on every other phone, and the office keeps the evidence if a device
 * is lost. The bucket is **private**: receipt ids embed a timestamp, so public
 * object URLs would be half guessable. Reads go through the anon key instead,
 * which the app already holds.
 *
 *   insert into storage.buckets (id, name, public)
 *   values ('receipt-images', 'receipt-images', false)
 *   on conflict (id) do nothing;
 *
 *   create policy "app uploads images" on storage.objects
 *     for insert to anon with check (bucket_id = 'receipt-images');
 *   create policy "app replaces images" on storage.objects
 *     for update to anon using (bucket_id = 'receipt-images')
 *     with check (bucket_id = 'receipt-images');
 *   create policy "app reads images" on storage.objects
 *     for select to anon using (bucket_id = 'receipt-images');
 *
 *   alter table receipts add column if not exists image_path text;
 */

import { Receipt } from "@/types/receipt";
import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { getAppConfig } from "./storage";

const TIMEOUT_MS = 15000;
const SUPABASE_TABLE = "receipts";
const IMAGE_BUCKET = "receipt-images";

/**
 * Upload size, not OCR size. The AI already read the receipt at full detail;
 * what is stored is a legible copy for a human checking a bill later. 1600px
 * at 0.7 lands around 200–350 KB, so Supabase's 1 GB free tier holds a few
 * thousand receipts instead of a few hundred full-res camera frames.
 */
const IMAGE_MAX_DIMENSION = 1600;
const IMAGE_QUALITY = 0.7;

let cachedUrl: string | null = null;
let cachedKey: string | null = null;
let cachedOffice = "Office";

/**
 * The endpoint is deployment config, not a user preference: it comes from the
 * build (`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`), so a
 * phone is pointed at the office project by installing the app and nothing
 * else. There is deliberately no field in Settings — staff have no reason to
 * see a database URL, and every extra field is another way to break sync.
 *
 * `database_url` in the config table stays supported as a fallback for builds
 * that ship without the env vars.
 */
function envUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return null;
  return validateDatabaseUrl(url).ok ? url : null;
}

/** Re-read endpoint config (called on app start) */
export async function refreshRemoteConfig(): Promise<void> {
  const config = await getAppConfig();
  cachedUrl = envUrl() ?? config.databaseUrl;
  cachedKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
  cachedOffice = config.officeName;
}

/** True when a Supabase build forgot its key — every sync would 401 */
export function isMisconfigured(): boolean {
  return !!cachedUrl && isSupabaseUrl(cachedUrl) && !cachedKey;
}

export function isRemoteConfigured(): boolean {
  return !!cachedUrl;
}

export function isSupabaseUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

export function validateDatabaseUrl(url: string): { ok: boolean; error?: string } {
  if (!url.trim()) return { ok: true }; // empty disables sync

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }

  if (parsed.protocol === "http:") {
    return { ok: false, error: "Use https:// — plain http is not allowed." };
  }
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      error:
        "Only https:// endpoints work from a phone. A database connection string (postgresql://, mysql://) needs an API in front of it.",
    };
  }
  return { ok: true };
}

/** Supabase needs the anon key alongside the URL; a generic endpoint does not */
export function requiresKey(url: string): boolean {
  return isSupabaseUrl(url);
}

/**
 * Map a receipt onto the remote table's columns. Empty dates become null so
 * Postgres' `date` type accepts them, and the office name rides along so one
 * project can serve several offices.
 */
export function toRemoteRow(
  receipt: Receipt,
  officeName: string,
  imagePath?: string | null,
) {
  return {
    id: receipt.id,
    office_name: officeName,
    image_path: imagePath ?? null,
    merchant_name: receipt.merchant_name,
    receipt_date: receipt.receipt_date || null,
    receipt_number: receipt.receipt_number,
    invoice_type: receipt.invoice_type,
    items: receipt.items,
    subtotal: receipt.subtotal,
    tax: receipt.tax,
    total: receipt.total,
    currency: receipt.currency,
    payment_method: receipt.payment_method,
    confidence_score: receipt.confidence_score,
    raw_text: receipt.raw_text,
    error_message: receipt.error_message,
    created_at: receipt.created_at,
  };
}

function supabaseEndpoint(url: string): string {
  return `${url.replace(/\/+$/, "")}/rest/v1/${SUPABASE_TABLE}`;
}

function storageEndpoint(url: string, path: string): string {
  return `${url.replace(/\/+$/, "")}/storage/v1/object/${IMAGE_BUCKET}/${path}`;
}

/**
 * Headers an image request needs. The bucket is private, so `expo-image` has to
 * present the anon key — see `remoteImageSource`.
 */
export function imageAuthHeaders(): Record<string, string> | undefined {
  // Read the env directly rather than `cachedKey`: a card can render before
  // refreshRemoteConfig() has run, and an unauthenticated GET on a private
  // bucket comes back 400 with no way to retry.
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || cachedKey;
  return key ? { apikey: key, Authorization: `Bearer ${key}` } : undefined;
}

/**
 * Build an `<Image source>` for a receipt photo. A local `file://` path needs
 * nothing; a photo living in the bucket needs the key attached.
 */
export function remoteImageSource(uri: string) {
  if (!uri) return undefined;
  return uri.startsWith("http")
    ? { uri, headers: imageAuthHeaders() }
    : { uri };
}

/** Recover the object path from a URL this app built, so a re-sync keeps it */
export function imagePathFromUri(uri: string): string | null {
  const marker = `/object/${IMAGE_BUCKET}/`;
  const at = uri.indexOf(marker);
  return at === -1 ? null : uri.slice(at + marker.length) || null;
}

/**
 * Put the receipt photo in the bucket and return its object path.
 *
 * Returns null when there is nothing to upload (no image, or no Supabase) and
 * throws when an upload was attempted and failed — the caller decides whether
 * a missing photo should hold up the row.
 */
export async function uploadReceiptImage(
  receipt: Receipt,
): Promise<string | null> {
  if (!receipt.image_uri) return null;
  // Already in the bucket (this row came from another device) — keep its path
  if (!receipt.image_uri.startsWith("file:")) {
    return imagePathFromUri(receipt.image_uri);
  }
  if (!cachedUrl || !isSupabaseUrl(cachedUrl) || !cachedKey) return null;

  const { uri } = await manipulateAsync(
    receipt.image_uri,
    [{ resize: { width: IMAGE_MAX_DIMENSION } }],
    { compress: IMAGE_QUALITY, format: SaveFormat.JPEG },
  );

  const path = `${receipt.id}.jpg`;
  const result = await FileSystem.uploadAsync(
    storageEndpoint(cachedUrl, path),
    uri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        apikey: cachedKey,
        Authorization: `Bearer ${cachedKey}`,
        "Content-Type": "image/jpeg",
        // Re-uploading the same receipt replaces the object instead of 409ing
        "x-upsert": "true",
      },
    },
  );

  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `Image upload failed (${result.status})${result.body ? `: ${result.body.slice(0, 120)}` : ""}`,
    );
  }
  return path;
}

/**
 * Upload photos for a batch, tolerating failures.
 *
 * A photo that will not upload must not strand the receipt itself: the amounts
 * are what the monthly sheet needs, and a resize can fail on a file the user
 * has since deleted from the gallery. The row syncs with no photo and Settings
 * → Re-upload all receipts retries it.
 *
 * ponytail: retry is manual. Add a per-row `image_synced_at` if photos start
 * going missing often enough that someone notices.
 */
async function uploadImages(receipts: Receipt[]): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  for (const receipt of receipts) {
    try {
      const path = await uploadReceiptImage(receipt);
      if (path) paths.set(receipt.id, path);
    } catch (error) {
      console.warn(`Photo for ${receipt.id} not uploaded:`, error);
    }
  }
  return paths;
}

async function request(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Upsert rows into Supabase; `merge-duplicates` makes a re-sync idempotent */
async function postToSupabase(
  url: string,
  key: string,
  rows: object[],
): Promise<Response> {
  return request(supabaseEndpoint(url), rows, {
    apikey: key,
    Authorization: `Bearer ${key}`,
    // return=minimal keeps this write-only, so no SELECT policy is needed
    Prefer: "resolution=merge-duplicates,return=minimal",
  });
}

/**
 * Verify the endpoint answers. Returns false rather than throwing so the
 * settings screen can show a plain connected/unreachable state.
 */
export async function testConnection(
  url: string,
  anonKey?: string | null,
): Promise<boolean> {
  const validation = validateDatabaseUrl(url);
  if (!validation.ok || !url.trim()) return false;

  try {
    if (isSupabaseUrl(url)) {
      if (!anonKey) return false;
      // Empty batch: exercises auth and RLS without writing anything
      const response = await postToSupabase(url, anonKey, []);
      return response.ok;
    }
    const response = await request(url, { type: "ping" }, {});
    return response.ok;
  } catch {
    return false;
  }
}

async function send(rows: Receipt[]): Promise<void> {
  if (!cachedUrl) return;

  // Photos first: the row carries the object path, so it has to exist by then
  const imagePaths = isSupabaseUrl(cachedUrl)
    ? await uploadImages(rows)
    : new Map<string, string>();

  const response = isSupabaseUrl(cachedUrl)
    ? await postToSupabase(
        cachedUrl,
        cachedKey ?? "",
        rows.map((r) => toRemoteRow(r, cachedOffice, imagePaths.get(r.id))),
      )
    : await request(
        cachedUrl,
        rows.length === 1
          ? { type: "receipt", receipt: rows[0] }
          : { type: "receipts", receipts: rows },
        {},
      );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Remote sync failed (${response.status})${detail ? `: ${detail.slice(0, 120)}` : ""}`,
    );
  }
}

/**
 * Pull the office's receipts back down, so a scan taken on one phone shows up
 * on every other phone. Supabase only — a generic endpoint has no agreed read
 * shape.
 *
 * Photos come back as bucket URLs, not local files, so they load over the
 * network on demand rather than being copied onto every phone.
 */
export async function fetchRemoteReceipts(limit: number = 2000): Promise<Receipt[]> {
  if (!cachedUrl || !isSupabaseUrl(cachedUrl) || !cachedKey) return [];

  const query = `select=*&order=created_at.desc&limit=${limit}`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${supabaseEndpoint(cachedUrl)}?${query}`, {
      headers: { apikey: cachedKey, Authorization: `Bearer ${cachedKey}` },
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Could not read the database (${response.status})${detail ? `: ${detail.slice(0, 120)}` : ""}`,
    );
  }

  const rows = (await response.json()) as any[];
  return rows.map(fromRemoteRow);
}

/** Remote row -> Receipt. Tolerates nulls; the table is not the app's schema. */
export function fromRemoteRow(row: any): Receipt {
  return {
    id: String(row.id),
    merchant_name: row.merchant_name ?? null,
    receipt_date: row.receipt_date ?? null,
    receipt_number: row.receipt_number ?? null,
    invoice_type: row.invoice_type ?? "unknown",
    items: Array.isArray(row.items) ? row.items : [],
    subtotal: row.subtotal === null || row.subtotal === undefined ? null : Number(row.subtotal),
    tax: row.tax === null || row.tax === undefined ? null : Number(row.tax),
    total: Number(row.total) || 0,
    currency: row.currency ?? "BDT",
    payment_method: row.payment_method ?? null,
    confidence_score: Number(row.confidence_score) || 0,
    // Photos live in the bucket, so another device's scan is viewable here.
    // A row with no path (older scan, or an upload that failed) has no photo.
    image_uri:
      row.image_path && cachedUrl
        ? storageEndpoint(cachedUrl, String(row.image_path))
        : "",
    raw_text: row.raw_text ?? null,
    error_message: row.error_message ?? null,
    created_at: row.created_at ?? new Date().toISOString(),
  };
}

/**
 * Mirror one receipt. Callers must treat a rejection as non-fatal — the local
 * row is the record.
 */
export async function syncReceipt(receipt: Receipt): Promise<void> {
  await send([receipt]);
}

/**
 * Mirror many receipts. Supabase takes the whole batch in one request; a
 * generic endpoint is sent one at a time so a single bad row cannot lose the
 * rest.
 *
 * Returns the ids the endpoint actually accepted, so the caller marks only
 * those as synced and the rest are retried on the next launch.
 */
export async function batchSyncReceipts(
  receipts: Receipt[],
): Promise<{ syncedIds: string[]; failed: number }> {
  if (!cachedUrl || receipts.length === 0) return { syncedIds: [], failed: 0 };

  if (isSupabaseUrl(cachedUrl)) {
    try {
      await send(receipts);
      return { syncedIds: receipts.map((r) => r.id), failed: 0 };
    } catch {
      return { syncedIds: [], failed: receipts.length };
    }
  }

  const syncedIds: string[] = [];
  let failed = 0;
  for (const receipt of receipts) {
    try {
      await syncReceipt(receipt);
      syncedIds.push(receipt.id);
    } catch {
      failed++;
    }
  }
  return { syncedIds, failed };
}
