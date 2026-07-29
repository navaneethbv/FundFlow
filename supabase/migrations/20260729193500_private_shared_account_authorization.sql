-- Keep the shared-account authorization helper outside the public schema.
-- PostgREST exposes public functions as RPC endpoints, while RLS policies can
-- safely call a SECURITY DEFINER function from a non-exposed schema.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.can_read_shared_account(
  target_account_id uuid
)
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

revoke all on function private.can_read_shared_account(uuid) from public, anon;
grant execute on function private.can_read_shared_account(uuid)
  to authenticated, service_role;

-- One SELECT policy per table avoids evaluating two permissive policies for
-- every visible row while preserving owner and household access.
drop policy if exists "accounts_select_own" on public.accounts;
drop policy if exists "accounts_select_household" on public.accounts;
create policy "accounts_select_visible"
  on public.accounts
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.can_read_shared_account(id)
  );

drop policy if exists "account_balance_snapshots_select_own"
  on public.account_balance_snapshots;
drop policy if exists "account_balance_snapshots_select_shared"
  on public.account_balance_snapshots;
create policy "account_balance_snapshots_select_visible"
  on public.account_balance_snapshots
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      account_id is not null
      and private.can_read_shared_account(account_id)
    )
  );

drop function public.can_read_shared_account(uuid);
