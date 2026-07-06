-- FundFlow initial schema
-- Personal finance app: Plaid items, accounts, transactions, recurring streams,
-- budgets, sync jobs, audit logs, exports. All user-owned tables are protected
-- by Row Level Security scoped to auth.uid().

-- gen_random_uuid() is available via pgcrypto (enabled by default on Supabase).
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Keep updated_at fresh on row updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  role              text not null default 'user' check (role in ('user', 'admin')),
  mfa_enrolled      boolean not null default false,
  ai_export_enabled boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- plaid_items (one bank connection; holds the encrypted access token)
-- ---------------------------------------------------------------------------
create table public.plaid_items (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  plaid_item_id            text not null unique,
  institution_id           text,
  institution_name         text,
  -- Access token is AES-256-GCM encrypted app-side. Never store plaintext.
  access_token_ciphertext  text not null,
  access_token_iv          text not null,
  access_token_tag         text not null,
  sync_cursor              text,
  status                   text not null default 'active'
                             check (status in ('active', 'disconnected', 'error')),
  error_code               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index plaid_items_user_id_idx on public.plaid_items (user_id);

create trigger plaid_items_set_updated_at
  before update on public.plaid_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  plaid_item_id      uuid not null references public.plaid_items (id) on delete cascade,
  plaid_account_id   text not null unique,
  name               text,
  official_name      text,
  mask               text,              -- masked number only, e.g. "1234"
  type               text,              -- depository | credit | loan | investment
  subtype            text,
  current_balance    numeric(14, 2),
  available_balance  numeric(14, 2),
  credit_limit       numeric(14, 2),
  iso_currency_code  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index accounts_user_id_idx on public.accounts (user_id);
create index accounts_plaid_item_id_idx on public.accounts (plaid_item_id);

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
create table public.transactions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  account_id             uuid not null references public.accounts (id) on delete cascade,
  plaid_transaction_id   text not null unique,   -- idempotency key
  amount                 numeric(14, 2) not null, -- Plaid sign: positive = outflow
  iso_currency_code      text,
  date                   date not null,
  authorized_date        date,
  name                   text,
  merchant_name          text,
  pfc_primary            text,   -- Plaid personal_finance_category.primary
  pfc_detailed           text,   -- Plaid personal_finance_category.detailed
  payment_channel        text,
  pending                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index transactions_account_id_idx on public.transactions (account_id);

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- recurring_streams (from Plaid /transactions/recurring/get)
-- ---------------------------------------------------------------------------
create table public.recurring_streams (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  plaid_item_id    uuid not null references public.plaid_items (id) on delete cascade,
  stream_id        text not null unique,
  stream_type      text not null default 'outflow'
                     check (stream_type in ('inflow', 'outflow')),
  description      text,
  merchant_name    text,
  average_amount   numeric(14, 2),
  last_amount      numeric(14, 2),
  frequency        text,
  status           text,     -- MATURE | EARLY_DETECTION | TOMBSTONED
  category         text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index recurring_streams_user_id_idx on public.recurring_streams (user_id);

create trigger recurring_streams_set_updated_at
  before update on public.recurring_streams
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------
create table public.budgets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  category       text not null,
  monthly_limit  numeric(14, 2) not null check (monthly_limit >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, category)
);

create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sync_jobs (replaces external queue/DLQ for this scale)
-- ---------------------------------------------------------------------------
create table public.sync_jobs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  plaid_item_id  uuid references public.plaid_items (id) on delete cascade,
  status         text not null default 'pending'
                   check (status in ('pending', 'running', 'done', 'failed')),
  attempts       int not null default 0,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index sync_jobs_status_idx on public.sync_jobs (status);

create trigger sync_jobs_set_updated_at
  before update on public.sync_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_logs (sensitive actions). Written server-side with the secret key.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  action      text not null,
  metadata    jsonb not null default '{}'::jsonb,  -- never store tokens/PII
  ip          text,
  created_at  timestamptz not null default now()
);

create index audit_logs_user_id_idx on public.audit_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- data_exports (audit of report downloads)
-- ---------------------------------------------------------------------------
create table public.data_exports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  format      text not null,
  row_count   int,
  created_at  timestamptz not null default now()
);

create index data_exports_user_id_idx on public.data_exports (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Enable on every table; users can only touch rows where user_id = auth.uid().
-- Privileged server writes use the secret key, which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.plaid_items       enable row level security;
alter table public.accounts          enable row level security;
alter table public.transactions      enable row level security;
alter table public.recurring_streams enable row level security;
alter table public.budgets           enable row level security;
alter table public.sync_jobs         enable row level security;
alter table public.audit_logs        enable row level security;
alter table public.data_exports      enable row level security;

-- profiles: owner can read/update own row (insert handled by trigger).
create policy "profiles_select_own" on public.profiles
  for select using (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Generic owner policies for the user-owned tables.
-- Read-only for the browser client on Plaid-synced data (writes go through the
-- server with the secret key), except budgets which users manage directly.

-- plaid_items: owner may read; no client writes (server manages tokens).
create policy "plaid_items_select_own" on public.plaid_items
  for select using (user_id = (select auth.uid()));

-- accounts: owner may read.
create policy "accounts_select_own" on public.accounts
  for select using (user_id = (select auth.uid()));

-- transactions: owner may read.
create policy "transactions_select_own" on public.transactions
  for select using (user_id = (select auth.uid()));

-- recurring_streams: owner may read.
create policy "recurring_streams_select_own" on public.recurring_streams
  for select using (user_id = (select auth.uid()));

-- budgets: owner has full control.
create policy "budgets_select_own" on public.budgets
  for select using (user_id = (select auth.uid()));
create policy "budgets_insert_own" on public.budgets
  for insert with check (user_id = (select auth.uid()));
create policy "budgets_update_own" on public.budgets
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "budgets_delete_own" on public.budgets
  for delete using (user_id = (select auth.uid()));

-- sync_jobs: owner may read status.
create policy "sync_jobs_select_own" on public.sync_jobs
  for select using (user_id = (select auth.uid()));

-- audit_logs: owner may read own history.
create policy "audit_logs_select_own" on public.audit_logs
  for select using (user_id = (select auth.uid()));

-- data_exports: owner may read own history.
create policy "data_exports_select_own" on public.data_exports
  for select using (user_id = (select auth.uid()));
