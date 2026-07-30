-- Use the named unique constraint because the function's output column names
-- are PL/pgSQL variables and make an unqualified conflict target ambiguous.
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
