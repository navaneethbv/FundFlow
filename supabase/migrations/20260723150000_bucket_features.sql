-- ---------------------------------------------------------------------------
-- 20260723150000_bucket_features: bucket-1/bucket-2 follow-ups
-- (household sharing lite, API tokens, sinking funds, cancellation watch,
--  shared expenses). APPLY BEFORE DEPLOYING the matching app version.
-- ---------------------------------------------------------------------------

-- Membership check used by shared-visibility policies. SECURITY DEFINER so
-- policies on other tables can consult household_members without recursive
-- RLS evaluation. Owner counts as a member.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  ) or exists (
    select 1 from public.households
    where id = hid and owner_user_id = auth.uid()
  );
$$;

-- Members can see the households they belong to, and the full member list
-- of those households (needed for the settle-up UI). Both policies are
-- additive to the existing owner-only ones.
create policy "households_select_member" on public.households
  for select using (public.is_household_member(id));
create policy "household_members_select_peers" on public.household_members
  for select using (public.is_household_member(household_id));

-- 4.2-lite: goals and budgets can be shared with a household. Sharing is
-- opt-in per row (household_id null = private). Members get read access;
-- writes stay owner-only. Transaction/account sharing is deliberately NOT
-- part of this migration.
alter table public.goals add column if not exists household_id uuid
  references public.households (id) on delete set null;
alter table public.budgets add column if not exists household_id uuid
  references public.households (id) on delete set null;

create policy "goals_select_household" on public.goals
  for select using (
    household_id is not null and public.is_household_member(household_id)
  );
create policy "budgets_select_household" on public.budgets
  for select using (
    household_id is not null and public.is_household_member(household_id)
  );

-- 4.4: manual shared-expense ledger (Splitwise-lite). paid_by owes nothing;
-- owed_user_id owes `amount` to paid_by. Members of the household can read;
-- the payer inserts; either party can settle; the payer can delete.
create table public.shared_expenses (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  paid_by       uuid not null references auth.users (id) on delete cascade,
  owed_user_id  uuid not null references auth.users (id) on delete cascade,
  description   text not null check (char_length(description) between 1 and 240),
  amount        numeric(12, 2) not null check (amount > 0),
  settled_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index shared_expenses_household_idx on public.shared_expenses (household_id);
alter table public.shared_expenses enable row level security;
create policy "shared_expenses_select_members" on public.shared_expenses
  for select using (public.is_household_member(household_id));
create policy "shared_expenses_insert_payer" on public.shared_expenses
  for insert with check (
    paid_by = (select auth.uid()) and public.is_household_member(household_id)
  );
create policy "shared_expenses_update_parties" on public.shared_expenses
  for update using (
    (select auth.uid()) in (paid_by, owed_user_id)
  ) with check (
    (select auth.uid()) in (paid_by, owed_user_id)
  );
create policy "shared_expenses_delete_payer" on public.shared_expenses
  for delete using (paid_by = (select auth.uid()));

-- 6.1: personal read-only API tokens. Only SHA-256 hashes are stored;
-- verification happens server-side (service client), so RLS here is
-- owner-manage-own for the Settings UI.
create table public.api_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index api_tokens_user_id_idx on public.api_tokens (user_id);
alter table public.api_tokens enable row level security;
create policy "api_tokens_select_own" on public.api_tokens
  for select using (user_id = (select auth.uid()));
create policy "api_tokens_insert_own" on public.api_tokens
  for insert with check (user_id = (select auth.uid()));
create policy "api_tokens_update_own" on public.api_tokens
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "api_tokens_delete_own" on public.api_tokens
  for delete using (user_id = (select auth.uid()));

-- Sinking funds (planned irregular expenses). Client-written like budgets.
create table public.sinking_funds (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  target_amount  numeric(12, 2) not null check (target_amount > 0),
  due_date       date not null,
  created_at     timestamptz not null default now()
);
create index sinking_funds_user_id_idx on public.sinking_funds (user_id);
alter table public.sinking_funds enable row level security;
create policy "sinking_funds_select_own" on public.sinking_funds
  for select using (user_id = (select auth.uid()));
create policy "sinking_funds_insert_own" on public.sinking_funds
  for insert with check (user_id = (select auth.uid()));
create policy "sinking_funds_update_own" on public.sinking_funds
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "sinking_funds_delete_own" on public.sinking_funds
  for delete using (user_id = (select auth.uid()));

-- Subscription cancellation watch: mark a merchant cancelled; the sync
-- alerts if it charges again.
create table public.cancelled_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  merchant    text not null check (char_length(merchant) between 1 and 160),
  created_at  timestamptz not null default now(),
  unique (user_id, merchant)
);
create index cancelled_subscriptions_user_idx on public.cancelled_subscriptions (user_id);
alter table public.cancelled_subscriptions enable row level security;
create policy "cancelled_subscriptions_select_own" on public.cancelled_subscriptions
  for select using (user_id = (select auth.uid()));
create policy "cancelled_subscriptions_insert_own" on public.cancelled_subscriptions
  for insert with check (user_id = (select auth.uid()));
create policy "cancelled_subscriptions_delete_own" on public.cancelled_subscriptions
  for delete using (user_id = (select auth.uid()));
