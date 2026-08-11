-- ---------------------------------------------------------------------------
-- 20260810100000_security_hardening: SQL-side hardening from the 2026-08-10
-- code review. APPLY BEFORE DEPLOYING the matching app version.
--
--   H4   revoke PUBLIC execute on rate_limit_hit (anon DoS surface)
--   M8   transaction_splits / linked_refunds / transaction_annotations write
--        policies must verify the referenced transaction is owned by the caller
--   M9   remove pg_temp from SECURITY DEFINER search paths (CVE-2018-1058)
--   M10  revoke is_household_member from public/anon
--   LOW  shared_expenses parties must belong to the household
--   LOW  budgets/goals household_id must be a household the caller belongs to
-- ---------------------------------------------------------------------------

-- H4: rate_limit_hit is a SECURITY DEFINER function in the public schema, so
-- PostgREST exposes it as an RPC to anon by default. Only the app may call it.
--
-- service_role is the ONLY grantee: lib/rate-limit.ts always goes through
-- createServiceClient(). Leaving EXECUTE with `authenticated` would keep the
-- exact DoS this finding is about, just behind a login: any signed-in user
-- could burn another user's counters by calling
-- rate_limit_hit('account-delete:<their-uuid>', ...) until the window closes,
-- locking them out of their own rate-limited routes.
revoke all on function public.rate_limit_hit(text, int, int) from public;
revoke all on function public.rate_limit_hit(text, int, int) from anon;
revoke all on function public.rate_limit_hit(text, int, int) from authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- M10: is_household_member is referenced from RLS policies, so `authenticated`
-- keeps EXECUTE; anon and the implicit PUBLIC grant are revoked.
revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.is_household_member(uuid) from anon;
grant execute on function public.is_household_member(uuid) to authenticated;

-- Helper used by the LOW policy fixes below: membership for an ARBITRARY user
-- (owner counts as a member), unlike is_household_member which is caller-bound.
create or replace function public.is_household_member_for(hid uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = p_user_id
  ) or exists (
    select 1 from public.households
    where id = hid and owner_user_id = p_user_id
  );
$$;
revoke all on function public.is_household_member_for(uuid, uuid) from public;
revoke all on function public.is_household_member_for(uuid, uuid) from anon;
grant execute on function public.is_household_member_for(uuid, uuid) to authenticated;

-- M9: drop pg_temp from SECURITY DEFINER search paths. Both bodies already
-- schema-qualify every table reference and use only pg_catalog built-ins, so
-- an empty search path resolves identically without the temp-schema attack
-- surface (CVE-2018-1058 class).
create or replace function public.set_goal_allocation(
  p_goal_id uuid,
  p_account_id uuid,
  p_allocated_amount numeric default null,
  p_use_entire_balance boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance numeric;
  v_other_fixed numeric;
  v_other_entire int;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_use_entire_balance and p_allocated_amount is not null then
    raise exception 'allocation_mode_conflict' using errcode = '22023';
  end if;
  if not p_use_entire_balance and (p_allocated_amount is null or p_allocated_amount <= 0) then
    raise exception 'allocation_amount_required' using errcode = '22023';
  end if;

  -- Ownership of both ends, checked explicitly because this runs as definer.
  if not exists (
    select 1 from public.goals
    where id = p_goal_id and user_id = v_user_id
  ) then
    raise exception 'goal_not_found' using errcode = 'P0002';
  end if;

  select current_balance into v_balance
  from public.accounts
  where id = p_account_id and user_id = v_user_id;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  -- Lock every other allocation against this account before deciding.
  perform 1
  from public.goal_accounts
  where account_id = p_account_id
    and user_id = v_user_id
    and goal_id <> p_goal_id
  for update;

  select
    coalesce(sum(allocated_amount) filter (where not use_entire_balance), 0),
    count(*) filter (where use_entire_balance)
  into v_other_fixed, v_other_entire
  from public.goal_accounts
  where account_id = p_account_id
    and user_id = v_user_id
    and goal_id <> p_goal_id;

  if v_other_entire > 0 then
    raise exception 'account_already_fully_allocated' using errcode = '23514';
  end if;

  if p_use_entire_balance and v_other_fixed > 0 then
    raise exception 'account_has_fixed_allocations' using errcode = '23514';
  end if;

  -- A null or negative balance has nothing to allocate against; treat it as
  -- zero rather than letting NULL arithmetic silently pass the check.
  if not p_use_entire_balance
     and v_other_fixed + p_allocated_amount > greatest(coalesce(v_balance, 0), 0) then
    raise exception 'allocation_exceeds_balance' using errcode = '23514';
  end if;

  insert into public.goal_accounts (
    user_id, goal_id, account_id, allocated_amount, use_entire_balance
  )
  values (
    v_user_id, p_goal_id, p_account_id,
    case when p_use_entire_balance then null else p_allocated_amount end,
    p_use_entire_balance
  )
  on conflict (goal_id, account_id) do update
    set allocated_amount = excluded.allocated_amount,
        use_entire_balance = excluded.use_entire_balance
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.set_goal_allocation(uuid, uuid, numeric, boolean) from public;
revoke all on function public.set_goal_allocation(uuid, uuid, numeric, boolean) from anon;
grant execute on function public.set_goal_allocation(uuid, uuid, numeric, boolean) to authenticated;

create or replace function public.rename_user_tag(
  p_old_name text,
  p_new_name text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_old_name is null or p_new_name is null or char_length(trim(p_new_name)) = 0 then
    raise exception 'invalid_tag_name' using errcode = '22023';
  end if;

  -- Rewrite every annotation's tag array; array_remove(array_append(...))
  -- de-duplicates in the rare case the target name already exists on a row
  -- (renaming into an existing tag is how a merge is expressed).
  update public.transaction_annotations
     set tags = (
       select array_agg(distinct tag)
       from unnest(array_replace(tags, p_old_name, p_new_name)) as tag
     )
   where user_id = v_user_id
     and p_old_name = any(tags);

  update public.user_tags
     set name = p_new_name
   where user_id = v_user_id
     and name = p_old_name
     -- If p_new_name already exists as its own registry row, drop the old
     -- one instead of violating the unique (user_id, name) constraint.
     and not exists (
       select 1 from public.user_tags where user_id = v_user_id and name = p_new_name
     );

  delete from public.user_tags
   where user_id = v_user_id
     and name = p_old_name;
end;
$$;

revoke all on function public.rename_user_tag(text, text) from public;
revoke all on function public.rename_user_tag(text, text) from anon;
grant execute on function public.rename_user_tag(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- M8: splits/refunds/annotations must only ever attach to a transaction the
-- caller owns. FKs alone are not enough (FKs bypass RLS), and a household
-- member who can READ a shared transaction must not be able to attach foreign
-- metadata to it (which would pollute the owner's totals and trip the split
-- validation trigger).
-- ---------------------------------------------------------------------------

drop policy if exists "transaction_splits_insert_own" on public.transaction_splits;
drop policy if exists "transaction_splits_update_own" on public.transaction_splits;

create policy "transaction_splits_insert_own" on public.transaction_splits
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_splits.transaction_id
        and t.user_id = (select auth.uid())
    )
  );
create policy "transaction_splits_update_own" on public.transaction_splits
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_splits.transaction_id
        and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "linked_refunds_insert_own" on public.linked_refunds;
drop policy if exists "linked_refunds_update_own" on public.linked_refunds;

create policy "linked_refunds_insert_own" on public.linked_refunds
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.charge_transaction_id
        and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.refund_transaction_id
        and t.user_id = (select auth.uid())
    )
  );
create policy "linked_refunds_update_own" on public.linked_refunds
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.charge_transaction_id
        and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.refund_transaction_id
        and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "transaction_annotations_insert_own" on public.transaction_annotations;
drop policy if exists "transaction_annotations_update_own" on public.transaction_annotations;

create policy "transaction_annotations_insert_own" on public.transaction_annotations
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_annotations.transaction_id
        and t.user_id = (select auth.uid())
    )
  );
create policy "transaction_annotations_update_own" on public.transaction_annotations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_annotations.transaction_id
        and t.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- LOW: shared_expenses parties must both belong to the household, so a payer
-- cannot mint/settle debts against strangers (or re-point an existing debt at
-- a non-member on update).
-- ---------------------------------------------------------------------------

drop policy if exists "shared_expenses_insert_payer" on public.shared_expenses;
drop policy if exists "shared_expenses_update_parties" on public.shared_expenses;

create policy "shared_expenses_insert_payer" on public.shared_expenses
  for insert with check (
    paid_by = (select auth.uid())
    and public.is_household_member_for(household_id, paid_by)
    and public.is_household_member_for(household_id, owed_user_id)
  );
create policy "shared_expenses_update_parties" on public.shared_expenses
  for update using (
    (select auth.uid()) in (paid_by, owed_user_id)
  ) with check (
    (select auth.uid()) in (paid_by, owed_user_id)
    and public.is_household_member_for(household_id, paid_by)
    and public.is_household_member_for(household_id, owed_user_id)
  );

-- ---------------------------------------------------------------------------
-- LOW: budgets/goals may only point at a household the caller belongs to, so
-- a user cannot inject rows into a shared view of a household they do not
-- belong to, or flip household_id to move shared rows between households.
-- ---------------------------------------------------------------------------

drop policy if exists "budgets_insert_own" on public.budgets;
drop policy if exists "budgets_update_own" on public.budgets;

create policy "budgets_insert_own" on public.budgets
  for insert with check (
    user_id = (select auth.uid())
    and (
      household_id is null
      or public.is_household_member_for(household_id, (select auth.uid()))
    )
  );
create policy "budgets_update_own" on public.budgets
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      household_id is null
      or public.is_household_member_for(household_id, (select auth.uid()))
    )
  );

drop policy if exists "goals_insert_own" on public.goals;
drop policy if exists "goals_update_own" on public.goals;

create policy "goals_insert_own" on public.goals
  for insert with check (
    user_id = (select auth.uid())
    and (
      household_id is null
      or public.is_household_member_for(household_id, (select auth.uid()))
    )
  );
create policy "goals_update_own" on public.goals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      household_id is null
      or public.is_household_member_for(household_id, (select auth.uid()))
    )
  );
