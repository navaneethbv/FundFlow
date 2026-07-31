-- Phase 9A: Investment holdings and allocation.
--
-- `sync_jobs` gets a `job_type` column before investment sync starts writing
-- to it. Four read sites (lib/dashboard.ts, lib/budget-data.ts,
-- lib/cash-flow-data.ts, lib/recurring-data.ts) read the newest `done` job as
-- the "last successful sync" signal for their stale-data banners; without
-- this column an investments-only sync success would read as "transactions
-- are fresh" even when the transaction sync itself just failed. Existing rows
-- backfill to 'transactions' — the only kind that existed before this.
alter table public.sync_jobs
  add column if not exists job_type text not null default 'transactions'
    check (job_type in ('transactions', 'investments'));
--
-- Three tables: `securities` (the instrument, shared across every user who
-- holds it at the same institution — not user-owned data, so it gets a
-- visibility policy rather than an ownership one), `holdings` (the per-user
-- position, either Plaid-synced or manually entered), and `holding_snapshots`
-- (a daily price/quantity/value point used for balance history and, later,
-- Phase 9B's time-weighted return).

-- ---------------------------------------------------------------------------
-- 1. Securities
-- ---------------------------------------------------------------------------

create table if not exists public.securities (
  id                 uuid primary key default gen_random_uuid(),
  -- null for a Plaid-sourced security (shared across every user who holds
  -- it); set for a manually-entered one, which only its author can see.
  user_id            uuid references auth.users (id) on delete cascade,
  plaid_security_id  text,
  ticker             text,
  name               text not null check (char_length(name) between 1 and 160),
  security_type      text,          -- equity | etf | mutual fund | cash | ...
  security_subtype   text,
  close_price        numeric(18, 6),
  close_price_as_of  date,
  iso_currency_code  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (plaid_security_id is not null or user_id is not null)
);

create unique index if not exists securities_plaid_id_uidx
  on public.securities (plaid_security_id)
  where plaid_security_id is not null;

create trigger securities_set_updated_at
  before update on public.securities
  for each row execute function public.set_updated_at();

alter table public.securities enable row level security;

revoke all on table public.securities from anon;
grant select, insert, update, delete on table public.securities to authenticated;

-- Every authenticated user may read a Plaid-sourced security (it carries no
-- per-user data, just instrument metadata already visible in any Holdings
-- response), but only the author of a manual security may see it.
create policy "securities_select_visible" on public.securities
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy "securities_insert_own" on public.securities
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "securities_update_own" on public.securities
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "securities_delete_own" on public.securities
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Holdings
-- ---------------------------------------------------------------------------

create table if not exists public.holdings (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  account_id         uuid references public.accounts (id) on delete cascade,
  manual_account_id  uuid references public.manual_accounts (id) on delete cascade,
  security_id        uuid not null references public.securities (id) on delete cascade,
  quantity           numeric(18, 6),
  cost_basis         numeric(14, 2),
  institution_price  numeric(18, 6),
  institution_value  numeric(14, 2),
  as_of              date,
  source             text not null check (source in ('plaid', 'manual')),
  is_active          boolean not null default true,
  last_seen_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((account_id is null) <> (manual_account_id is null)),
  check ((source = 'plaid') = (account_id is not null))
);

create unique index if not exists holdings_plaid_account_security_uidx
  on public.holdings (account_id, security_id)
  where source = 'plaid';
create unique index if not exists holdings_manual_account_security_uidx
  on public.holdings (manual_account_id, security_id)
  where source = 'manual';
create index if not exists holdings_user_idx on public.holdings (user_id);

create trigger holdings_set_updated_at
  before update on public.holdings
  for each row execute function public.set_updated_at();

alter table public.holdings enable row level security;

revoke all on table public.holdings from anon;
grant select, insert, update, delete on table public.holdings to authenticated;

create policy "holdings_select_own" on public.holdings
  for select to authenticated
  using (user_id = (select auth.uid()));
-- Household visibility recurses through `accounts`' own select policy
-- (accounts_select_visible): the subquery only matches rows the caller can
-- already see there, so this cannot leak a holding on an account that isn't
-- shared with them. Manual holdings have no equivalent — manual_accounts is
-- owner-only — so they are covered by holdings_select_own alone.
create policy "holdings_select_shared_account" on public.holdings
  for select to authenticated
  using (
    account_id is not null
    and exists (
      select 1 from public.accounts a
      where a.id = holdings.account_id
    )
  );
-- Writes are owner-only. Plaid holdings are written by the service client
-- during sync (bypasses RLS); these policies exist for manual holdings.
create policy "holdings_write_own" on public.holdings
  for all to authenticated
  using (user_id = (select auth.uid()) and source = 'manual')
  with check (
    user_id = (select auth.uid())
    and source = 'manual'
    and manual_account_id is not null
    and exists (
      select 1 from public.manual_accounts ma
      where ma.id = holdings.manual_account_id and ma.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Holding snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.holding_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  holding_id     uuid not null references public.holdings (id) on delete cascade,
  snapshot_date  date not null,
  quantity       numeric(18, 6),
  price          numeric(18, 6),
  value          numeric(14, 2),
  unique (holding_id, snapshot_date)
);

create index if not exists holding_snapshots_user_date_idx
  on public.holding_snapshots (user_id, snapshot_date);

alter table public.holding_snapshots enable row level security;

revoke all on table public.holding_snapshots from anon;
grant select, insert, update, delete on table public.holding_snapshots to authenticated;

create policy "holding_snapshots_select_own" on public.holding_snapshots
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "holding_snapshots_select_shared_holding" on public.holding_snapshots
  for select to authenticated
  using (
    exists (
      select 1 from public.holdings h
      where h.id = holding_snapshots.holding_id
    )
  );
-- Snapshots are written by the service client during sync only; no client
-- write policy is granted (matches account_history's pattern).

-- Verification (expect 0 rows from each):
--
--   -- every holding names exactly one account
--   select count(*) from public.holdings
--    where (account_id is null) = (manual_account_id is null);
--
--   -- no holding crosses users through its account
--   select count(*) from public.holdings h
--     join public.accounts a on a.id = h.account_id
--    where h.user_id <> a.user_id;
--
--   -- no duplicate Plaid holding per account/security
--   select account_id, security_id, count(*) from public.holdings
--    where source = 'plaid' group by account_id, security_id having count(*) > 1;
--
-- Rollback:
--   drop table if exists public.holding_snapshots;
--   drop table if exists public.holdings;
--   drop table if exists public.securities;
