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
 *   -- Write-only for the app's anon key: it can add and update rows but
 *   -- cannot read the table back, so the key in the bundle leaks nothing.
 *   create policy "app inserts" on receipts
 *     for insert to anon with check (true);
 *   create policy "app upserts" on receipts
 *     for update to anon using (true) with check (true);
 *
 * Read the data with the service key from your own dashboard/BI tool, never
 * from the app.
 */

import { Receipt } from "@/types/receipt";
import { getAppConfig } from "./storage";

const TIMEOUT_MS = 15000;
const SUPABASE_TABLE = "receipts";

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
export function toRemoteRow(receipt: Receipt, officeName: string) {
  return {
    id: receipt.id,
    office_name: officeName,
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

  const response = isSupabaseUrl(cachedUrl)
    ? await postToSupabase(
        cachedUrl,
        cachedKey ?? "",
        rows.map((r) => toRemoteRow(r, cachedOffice)),
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
