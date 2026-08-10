-- ---------------------------------------------------------------------------
-- 20260810120000_session_revocation_rls: enforce revocation + MFA in the DB.
-- APPLY BEFORE DEPLOYING the matching app version.
--
--   M4   RLS checks only auth.uid(). A user who extracts their access token
--        (or a revoked session's refresh token keeps minting fresh ones) can
--        call the Supabase Data API directly and bypass requireUser/proxy.
--        Add "session not revoked" and "aal2 satisfied" clauses to the
--        sensitive financial policies so those rows are unreadable/unwritable
--        through the Data API even when the app layer is bypassed.
--
-- The helpers live in the `private` schema (same pattern as
-- can_read_shared_account) so PostgREST never exposes them as RPC endpoints.
-- Both read the caller's JWT claims via auth.jwt(), which is safe inside a
-- SECURITY DEFINER function (the request-scoped GUC is not reset by the
-- definer role swap).
--
-- NOTE: user_session_records itself is deliberately NOT guarded here.
-- requireUser() upserts the caller's own row, and a revoked session whose
-- upsert was RLS-blocked would silently return no record, which would make
-- the app-layer revoked_at check fall OPEN. That table stays owner-scoped and
-- is enforced at the application layer.
-- ---------------------------------------------------------------------------

create or replace function private.session_not_revoked()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select not exists (
    select 1
    from public.user_session_records r
    where r.session_id = coalesce(auth.jwt()->>'session_id', '')
      and r.revoked_at is not null
  );
$$;

revoke all on function private.session_not_revoked() from public, anon;
grant execute on function private.session_not_revoked() to authenticated, service_role;

-- Mirrors lib/mfa.ts (needsMfaStepUp): a session whose aal is below aal2 must
-- not touch protected data. A user with no verified factors has nextLevel
-- aal1, so they pass regardless of their current aal.
create or replace function private.mfa_satisfied()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select (coalesce(auth.jwt()->>'aal', 'aal1')) = 'aal2'
    or not exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = auth.uid()
        and f.status = 'verified'
    );
$$;

revoke all on function private.mfa_satisfied() from public, anon;
grant execute on function private.mfa_satisfied() to authenticated, service_role;

-- plaid_items carries the encrypted Plaid access token: owner reads only.
drop policy if exists "plaid_items_select_own" on public.plaid_items;
create policy "plaid_items_select_own" on public.plaid_items
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "accounts_select_visible" on public.accounts;
create policy "accounts_select_visible"
  on public.accounts
  for select
  to authenticated
  using (
    (user_id = (select auth.uid()) or private.can_read_shared_account(id))
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "transactions_select_visible" on public.transactions;
create policy "transactions_select_visible"
  on public.transactions
  for select
  to authenticated
  using (
    (user_id = (select auth.uid()) or private.can_read_shared_account(account_id))
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "account_balance_snapshots_select_visible" on public.account_balance_snapshots;
create policy "account_balance_snapshots_select_visible"
  on public.account_balance_snapshots
  for select
  to authenticated
  using (
    (
      user_id = (select auth.uid())
      or (
        account_id is not null
        and private.can_read_shared_account(account_id)
      )
    )
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "recurring_streams_select_visible" on public.recurring_streams;
create policy "recurring_streams_select_visible"
  on public.recurring_streams
  for select
  to authenticated
  using (
    (user_id = (select auth.uid()) or private.can_read_shared_stream(id))
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "recurring_streams_update_own" on public.recurring_streams;
create policy "recurring_streams_update_own"
  on public.recurring_streams
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.session_not_revoked()
    and private.mfa_satisfied()
  )
  with check (
    user_id = (select auth.uid())
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

-- budgets: one consolidated visible SELECT + guarded owner writes.
drop policy if exists "budgets_select_visible" on public.budgets;
create policy "budgets_select_visible"
  on public.budgets
  for select
  to authenticated
  using (
    (
      user_id = (select auth.uid())
      or (
        household_id is not null
        and public.is_household_member(household_id)
      )
    )
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "budgets_insert_own" on public.budgets;
create policy "budgets_insert_own" on public.budgets
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      household_id is null
      or public.is_household_member_for(household_id, (select auth.uid()))
    )
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "budgets_update_own" on public.budgets;
create policy "budgets_update_own" on public.budgets
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and private.session_not_revoked()
    and private.mfa_satisfied()
  )
  with check (
    user_id = (select auth.uid())
    and (
      household_id is null
      or public.is_household_member_for(household_id, (select auth.uid()))
    )
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "budgets_delete_own" on public.budgets;
create policy "budgets_delete_own" on public.budgets
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

-- goals: consolidate the two owner/household SELECT policies into one guarded
-- visible policy, and guard the owner writes.
drop policy if exists "goals_select_own" on public.goals;
drop policy if exists "goals_select_household" on public.goals;
create policy "goals_select_visible"
  on public.goals
  for select
  to authenticated
  using (
    (
      user_id = (select auth.uid())
      or (
        household_id is not null
        and public.is_household_member(household_id)
      )
    )
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "goals_insert_own" on public.goals;
create policy "goals_insert_own" on public.goals
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      household_id is null
      or public.is_household_member_for(household_id, (select auth.uid()))
    )
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "goals_update_own" on public.goals;
create policy "goals_update_own" on public.goals
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and private.session_not_revoked()
    and private.mfa_satisfied()
  )
  with check (
    user_id = (select auth.uid())
    and (
      household_id is null
      or public.is_household_member_for(household_id, (select auth.uid()))
    )
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );

drop policy if exists "goals_delete_own" on public.goals;
create policy "goals_delete_own" on public.goals
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );
