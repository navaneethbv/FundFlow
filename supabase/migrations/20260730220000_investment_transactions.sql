-- Phase 9B: investment transactions, for cash-flow-adjusted (time-weighted)
-- portfolio performance. External cash flows for that calculation are the
-- rows below whose txn_subtype marks money entering or leaving the account
-- (deposit, withdrawal, contribution, distribution) — never buys and sells
-- inside it, which move value between holdings and cash but are not a
-- deposit or withdrawal from the investor's point of view.

create table if not exists public.investment_transactions (
  id                               uuid primary key default gen_random_uuid(),
  user_id                          uuid not null references auth.users (id) on delete cascade,
  account_id                       uuid not null references public.accounts (id) on delete cascade,
  security_id                      uuid references public.securities (id) on delete set null,
  plaid_investment_transaction_id  text not null unique,   -- idempotency key
  date                             date not null,
  name                             text,
  amount                           numeric(14, 2) not null,  -- Plaid sign: positive = money out of the account
  quantity                         numeric(18, 6),
  price                            numeric(18, 6),
  fees                             numeric(14, 2),
  txn_type                         text,          -- buy | sell | cash | fee | transfer | cancel
  txn_subtype                      text,          -- deposit | withdrawal | dividend | contribution | ...
  iso_currency_code                text,
  cancel_plaid_id                  text,          -- id of the transaction this row cancels, if any
  is_active                        boolean not null default true,   -- mark-and-sweep
  last_seen_at                     timestamptz not null default now(),
  created_at                       timestamptz not null default now(),
  updated_at                       timestamptz not null default now()
);

create index if not exists investment_transactions_user_date_idx
  on public.investment_transactions (user_id, date);
create index if not exists investment_transactions_account_date_idx
  on public.investment_transactions (account_id, date);

create trigger investment_transactions_set_updated_at
  before update on public.investment_transactions
  for each row execute function public.set_updated_at();

alter table public.investment_transactions enable row level security;

revoke all on table public.investment_transactions from anon;
grant select on table public.investment_transactions to authenticated;

create policy "invtx_select_own" on public.investment_transactions
  for select to authenticated
  using (user_id = (select auth.uid()));
-- Household visibility recurses through accounts' own select policy, the
-- same pattern holdings_select_shared_account uses.
create policy "invtx_select_shared_account" on public.investment_transactions
  for select to authenticated
  using (
    exists (
      select 1 from public.accounts a
      where a.id = investment_transactions.account_id
    )
  );
-- Writes go through the service client during sync; no client write policies
-- — there is no manual equivalent the way holdings has one, since a manual
-- holding's own as-of value already stands in for its history.

-- Verification (expect 0 rows):
--   select count(*) from public.investment_transactions it
--     join public.accounts a on a.id = it.account_id
--    where it.user_id <> a.user_id;
--
-- Rollback:
--   drop table if exists public.investment_transactions;
