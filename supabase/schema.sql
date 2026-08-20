-- AI Receipt Scanner — Supabase schema
--
-- Run once in the Supabase SQL Editor, or:
--   psql "postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres" -f supabase/schema.sql
--
-- Safe to re-run: the table is created only if missing and each policy is
-- dropped before being recreated (Postgres has no CREATE POLICY IF NOT EXISTS).

create table if not exists receipts (
  id                text primary key,
  office_name       text,
  merchant_name     text,
  receipt_date      date,
  receipt_number    text,
  invoice_type      text,
  items             jsonb,
  subtotal          numeric,
  tax               numeric,
  total             numeric not null,
  currency          text,
  payment_method    text,
  confidence_score  numeric,
  raw_text          text,
  error_message     text,
  created_at        timestamptz,
  synced_at         timestamptz default now()
);

-- Object path of the receipt photo in the receipt-images bucket (see below).
-- Null means no photo reached storage — the row is still valid.
alter table receipts add column if not exists image_path text;

-- Newest-first listing is the app's only read pattern
create index if not exists receipts_created_at_idx
  on receipts (created_at desc);

alter table receipts enable row level security;

-- The app authenticates with the anon key only. It may add receipts and
-- correct them, and read the office's receipts so one phone shows another
-- phone's scans.
drop policy if exists "app inserts" on receipts;
create policy "app inserts" on receipts
  for insert to anon with check (true);

drop policy if exists "app upserts" on receipts;
create policy "app upserts" on receipts
  for update to anon using (true) with check (true);

-- Trade-off to be aware of: the anon key is extractable from the APK, so
-- anyone holding it can read merchant names, amounts and dates. Acceptable for
-- internal expense data; add Supabase Auth if that changes.
drop policy if exists "app reads" on receipts;
create policy "app reads" on receipts
  for select to anon using (true);

-- No delete policy on purpose: a leaked key must never be able to wipe
-- records. Delete from the dashboard or with the service key.


-- ── Receipt photos ─────────────────────────────────────────────────────────
--
-- Private bucket: receipt ids embed a timestamp, so a public object URL would
-- be half guessable. The app reads photos with the anon key instead.
insert into storage.buckets (id, name, public, file_size_limit)
values ('receipt-images', 'receipt-images', false, 5242880)
on conflict (id) do nothing;

drop policy if exists "app uploads images" on storage.objects;
create policy "app uploads images" on storage.objects
  for insert to anon with check (bucket_id = 'receipt-images');

-- Needed for x-upsert: re-uploading a receipt replaces its object
drop policy if exists "app replaces images" on storage.objects;
create policy "app replaces images" on storage.objects
  for update to anon
  using (bucket_id = 'receipt-images')
  with check (bucket_id = 'receipt-images');

drop policy if exists "app reads images" on storage.objects;
create policy "app reads images" on storage.objects
  for select to anon using (bucket_id = 'receipt-images');

-- Again no delete policy: photos are the evidence behind an approved bill.
