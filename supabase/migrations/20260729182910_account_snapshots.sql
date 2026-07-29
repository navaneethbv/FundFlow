-- Daily current-state balance history for the Accounts page, dashboard
-- widgets, and forecasting.
--
-- This migration deliberately captures only the day it is first applied.
-- FundFlow cannot reconstruct earlier balances honestly from current account
-- state, so the UI reports that earlier history is unavailable.

create table public.account_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete cascade,
  manual_account_id uuid references public.manual_accounts (id) on delete cascade,
  snapshot_date date not null,
  current_balance numeric(14, 2),
  available_balance numeric(14, 2),
  iso_currency_code text not null default 'USD'
    check (char_length(iso_currency_code) = 3),
  created_at timestamptz not null default now(),
  check ((account_id is null) <> (manual_account_id is null))
);

create index account_balance_snapshots_user_date_idx
  on public.account_balance_snapshots (user_id, snapshot_date desc);

create index account_balance_snapshots_account_date_idx
  on public.account_balance_snapshots (account_id, snapshot_date desc)
  where account_id is not null;

create index account_balance_snapshots_manual_date_idx
  on public.account_balance_snapshots (manual_account_id, snapshot_date desc)
  where manual_account_id is not null;

-- Supabase JS exposes column-based conflict targets but cannot include the
-- predicate required to infer a partial unique index.
-- Postgres 17 NULLS NOT DISTINCT gives both source types one ordinary,
-- API-addressable conflict target while the check constraint guarantees that
-- exactly one source id is present.
create unique index account_balance_snapshots_source_day_uidx
  on public.account_balance_snapshots (
    account_id,
    manual_account_id,
    snapshot_date
  ) nulls not distinct;

alter table public.account_balance_snapshots enable row level security;

-- Snapshot history is read-only through the Data API.
-- Trusted service clients own every insert and update.
revoke all on table public.account_balance_snapshots from anon, authenticated;
grant select on table public.account_balance_snapshots to authenticated;
grant select, insert, update, delete
  on table public.account_balance_snapshots to service_role;

create policy "account_balance_snapshots_select_own"
  on public.account_balance_snapshots
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The accounts subquery is itself RLS-bound.
-- It is true for an account owned by the caller or shared through an opted-in
-- Plaid connection, without exposing the plaid_items row or its token fields.
create policy "account_balance_snapshots_select_shared"
  on public.account_balance_snapshots
  for select
  to authenticated
  using (
    account_id is not null
    and exists (
      select 1
      from public.accounts
      where accounts.id = account_balance_snapshots.account_id
    )
  );

-- One-time, current-state-only backfill.
-- Reapplying this statement on the same UTC day updates the same source-day
-- rows and never creates duplicates.
insert into public.account_balance_snapshots (
  user_id,
  account_id,
  manual_account_id,
  snapshot_date,
  current_balance,
  available_balance,
  iso_currency_code
)
select
  accounts.user_id,
  accounts.id,
  null,
  current_date,
  accounts.current_balance,
  accounts.available_balance,
  upper(coalesce(accounts.iso_currency_code, 'USD'))
from public.accounts
where accounts.current_balance is not null
union all
select
  manual_accounts.user_id,
  null,
  manual_accounts.id,
  current_date,
  manual_accounts.balance,
  null,
  'USD'
from public.manual_accounts
where manual_accounts.include_in_net_worth
  and manual_accounts.balance is not null
on conflict (account_id, manual_account_id, snapshot_date)
do update set
  user_id = excluded.user_id,
  current_balance = excluded.current_balance,
  available_balance = excluded.available_balance,
  iso_currency_code = excluded.iso_currency_code;

-- Verification: both queries must return zero rows.
--
-- select account_id, manual_account_id, snapshot_date, count(*)
-- from public.account_balance_snapshots
-- group by account_id, manual_account_id, snapshot_date
-- having count(*) > 1;
--
-- select count(*) as invalid_sources
-- from public.account_balance_snapshots
-- where (account_id is null) = (manual_account_id is null);
--
-- Roll-forward note:
-- Once daily history starts accumulating, do not use a backward migration that
-- silently discards it.
-- Stop snapshot writers, export the table, apply a corrected forward migration,
-- restore the validated rows, and then resume writers.
