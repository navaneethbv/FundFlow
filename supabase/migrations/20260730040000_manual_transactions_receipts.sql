-- Phase 12: Manual Transactions and Receipts
alter table public.transactions
  alter column account_id drop not null,
  add column if not exists manual_account_id uuid references public.manual_accounts (id) on delete cascade,
  add column if not exists source text not null default 'plaid'
    check (source in ('plaid', 'import', 'manual'));

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid references public.transactions (id) on delete set null,
  storage_path text not null,
  merchant text,
  purchase_date date,
  total numeric(14, 2),
  status text not null default 'unmatched'
    check (status in ('unmatched', 'matched', 'ignored')),
  created_at timestamptz not null default now()
);

create index if not exists receipts_user_status_idx on public.receipts (user_id, status, created_at desc);

alter table public.receipts enable row level security;

create policy "receipts_all_own" on public.receipts
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
