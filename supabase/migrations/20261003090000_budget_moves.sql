-- Reference adoption 7.1: move planned money between two category budgets for
-- one month. Both period rows and the history entry change in one statement
-- set; history is service-authored, so clients may read it but never write it.
create table public.budget_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  from_budget_id uuid not null references public.budgets (id) on delete cascade,
  to_budget_id uuid not null references public.budgets (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  check (from_budget_id <> to_budget_id)
);

create index budget_moves_user_month_idx on public.budget_moves (user_id, month, created_at desc);

alter table public.budget_moves enable row level security;
revoke all on public.budget_moves from anon, authenticated;
grant select on public.budget_moves to authenticated;
grant select, insert on public.budget_moves to service_role;

create policy budget_moves_select_own on public.budget_moves
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- Service-only: the route authenticates the caller and passes their id.
-- A month without its own period row starts from the budget's monthly limit,
-- matching how the budget page resolves planned amounts.
create function public.move_budget_amount(
  p_user_id uuid,
  p_month date,
  p_from_budget_id uuid,
  p_to_budget_id uuid,
  p_amount numeric
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_planned numeric;
  v_to_planned numeric;
  v_locked integer;
  v_id uuid;
begin
  if p_user_id is null or p_month is null or p_month <> date_trunc('month', p_month)::date
    or p_from_budget_id is null or p_to_budget_id is null or p_from_budget_id = p_to_budget_id
    or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount >= 1000000000000 then
    raise exception 'Invalid budget move' using errcode = '22023';
  end if;

  -- Lock both owned budgets in id order so concurrent moves cannot deadlock.
  perform 1 from public.budgets
    where user_id = p_user_id and id in (p_from_budget_id, p_to_budget_id)
    order by id for update;
  get diagnostics v_locked = row_count;
  if v_locked <> 2 then raise exception 'Budget not found' using errcode = 'P0002'; end if;

  select coalesce(p.planned, b.monthly_limit) into v_from_planned
    from public.budgets b
    left join public.budget_periods p on p.budget_id = b.id and p.month = p_month and p.user_id = p_user_id
    where b.id = p_from_budget_id and b.user_id = p_user_id;
  select coalesce(p.planned, b.monthly_limit) into v_to_planned
    from public.budgets b
    left join public.budget_periods p on p.budget_id = b.id and p.month = p_month and p.user_id = p_user_id
    where b.id = p_to_budget_id and b.user_id = p_user_id;

  if v_from_planned < p_amount then
    raise exception 'Not enough planned in the source budget' using errcode = '22023';
  end if;
  if v_to_planned + p_amount >= 1000000000000 then
    raise exception 'Invalid budget move' using errcode = '22023';
  end if;

  insert into public.budget_periods (user_id, budget_id, month, planned)
    values (p_user_id, p_from_budget_id, p_month, v_from_planned - p_amount),
           (p_user_id, p_to_budget_id, p_month, v_to_planned + p_amount)
    on conflict (budget_id, month) do update set planned = excluded.planned;

  insert into public.budget_moves (user_id, month, from_budget_id, to_budget_id, amount)
    values (p_user_id, p_month, p_from_budget_id, p_to_budget_id, p_amount)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.move_budget_amount(uuid, date, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.move_budget_amount(uuid, date, uuid, uuid, numeric) to service_role;
