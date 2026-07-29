-- Phase 4: Budget Groups and Period Planning
alter table public.budgets
  add column if not exists group_name text not null default 'flexible'
    check (group_name in ('income', 'fixed', 'flexible', 'non_monthly')),
  add column if not exists sort_order int not null default 0;

create table if not exists public.budget_periods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  budget_id  uuid not null references public.budgets (id) on delete cascade,
  month      date not null check (month = date_trunc('month', month)::date),
  planned    numeric(14, 2) not null check (planned >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, month)
);

create index if not exists budget_periods_user_month_idx
  on public.budget_periods (user_id, month);

create trigger budget_periods_set_updated_at
  before update on public.budget_periods
  for each row execute function public.set_updated_at();

alter table public.budget_periods enable row level security;

revoke all on table public.budget_periods from anon;
grant select, insert, update, delete on table public.budget_periods to authenticated;

create policy "budget_periods_select_visible"
  on public.budget_periods for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.budgets b
      where b.id = budget_periods.budget_id
        and b.household_id is not null
        and public.is_household_member(b.household_id)
    )
  );

create policy "budget_periods_insert_owner"
  on public.budget_periods for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.budgets b
      where b.id = budget_periods.budget_id
        and b.user_id = (select auth.uid())
    )
  );

create policy "budget_periods_update_owner"
  on public.budget_periods for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.budgets b
      where b.id = budget_periods.budget_id
        and b.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.budgets b
      where b.id = budget_periods.budget_id
        and b.user_id = (select auth.uid())
    )
  );

create policy "budget_periods_delete_owner"
  on public.budget_periods for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.budgets b
      where b.id = budget_periods.budget_id
        and b.user_id = (select auth.uid())
    )
  );
