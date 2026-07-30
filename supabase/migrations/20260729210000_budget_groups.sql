-- Phase 4: Budget Groups and Period Planning
alter table public.budgets
  add column if not exists group_name text not null default 'flexible'
    check (group_name in ('income', 'fixed', 'flexible', 'non_monthly')),
  add column if not exists sort_order int not null default 0;

create index if not exists budgets_household_id_idx
  on public.budgets (household_id);

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

create or replace function public.update_budget_period(
  p_budget_id uuid,
  p_month date,
  p_planned numeric,
  p_group_name text default null,
  p_rollover_enabled boolean default null,
  p_sort_order integer default null
)
returns table (
  budget_id uuid,
  month date,
  planned numeric,
  group_name text,
  rollover_enabled boolean,
  sort_order integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_group_name text;
  saved_rollover_enabled boolean;
  saved_sort_order integer;
  saved_planned numeric;
begin
  update public.budgets as budget
  set
    group_name = coalesce(p_group_name, budget.group_name),
    rollover_enabled = coalesce(
      p_rollover_enabled,
      budget.rollover_enabled
    ),
    sort_order = coalesce(p_sort_order, budget.sort_order)
  where budget.id = p_budget_id
    and budget.user_id = (select auth.uid())
  returning
    budget.group_name,
    budget.rollover_enabled,
    budget.sort_order
  into
    saved_group_name,
    saved_rollover_enabled,
    saved_sort_order;

  if not found then
    raise sqlstate 'P0002' using message = 'budget_not_found';
  end if;

  insert into public.budget_periods (
    user_id,
    budget_id,
    month,
    planned
  )
  values (
    (select auth.uid()),
    p_budget_id,
    p_month,
    p_planned
  )
  on conflict on constraint budget_periods_budget_id_month_key
  do update set planned = excluded.planned
  returning budget_periods.planned into saved_planned;

  return query
  select
    p_budget_id,
    p_month,
    saved_planned,
    saved_group_name,
    saved_rollover_enabled,
    saved_sort_order;
end;
$$;

revoke execute on function public.update_budget_period(
  uuid,
  date,
  numeric,
  text,
  boolean,
  integer
) from public, anon;

grant execute on function public.update_budget_period(
  uuid,
  date,
  numeric,
  text,
  boolean,
  integer
) to authenticated;
