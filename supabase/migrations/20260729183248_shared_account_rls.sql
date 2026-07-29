-- Repair shared-account visibility.
--
-- The earlier accounts_select_household policy queried plaid_items directly.
-- Household members deliberately cannot select plaid_items because it stores
-- encrypted access-token material, so RLS on that nested query hid every row.
-- This function exposes only the authorization decision for one account id.

create or replace function public.can_read_shared_account(target_account_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.accounts a
    join public.plaid_items pi on pi.id = a.plaid_item_id
    where a.id = target_account_id
      and pi.shared_household_id is not null
      and public.is_household_member(pi.shared_household_id)
  );
$$;

revoke all on function public.can_read_shared_account(uuid) from public, anon;
grant execute on function public.can_read_shared_account(uuid)
  to authenticated, service_role;

drop policy if exists "accounts_select_household" on public.accounts;
create policy "accounts_select_household"
  on public.accounts
  for select
  to authenticated
  using (public.can_read_shared_account(id));

drop policy if exists "account_balance_snapshots_select_shared"
  on public.account_balance_snapshots;
create policy "account_balance_snapshots_select_shared"
  on public.account_balance_snapshots
  for select
  to authenticated
  using (
    account_id is not null
    and public.can_read_shared_account(account_id)
  );

-- Verification:
-- A household member with an active membership can select accounts and
-- account_balance_snapshots belonging to an opted-in shared Plaid item, but
-- still cannot select the plaid_items row itself.
