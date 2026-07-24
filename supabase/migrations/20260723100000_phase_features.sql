-- ---------------------------------------------------------------------------
-- 20260723100000_phase_features: roadmap phases 1 (remainder), 2, 4, 6, 7, 8
--
-- APPLY BEFORE DEPLOYING the matching app version: the dashboard and settings
-- read apr / rollover_enabled / category_overrides and fail until this runs.
-- ---------------------------------------------------------------------------

-- 1.10 Debt payoff planner: user-entered APR per account (Plaid's
-- transactions product does not provide APRs). Written via a server route.
alter table public.accounts add column if not exists apr numeric(5, 2)
  check (apr is null or (apr >= 0 and apr <= 99.99));
alter table public.manual_accounts add column if not exists apr numeric(5, 2)
  check (apr is null or (apr >= 0 and apr <= 99.99));

-- 1.12 Budget rollover envelopes (budgets are client-written under RLS).
alter table public.budgets add column if not exists rollover_enabled boolean not null default false;

-- 1.13 Custom category renames/merges. Client-written like budgets/goals.
create table public.category_overrides (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  source_category   text not null check (char_length(source_category) between 1 and 80),
  display_category  text not null check (char_length(display_category) between 1 and 80),
  created_at        timestamptz not null default now(),
  unique (user_id, source_category)
);
create index category_overrides_user_id_idx on public.category_overrides (user_id);
alter table public.category_overrides enable row level security;
create policy "category_overrides_select_own" on public.category_overrides
  for select using (user_id = (select auth.uid()));
create policy "category_overrides_insert_own" on public.category_overrides
  for insert with check (user_id = (select auth.uid()));
create policy "category_overrides_update_own" on public.category_overrides
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "category_overrides_delete_own" on public.category_overrides
  for delete using (user_id = (select auth.uid()));

-- 6.2 iCal feed capability tokens. Only the SHA-256 hash is stored; the
-- plaintext token appears once at mint time. Row creation happens in a
-- server route running as the user, so owner RLS applies.
create table public.calendar_tokens (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  token_hash       text not null unique,
  include_amounts  boolean not null default false,
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz
);
create index calendar_tokens_user_id_idx on public.calendar_tokens (user_id);
alter table public.calendar_tokens enable row level security;
create policy "calendar_tokens_select_own" on public.calendar_tokens
  for select using (user_id = (select auth.uid()));
create policy "calendar_tokens_insert_own" on public.calendar_tokens
  for insert with check (user_id = (select auth.uid()));
create policy "calendar_tokens_update_own" on public.calendar_tokens
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "calendar_tokens_delete_own" on public.calendar_tokens
  for delete using (user_id = (select auth.uid()));

-- 4.1 Household membership + invites.
--
-- public.household_members already exists from 20260707012910 with a superset
-- of the columns used here (it adds status/updated_at), RLS enabled, indexes,
-- and owner-or-self select/delete policies that match what this migration
-- wants. So the table is NOT recreated here.
--
-- Its write policies do have to change. They were written when membership
-- granted nothing, so they allow "user_id = auth.uid()" — any authenticated
-- user could insert themselves into an arbitrary household, or move their own
-- row to one. From 20260723150000 onward membership is a data-access grant
-- (is_household_member gates goals, budgets, shared expenses, and a shared
-- connection's accounts/transactions/streams), which turns that into a
-- privilege-escalation path. Membership is now owner-granted only.
--
-- Invite acceptance is unaffected: it runs through a server route on the
-- service client, because the invitee has no row visibility until the
-- membership exists.
drop policy if exists "household_members_insert_visible" on public.household_members;
create policy "household_members_insert_owner" on public.household_members
  for insert to authenticated with check (
    household_id in (
      select id from public.households where owner_user_id = (select auth.uid())
    )
  );

drop policy if exists "household_members_update_visible" on public.household_members;
create policy "household_members_update_owner" on public.household_members
  for update to authenticated using (
    household_id in (
      select id from public.households where owner_user_id = (select auth.uid())
    )
  ) with check (
    household_id in (
      select id from public.households where owner_user_id = (select auth.uid())
    )
  );

create table public.household_invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  email         text not null check (char_length(email) between 3 and 320),
  token_hash    text not null unique,
  invited_by    uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  accepted_at   timestamptz
);
create index household_invites_household_idx on public.household_invites (household_id);
alter table public.household_invites enable row level security;
create policy "household_invites_select_owner" on public.household_invites
  for select using (
    household_id in (
      select id from public.households where owner_user_id = (select auth.uid())
    )
  );
create policy "household_invites_insert_owner" on public.household_invites
  for insert with check (
    household_id in (
      select id from public.households where owner_user_id = (select auth.uid())
    )
  );
create policy "household_invites_delete_owner" on public.household_invites
  for delete using (
    household_id in (
      select id from public.households where owner_user_id = (select auth.uid())
    )
  );

-- 7.3 User-configurable instant-alert threshold (null = app default of 500).
alter table public.alert_preferences
  add column if not exists large_transaction_threshold numeric(12, 2)
  check (large_transaction_threshold is null or large_transaction_threshold > 0);

-- 8.4 Saved ledger views (named /transactions filter combinations).
create table public.saved_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  params      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);
create index saved_views_user_id_idx on public.saved_views (user_id);
alter table public.saved_views enable row level security;
create policy "saved_views_select_own" on public.saved_views
  for select using (user_id = (select auth.uid()));
create policy "saved_views_insert_own" on public.saved_views
  for insert with check (user_id = (select auth.uid()));
create policy "saved_views_delete_own" on public.saved_views
  for delete using (user_id = (select auth.uid()));

-- 8.2 Milestones: each key fires exactly once, ever (unique constraint is
-- the dedupe). Written by the notification cron via the service client.
create table public.milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  key         text not null check (char_length(key) between 1 and 80),
  title       text not null check (char_length(title) between 1 and 160),
  created_at  timestamptz not null default now(),
  unique (user_id, key)
);
create index milestones_user_id_idx on public.milestones (user_id);
alter table public.milestones enable row level security;
create policy "milestones_select_own" on public.milestones
  for select using (user_id = (select auth.uid()));

-- Phase 5: trigram indexes so ledger search stays fast as history grows.
create extension if not exists pg_trgm;
create index if not exists transactions_name_trgm_idx
  on public.transactions using gin (name gin_trgm_ops);
create index if not exists transactions_merchant_trgm_idx
  on public.transactions using gin (merchant_name gin_trgm_ops);
