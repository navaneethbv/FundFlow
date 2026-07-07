-- ---------------------------------------------------------------------------
-- 0004_goals: savings goals
--
-- User-owned savings targets. Progress (saved_amount / target_amount) is
-- tracked manually; the goals page also surfaces the current month's net
-- savings for context. Like budgets, this table is written directly by the
-- browser client under owner-only RLS (no service-client path).
-- ---------------------------------------------------------------------------

create table public.goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  target_amount  numeric(14, 2) not null check (target_amount > 0),
  saved_amount   numeric(14, 2) not null default 0 check (saved_amount >= 0),
  target_date    date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index goals_user_id_idx on public.goals (user_id);

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

alter table public.goals enable row level security;

-- goals: owner has full control.
create policy "goals_select_own" on public.goals
  for select using (user_id = (select auth.uid()));
create policy "goals_insert_own" on public.goals
  for insert with check (user_id = (select auth.uid()));
create policy "goals_update_own" on public.goals
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "goals_delete_own" on public.goals
  for delete using (user_id = (select auth.uid()));
