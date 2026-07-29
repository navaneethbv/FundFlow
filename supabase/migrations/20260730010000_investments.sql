-- Phase 9A: Investment Securities and Holdings
create table if not exists public.securities (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users (id) on delete cascade,
  plaid_security_id  text,
  ticker             text,
  name               text not null,
  security_type      text,
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

alter table public.securities enable row level security;

create policy "securities_select_visible" on public.securities
  for select using (user_id is null or user_id = (select auth.uid()));

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
  check ((account_id is null) <> (manual_account_id is null))
);

alter table public.holdings enable row level security;

create policy "holdings_select_own" on public.holdings
  for select using (user_id = (select auth.uid()));

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

alter table public.holding_snapshots enable row level security;

create policy "holding_snapshots_select_own" on public.holding_snapshots
  for select using (user_id = (select auth.uid()));
