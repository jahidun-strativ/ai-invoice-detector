/**
 * Checks the Supabase wire format: endpoint path, auth headers, upsert
 * preference, and row mapping. These are the parts that fail silently or with
 * an opaque 401/404 if they drift.
 */

import {
  batchSyncReceipts,
  isMisconfigured,
  isRemoteConfigured,
  isSupabaseUrl,
  refreshRemoteConfig,
  requiresKey,
  syncReceipt,
  testConnection,
  toRemoteRow,
  validateDatabaseUrl,
} from '../remote-db';
import {
  createReceipt,
  getUnsyncedReceipts,
  markReceiptsSynced,
  resetSyncState,
  setDatabaseUrl,
  setOfficeName,
} from '../storage';
import { Receipt } from '@/types/receipt';

const PROJECT = 'https://abcdefgh.supabase.co';
const KEY = 'anon-key-123';

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'r1',
    merchant_name: 'Shwapno',
    receipt_date: '2026-08-15',
    receipt_number: 'R-001',
    invoice_type: 'retail',
    items: [{ name: 'Rice', quantity: 1, price: 115 }],
    subtotal: 100,
    tax: 15,
    total: 115,
    currency: 'BDT',
    payment_method: 'cash',
    confidence_score: 0.9,
    image_uri: 'file:///img.jpg',
    raw_text: null,
    error_message: null,
    created_at: '2026-08-15T10:00:00.000Z',
    ...overrides,
  };
}

const fetchMock = jest.fn();
global.fetch = fetchMock as any;

function ok(status = 201) {
  return { ok: status < 400, status, text: async () => '' };
}

/** The endpoint is build config, so tests configure it the way a build does */
async function configureSupabase() {
  await setOfficeName('Strativ Dhaka');
  process.env.EXPO_PUBLIC_SUPABASE_URL = PROJECT;
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = KEY;
  await refreshRemoteConfig();
}

beforeEach(async () => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok());
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  await setDatabaseUrl(null);
});

describe('url handling', () => {
  it('recognises a Supabase project URL', () => {
    expect(isSupabaseUrl(PROJECT)).toBe(true);
    expect(isSupabaseUrl('https://api.example.com/receipts')).toBe(false);
  });

  it('demands a key only for Supabase', () => {
    expect(requiresKey(PROJECT)).toBe(true);
    expect(requiresKey('https://api.example.com/receipts')).toBe(false);
  });

  it('rejects a connection string a phone cannot speak', () => {
    const result = validateDatabaseUrl('postgresql://user:pw@host:5432/db');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/API in front/);
  });

  it('rejects plain http', () => {
    expect(validateDatabaseUrl('http://api.example.com').ok).toBe(false);
  });

  it('treats empty as "sync disabled", not invalid', () => {
    expect(validateDatabaseUrl('').ok).toBe(true);
  });
});

describe('toRemoteRow', () => {
  it('carries the office name so one project can serve several offices', () => {
    expect(toRemoteRow(receipt(), 'Strativ Dhaka').office_name).toBe('Strativ Dhaka');
  });

  it('nulls an unreadable date so Postgres date accepts it', () => {
    expect(toRemoteRow(receipt({ receipt_date: '' }), 'X').receipt_date).toBeNull();
  });

  it('does not ship the local image path', () => {
    expect(toRemoteRow(receipt(), 'X')).not.toHaveProperty('image_uri');
  });
});

describe('syncReceipt against Supabase', () => {
  beforeEach(configureSupabase);

  it('posts to the table endpoint with auth headers and upsert preference', async () => {
    await syncReceipt(receipt());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PROJECT}/rest/v1/receipts`);
    expect(init.method).toBe('POST');
    expect(init.headers.apikey).toBe(KEY);
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.headers.Prefer).toContain('resolution=merge-duplicates');
    expect(init.headers.Prefer).toContain('return=minimal');
  });

  it('sends an array of mapped rows', async () => {
    await syncReceipt(receipt());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe('r1');
    expect(body[0].total).toBe(115);
  });

  it('surfaces the status when the row is rejected', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'no policy',
    });
    await expect(syncReceipt(receipt())).rejects.toThrow(/401/);
  });

  it('batches a month into a single request', async () => {
    const result = await batchSyncReceipts([receipt(), receipt({ id: 'r2' })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ syncedIds: ['r1', 'r2'], failed: 0 });
  });

  it('claims no ids when the batch is rejected, so all of them retry', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    expect(await batchSyncReceipts([receipt(), receipt({ id: 'r2' })])).toEqual({
      syncedIds: [],
      failed: 2,
    });
  });

  it('reports only the ids a generic endpoint accepted', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = '';
    await setDatabaseUrl('https://api.example.com/receipts');
    await refreshRemoteConfig();

    fetchMock
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => '' })
      .mockResolvedValueOnce(ok());

    const result = await batchSyncReceipts([
      receipt(),
      receipt({ id: 'r2' }),
      receipt({ id: 'r3' }),
    ]);
    expect(result).toEqual({ syncedIds: ['r1', 'r3'], failed: 1 });
  });

  it('tests the connection without writing a row', async () => {
    expect(await testConnection(PROJECT, KEY)).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual([]);
  });

  it('fails the connection test when the key is missing', async () => {
    expect(await testConnection(PROJECT)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sync is off unless configured', () => {
  it('does nothing when no endpoint is set', async () => {
    await setDatabaseUrl(null);
    await refreshRemoteConfig();

    await syncReceipt(receipt());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('endpoint comes from the build', () => {
  const ENV_URL = 'https://seeded.supabase.co';

  it('points the app at EXPO_PUBLIC_SUPABASE_URL with no user setup', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = ENV_URL;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'env-key';
    await refreshRemoteConfig();

    await syncReceipt(receipt());
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENV_URL}/rest/v1/receipts`);
    expect(fetchMock.mock.calls[0][1].headers.apikey).toBe('env-key');
  });

  it('ignores a malformed env URL rather than syncing to nowhere', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'not-a-url';
    await refreshRemoteConfig();
    expect(isRemoteConfigured()).toBe(false);

    await syncReceipt(receipt());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the stored URL when the build ships without env vars', async () => {
    await setDatabaseUrl('https://api.example.com/receipts');
    await refreshRemoteConfig();

    await syncReceipt(receipt());
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/receipts');
  });

  it('flags a Supabase build that forgot the anon key', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = ENV_URL;
    await refreshRemoteConfig();
    expect(isMisconfigured()).toBe(true);
  });
});

describe('unsynced receipts are retried, not lost', () => {
  it('leaves a failed receipt pending and syncs it on the next run', async () => {
    await configureSupabase();

    const saved = await createReceipt({
      merchant_name: 'Agora',
      receipt_date: '2026-08-16',
      receipt_number: null,
      invoice_type: 'retail',
      items: [],
      subtotal: null,
      tax: null,
      total: 60,
      currency: 'BDT',
      payment_method: null,
      confidence_score: 0.8,
      image_uri: 'file:///a.jpg',
      raw_text: null,
      error_message: null,
    });

    // Scanned with no signal: nothing marked it synced
    const pending = await getUnsyncedReceipts();
    expect(pending.map((r) => r.id)).toContain(saved.id);

    const { syncedIds } = await batchSyncReceipts(pending);
    await markReceiptsSynced(syncedIds);

    const stillPending = await getUnsyncedReceipts();
    expect(stillPending.map((r) => r.id)).not.toContain(saved.id);
  });

  it('queues everything again after a re-upload, without deleting anything', async () => {
    const before = (await getUnsyncedReceipts()).length;
    const total = await resetSyncState();

    expect(total).toBeGreaterThan(before);
    expect((await getUnsyncedReceipts()).length).toBe(total);
  });
});

describe('generic https endpoint', () => {
  it('keeps the {type, receipt} envelope', async () => {
    await setDatabaseUrl('https://api.example.com/receipts');
    await refreshRemoteConfig();

    await syncReceipt(receipt());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.type).toBe('receipt');
    expect(body.receipt.id).toBe('r1');
  });
});
