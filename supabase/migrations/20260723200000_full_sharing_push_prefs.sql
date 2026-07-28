-- ---------------------------------------------------------------------------
-- 20260723200000_full_sharing_push_prefs: full household data sharing
-- (4.2/4.3), dashboard layout preferences (8.6), web-push subscriptions.
-- APPLY BEFORE DEPLOYING the matching app version.
-- ---------------------------------------------------------------------------

-- 4.2 full sharing: sharing is opt-in PER BANK CONNECTION. Setting
-- shared_household_id exposes that item's accounts, transactions, and
-- recurring streams (read-only) to household members via the additive
-- policies below. Unshared connections stay invisible, full stop.
alter table public.plaid_items add column if not exists shared_household_id uuid
  references public.households (id) on delete set null;

-- NOTE: no member policy is added on plaid_items itself — that row carries
-- the encrypted Plaid access token, and household members have no business
-- reading even the ciphertext. Members see shared *data*, not the item.
create policy "accounts_select_household" on public.accounts
  for select using (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = accounts.plaid_item_id
        and pi.shared_household_id is not null
        and public.is_household_member(pi.shared_household_id)
    )
  );

create policy "transactions_select_household" on public.transactions
  for select using (
    exists (
      select 1
      from public.accounts a
      join public.plaid_items pi on pi.id = a.plaid_item_id
      where a.id = transactions.account_id
        and pi.shared_household_id is not null
        and public.is_household_member(pi.shared_household_id)
    )
  );

create policy "recurring_streams_select_household" on public.recurring_streams
  for select using (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = recurring_streams.plaid_item_id
        and pi.shared_household_id is not null
        and public.is_household_member(pi.shared_household_id)
    )
  );

-- 8.6 dashboard layout preferences (client-writable profile prefs column,
-- same trust level as the existing preference columns).
alter table public.profiles add column if not exists dashboard_prefs jsonb
  not null default '{}'::jsonb;

-- Web push subscriptions. Endpoint is unique per browser registration.
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (user_id = (select auth.uid()));
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check (user_id = (select auth.uid()));
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using (user_id = (select auth.uid()));
