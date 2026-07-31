-- Phase 7: Goals revamp — funded goals with an auditable contribution ledger.
--
-- Today a goal's progress is a single hand-edited `saved_amount`. This adds two
-- more honest sources: allocations against real account balances
-- (`goal_accounts`) and a dated event ledger (`goal_progress_events`).
-- `saved_amount` is preserved as the "manual progress" component rather than
-- being migrated away, so nothing a user already typed is lost or double-counted.

-- ---------------------------------------------------------------------------
-- 1. Goal columns
-- ---------------------------------------------------------------------------

alter table public.goals
  add column if not exists goal_type text not null default 'save_up'
    check (goal_type in ('save_up', 'pay_down')),
  -- A bundled asset key (see lib/goal-templates.ts), never a URL: the CSP's
  -- img-src allows 'self' only, so an external image would silently fail.
  add column if not exists image_slug text
    check (image_slug is null or char_length(image_slug) between 1 and 60),
  add column if not exists monthly_contribution numeric(14, 2)
    check (monthly_contribution is null or monthly_contribution >= 0),
  add column if not exists spending_reduces boolean not null default false,
  -- Pay-down baseline, captured once when the first liability account is linked
  -- and never recomputed — a later sync must not move the starting line.
  add column if not exists starting_balance numeric(14, 2),
  add column if not exists target_balance numeric(14, 2);

-- ---------------------------------------------------------------------------
-- 2. Account allocations
-- ---------------------------------------------------------------------------

create table if not exists public.goal_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  goal_id             uuid not null references public.goals (id) on delete cascade,
  account_id          uuid not null references public.accounts (id) on delete cascade,
  allocated_amount    numeric(14, 2) check (allocated_amount >= 0),
  use_entire_balance  boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (goal_id, account_id),
  -- Exactly one funding mode per link: a whole-balance claim carries no amount,
  -- and a fixed claim must be a positive one.
  constraint goal_accounts_mode_check check (
    (use_entire_balance and allocated_amount is null)
    or (not use_entire_balance and allocated_amount > 0)
  )
);

create index if not exists goal_accounts_user_idx
  on public.goal_accounts (user_id);
create index if not exists goal_accounts_account_idx
  on public.goal_accounts (account_id);

alter table public.goal_accounts enable row level security;

revoke all on table public.goal_accounts from anon;
grant select, insert, update, delete on table public.goal_accounts to authenticated;

-- Writes: the row must be the caller's AND point at the caller's own goal and
-- own account. `user_id = auth.uid()` alone is not enough — foreign-key checks
-- bypass RLS, so without the two EXISTS clauses a user could attach their own
-- allocation row to somebody else's goal_id, and any query selecting
-- allocations by goal_id would then attribute it to the victim's goal.
-- Same shape as budget_periods in 20260729210000_budget_groups.sql.
create policy "goal_accounts_write_own"
  on public.goal_accounts for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.goals g
      where g.id = goal_accounts.goal_id and g.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.accounts a
      where a.id = goal_accounts.account_id and a.user_id = (select auth.uid())
    )
  );

-- Reads: household members see the allocations of a goal the owner chose to
-- share. `public.goals` has a household select policy (20260723150000), so this
-- subquery is filtered by it — the member only matches goals actually shared
-- with them. (This is the check that 20260730020500 got wrong for
-- recurring_streams by joining plaid_items, which members cannot read at all.)
create policy "goal_accounts_select_shared_goal"
  on public.goal_accounts for select
  to authenticated
  using (
    exists (
      select 1 from public.goals g
      where g.id = goal_accounts.goal_id
        and g.household_id is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Contribution ledger
-- ---------------------------------------------------------------------------

create table if not exists public.goal_progress_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  goal_id        uuid not null references public.goals (id) on delete cascade,
  event_date     date not null,
  -- Signed: a negative event is a withdrawal, or a spending_reduces expense.
  amount         numeric(14, 2) not null,
  event_type     text not null check (
    event_type in ('manual_contribution', 'manual_adjustment', 'transaction')
  ),
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at     timestamptz not null default now(),
  -- Idempotency for transaction-linked events: linking the same transaction to
  -- the same goal twice cannot create two events.
  unique (goal_id, transaction_id)
);

create index if not exists goal_progress_events_user_date_idx
  on public.goal_progress_events (user_id, event_date);
create index if not exists goal_progress_events_goal_idx
  on public.goal_progress_events (goal_id);

alter table public.goal_progress_events enable row level security;

revoke all on table public.goal_progress_events from anon;
grant select, insert, update, delete on table public.goal_progress_events to authenticated;

create policy "goal_progress_events_write_own"
  on public.goal_progress_events for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.goals g
      where g.id = goal_progress_events.goal_id and g.user_id = (select auth.uid())
    )
  );

create policy "goal_progress_events_select_shared_goal"
  on public.goal_progress_events for select
  to authenticated
  using (
    exists (
      select 1 from public.goals g
      where g.id = goal_progress_events.goal_id
        and g.household_id is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Goal linking on transactions
-- ---------------------------------------------------------------------------

alter table public.transaction_annotations
  add column if not exists goal_id uuid
    references public.goals (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 5. Transactional allocation mutation
--
-- One function owns every allocation write, because the rules it enforces are
-- cross-row and therefore unenforceable by a CHECK constraint:
--
--   * at most one goal may claim an account's entire balance;
--   * the fixed allocations against an account may not exceed its latest
--     balance.
--
-- Both need the other allocations for that account to hold still while they are
-- evaluated, so the function takes a row lock on them first. Two concurrent
-- requests each allocating half a balance would otherwise both pass.
--
-- SECURITY DEFINER to take that lock, so it must verify ownership itself: the
-- goal, the account, and (implicitly) the allocation all have to belong to the
-- caller. Passing p_allocated_amount NULL means "use the entire balance".
-- ---------------------------------------------------------------------------

create or replace function public.set_goal_allocation(
  p_goal_id uuid,
  p_account_id uuid,
  p_allocated_amount numeric default null,
  p_use_entire_balance boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
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

-- ---------------------------------------------------------------------------
-- 6. Backfill
--
-- Existing goals keep their hand-entered saved_amount as manual progress; no
-- data moves. Only the new descriptive columns are seeded, and every goal that
-- predates this migration is a save-up goal by definition (pay-down did not
-- exist), which the column default already gives us.
-- ---------------------------------------------------------------------------

update public.goals
   set target_balance = target_amount
 where target_balance is null
   and goal_type = 'save_up';

-- Verification (expect 0 rows from each):
--
--   -- no allocation may outlive its goal's or account's owner, and none may
--   -- cross users
--   select count(*) from public.goal_accounts ga
--     join public.goals g on g.id = ga.goal_id
--    where g.user_id <> ga.user_id;
--
--   select count(*) from public.goal_accounts ga
--     join public.accounts a on a.id = ga.account_id
--    where a.user_id <> ga.user_id;
--
--   -- no account may be claimed whole more than once
--   select account_id, count(*) from public.goal_accounts
--    where use_entire_balance group by account_id having count(*) > 1;
--
--   -- no duplicate transaction-linked events
--   select goal_id, transaction_id, count(*) from public.goal_progress_events
--    where transaction_id is not null
--    group by goal_id, transaction_id having count(*) > 1;
--
-- Rollback:
--   drop function if exists public.set_goal_allocation(uuid, uuid, numeric, boolean);
--   drop table if exists public.goal_progress_events;
--   drop table if exists public.goal_accounts;
--   alter table public.transaction_annotations drop column if exists goal_id;
--   alter table public.goals
--     drop column if exists goal_type, drop column if exists image_slug,
--     drop column if exists monthly_contribution,
--     drop column if exists spending_reduces,
--     drop column if exists starting_balance,
--     drop column if exists target_balance;
-- saved_amount is untouched throughout, so a rollback loses allocations and
-- events but never a user's typed-in progress.
