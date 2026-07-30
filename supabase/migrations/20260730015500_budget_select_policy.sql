-- Phase 4: consolidate Budget visibility into one authenticated policy.
drop policy if exists "budgets_select_own" on public.budgets;
drop policy if exists "budgets_select_household" on public.budgets;

create policy "budgets_select_visible"
  on public.budgets for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      household_id is not null
      and public.is_household_member(household_id)
    )
  );
