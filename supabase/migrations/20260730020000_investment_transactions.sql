-- Phase 9B: Investment Transactions
create table if not exists public.investment_transactions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  account_id             uuid not null references public.accounts (id) on delete cascade,
  security_id            uuid references public.securities (id) on delete set null,
  plaid_investment_transaction_id text not null unique,
  date                   date not null,
  name                   text,
  amount                 numeric(14, 2) not null,
  quantity               numeric(18, 6),
  price                  numeric(18, 6),
  fees                   numeric(14, 2),
  txn_type               text,
  txn_subtype            text,
  iso_currency_code      text,
  cancel_plaid_id        text,
  is_active              boolean not null default true,
  last_seen_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists investment_transactions_user_date_idx
  on public.investment_transactions (user_id, date);

alter table public.investment_transactions enable row level security;

create policy "invtx_select_own" on public.investment_transactions
  for select using (user_id = (select auth.uid()));
