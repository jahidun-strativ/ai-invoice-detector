/**
 * Checks the Supabase wire format: endpoint path, auth headers, upsert
 * preference, and row mapping. These are the parts that fail silently or with
 * an opaque 401/404 if they drift.
 */

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async () => ({ uri: 'file:///resized.jpg' })),
}));

jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 1 },
  uploadAsync: jest.fn(async () => ({ status: 200, body: '' })),
}));

import {
  batchSyncReceipts,
  fetchRemoteReceipts,
  fromRemoteRow,
  imagePathFromUri,
  isMisconfigured,
  isRemoteConfigured,
  isSupabaseUrl,
  refreshRemoteConfig,
  remoteImageSource,
  requiresKey,
  syncReceipt,
  testConnection,
  toRemoteRow,
  validateDatabaseUrl,
} from '../remote-db';
import {
  createReceipt,
  getReceipts,
  getUnsyncedReceipts,
  importRemoteReceipts,
  markReceiptsSynced,
  resetSyncState,
  setDatabaseUrl,
  setOfficeName,
  updateReceipt,
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

describe('reading the team\'s receipts', () => {
  beforeEach(configureSupabase);

  it('maps a remote row into a receipt with no local image', () => {
    const mapped = fromRemoteRow({
      id: 'remote-1',
      merchant_name: 'Unimart',
      receipt_date: '2026-08-12',
      invoice_type: 'retail',
      items: [{ name: 'Tea', quantity: 2, price: 40 }],
      total: '80.00',
      tax: null,
      currency: 'BDT',
      created_at: '2026-08-12T09:00:00.000Z',
    });

    expect(mapped.total).toBe(80);
    expect(typeof mapped.total).toBe('number');
    expect(mapped.items).toHaveLength(1);
    expect(mapped.image_uri).toBe('');
    expect(mapped.tax).toBeNull();
  });

  it('survives a sparse row rather than throwing', () => {
    const mapped = fromRemoteRow({ id: 'x', total: null });
    expect(mapped.invoice_type).toBe('unknown');
    expect(mapped.items).toEqual([]);
    expect(mapped.total).toBe(0);
  });

  it('fetches with the read query and auth headers', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    await fetchRemoteReceipts();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/rest/v1/receipts?select=*');
    expect(init.headers.apikey).toBe(KEY);
  });

  it('explains a blocked read instead of returning nothing', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'permission denied',
    });
    await expect(fetchRemoteReceipts()).rejects.toThrow(/401/);
  });

  it('imports a teammate\'s receipt but never overwrites one scanned here', async () => {
    const mine = await createReceipt({
      merchant_name: 'Scanned Here',
      receipt_date: '2026-08-18',
      receipt_number: null,
      invoice_type: 'retail',
      items: [],
      subtotal: null,
      tax: null,
      total: 70,
      currency: 'BDT',
      payment_method: null,
      confidence_score: 0.9,
      image_uri: 'file:///local-photo.jpg',
      raw_text: null,
      error_message: null,
    });

    const imported = await importRemoteReceipts([
      fromRemoteRow({
        id: 'teammate-1',
        merchant_name: 'Their Shop',
        receipt_date: '2026-08-18',
        invoice_type: 'retail',
        items: [],
        total: 55,
        currency: 'BDT',
        created_at: '2026-08-18T08:00:00.000Z',
      }),
      // Same id as the local one, with the remote's empty image and a wrong total
      fromRemoteRow({ id: mine.id, total: 999, currency: 'BDT' }),
    ]);

    expect(imported).toBe(1);

    const all = await getReceipts();
    const teammate = all.find((r) => r.id === 'teammate-1');
    const local = all.find((r) => r.id === mine.id);

    expect(teammate?.merchant_name).toBe('Their Shop');
    expect(local?.total).toBe(70); // untouched
    expect(local?.image_uri).toBe('file:///local-photo.jpg');
  });

  it('counts imported rows as already synced', async () => {
    await importRemoteReceipts([
      fromRemoteRow({ id: 'teammate-2', total: 10, currency: 'BDT' }),
    ]);
    expect((await getUnsyncedReceipts()).map((r) => r.id)).not.toContain('teammate-2');
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

  it('re-queues a receipt that was edited after it synced', async () => {
    const saved = await createReceipt({
      merchant_name: 'Meena Bazar',
      receipt_date: '2026-08-17',
      receipt_number: null,
      invoice_type: 'retail',
      items: [],
      subtotal: null,
      tax: null,
      total: 90,
      currency: 'BDT',
      payment_method: null,
      confidence_score: 0.7,
      image_uri: 'file:///b.jpg',
      raw_text: null,
      error_message: null,
    });
    await markReceiptsSynced([saved.id]);
    expect((await getUnsyncedReceipts()).map((r) => r.id)).not.toContain(saved.id);

    // The AI read the total wrong and someone corrected it
    await updateReceipt(saved.id, { total: 95 });

    expect((await getUnsyncedReceipts()).map((r) => r.id)).toContain(saved.id);
  });

  it('queues everything again after a re-upload, without deleting anything', async () => {
    const before = (await getUnsyncedReceipts()).length;
    const total = await resetSyncState();

    expect(total).toBeGreaterThan(before);
    expect((await getUnsyncedReceipts()).length).toBe(total);
  });
});

describe('receipt photos in storage', () => {
  const uploadAsync = require('expo-file-system/legacy').uploadAsync as jest.Mock;
  const manipulateAsync = require('expo-image-manipulator').manipulateAsync as jest.Mock;

  beforeEach(() => {
    uploadAsync.mockReset();
    uploadAsync.mockResolvedValue({ status: 200, body: '' });
    manipulateAsync.mockReset();
    manipulateAsync.mockResolvedValue({ uri: 'file:///resized.jpg' });
  });

  it('uploads the photo to the private bucket and records its path', async () => {
    await configureSupabase();
    await syncReceipt(receipt());

    const [url, fileUri, options] = uploadAsync.mock.calls[0];
    expect(url).toBe(`${PROJECT}/storage/v1/object/receipt-images/r1.jpg`);
    // The resized copy, not the multi-megabyte camera frame
    expect(fileUri).toBe('file:///resized.jpg');
    expect(options.headers.apikey).toBe(KEY);
    expect(options.headers['x-upsert']).toBe('true');

    const row = JSON.parse(fetchMock.mock.calls[0][1].body)[0];
    expect(row.image_path).toBe('r1.jpg');
  });

  it('shrinks the photo before upload so the free tier is not burned', async () => {
    await configureSupabase();
    await syncReceipt(receipt());

    const [, actions, options] = manipulateAsync.mock.calls[0];
    expect(actions[0].resize.width).toBeLessThanOrEqual(1600);
    expect(options.compress).toBeLessThan(1);
  });

  it('still syncs the receipt when the photo will not upload', async () => {
    await configureSupabase();
    uploadAsync.mockResolvedValue({ status: 413, body: 'too large' });

    const result = await batchSyncReceipts([receipt()]);

    expect(result.syncedIds).toEqual(['r1']);
    const row = JSON.parse(fetchMock.mock.calls[0][1].body)[0];
    expect(row.image_path).toBeNull();
  });

  it('re-uploads nothing for a receipt pulled from another device', async () => {
    await configureSupabase();
    const remote = receipt({
      image_uri: `${PROJECT}/storage/v1/object/receipt-images/r1.jpg`,
    });

    await syncReceipt(remote);

    expect(uploadAsync).not.toHaveBeenCalled();
    // The path must survive the upsert, or editing on this phone would blank
    // the photo for everyone
    const row = JSON.parse(fetchMock.mock.calls[0][1].body)[0];
    expect(row.image_path).toBe('r1.jpg');
  });

  it('turns a stored path back into a viewable url', async () => {
    await configureSupabase();
    const mapped = fromRemoteRow({ id: 'r9', total: 10, image_path: 'r9.jpg' });
    expect(mapped.image_uri).toBe(
      `${PROJECT}/storage/v1/object/receipt-images/r9.jpg`,
    );
    expect(imagePathFromUri(mapped.image_uri)).toBe('r9.jpg');
  });

  it('attaches the key only to bucket urls, never to a local file', async () => {
    await configureSupabase();

    // A private bucket rejects an unauthenticated GET, so expo-image needs the key
    const remote = remoteImageSource(
      `${PROJECT}/storage/v1/object/receipt-images/r1.jpg`,
    );
    expect(remote?.headers?.apikey).toBe(KEY);

    expect(remoteImageSource('file:///img.jpg')).toEqual({ uri: 'file:///img.jpg' });
    expect(remoteImageSource('')).toBeUndefined();
  });

  it('keeps a local scan even when its photo never reached the bucket', async () => {
    await configureSupabase();
    // Scanned here, upload failed, so image_uri is a file path with no remote twin
    const created = await createReceipt({ ...receipt(), image_uri: 'file:///mine.jpg' } as any);

    const changed = await importRemoteReceipts([
      { ...receipt({ merchant_name: 'Overwritten' }), id: created.id },
    ]);

    expect(changed).toBe(0);
    const stored = await getReceipts();
    expect(stored.find((r) => r.id === created.id)?.merchant_name).toBe('Shwapno');
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
