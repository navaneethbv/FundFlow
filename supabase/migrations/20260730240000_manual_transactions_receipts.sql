-- Phase 12: manual transaction records and a receipts inbox.
--
-- `account_id` becomes nullable so a manual entry can point at a manual
-- account instead; `transactions_select_household` already joins through
-- `accounts`, so a null `account_id` simply never matches it — a manual
-- transaction is never household-shared, the same rule manual_accounts and
-- Phase 9A's manual holdings already follow. RLS stays correct with no policy
-- change since `transactions_select_own` keys on `user_id` alone.

alter table public.transactions
  alter column account_id drop not null,
  add column if not exists manual_account_id uuid references public.manual_accounts (id) on delete cascade,
  add column if not exists source text not null default 'plaid'
    check (source in ('plaid', 'import', 'manual')),
  add constraint transactions_one_account_check
    check ((account_id is null) <> (manual_account_id is null));

-- Backfill: the existing `import-` prefix convention already identifies
-- pre-Plaid backfilled rows (see lib/import.ts); label them so `source`
-- reflects reality for rows written before this column existed.
update public.transactions
set source = 'import'
where plaid_transaction_id like 'import-%';

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------

create table if not exists public.receipts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  transaction_id  uuid references public.transactions (id) on delete set null,
  storage_path    text not null,
  merchant        text,
  purchase_date   date,
  total           numeric(14, 2),
  status          text not null default 'unmatched'
    check (status in ('unmatched', 'matched', 'ignored')),
  created_at      timestamptz not null default now()
);

create index if not exists receipts_user_status_idx on public.receipts (user_id, status, created_at desc);

alter table public.receipts enable row level security;

revoke all on table public.receipts from anon;
grant select, insert, update, delete on table public.receipts to authenticated;

create policy "receipts_all_own" on public.receipts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- First use of Supabase Storage in the app: private bucket, user-prefixed
-- paths. The CSP's `img-src 'self' data: https:` already permits short-lived
-- signed URLs from the existing Supabase host, so no CSP change is needed.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "receipt_objects_all_own" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Verification (expect 0 rows):
--   -- every transaction names exactly one account
--   select count(*) from public.transactions
--    where (account_id is null) = (manual_account_id is null);
--
--   -- no manual transaction crosses users through its manual account
--   select count(*) from public.transactions t
--     join public.manual_accounts ma on ma.id = t.manual_account_id
--    where t.user_id <> ma.user_id;
--
-- Rollback:
--   drop policy if exists "receipt_objects_all_own" on storage.objects;
--   delete from storage.buckets where id = 'receipts';
--   drop table if exists public.receipts;
--   alter table public.transactions
--     drop constraint if exists transactions_one_account_check,
--     drop column if exists source,
--     drop column if exists manual_account_id;
--   -- account_id is NOT restored to `not null` automatically: any manual row
--   -- inserted while this migration was live would violate that constraint.
