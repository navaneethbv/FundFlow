-- Fix a pre-existing RLS defect: recurring_streams_select_household (added
-- 2026-07-23) and rst_select_shared_stream (added in this phase's own
-- 20260730020000_recurring_review.sql) both join public.plaid_items
-- directly inside their own USING clause. Household members have no SELECT
-- policy on plaid_items (it holds encrypted Plaid access tokens), so RLS on
-- that nested join silently evaluates to no rows for every household
-- member -- shared recurring streams have been invisible to household
-- members since the July 23 migration, independent of this phase. Fixed
-- the same way accounts/transactions were fixed
-- (20260729193500_private_shared_account_authorization.sql,
-- 20260729203107_shared_transaction_authorization.sql): a private-schema
-- SECURITY DEFINER helper that runs the plaid_items join under elevated
-- privilege and returns only a boolean, plus one consolidated select
-- policy per table instead of two permissive ones.

create or replace function private.can_read_shared_stream(
  target_stream_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.recurring_streams rs
    join public.plaid_items pi on pi.id = rs.plaid_item_id
    where rs.id = target_stream_id
      and pi.shared_household_id is not null
      and public.is_household_member(pi.shared_household_id)
  );
$$;

revoke all on function private.can_read_shared_stream(uuid) from public, anon;
grant execute on function private.can_read_shared_stream(uuid)
  to authenticated, service_role;

drop policy if exists "recurring_streams_select_own" on public.recurring_streams;
drop policy if exists "recurring_streams_select_household" on public.recurring_streams;
create policy "recurring_streams_select_visible"
  on public.recurring_streams
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.can_read_shared_stream(id)
  );

drop policy if exists "rst_select_own" on public.recurring_stream_transactions;
drop policy if exists "rst_select_shared_stream" on public.recurring_stream_transactions;
create policy "rst_select_visible"
  on public.recurring_stream_transactions
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.can_read_shared_stream(recurring_stream_id)
  );
