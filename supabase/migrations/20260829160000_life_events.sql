-- Life-event forecasting assumptions. Typed events (home purchase, child,
-- income change, expense change, retirement) stored as editable, explicitly
-- user-scoped rows. The projection is never a guarantee; these rows only feed
-- the deterministic recalculation of the existing projection engine.

create table public.life_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  event_type      text not null check (event_type in ('home_purchase', 'child', 'income_change', 'expense_change', 'retirement')),
  start_month     int not null check (start_month >= 1),
  amount          numeric(14, 2) not null check (amount > 0),
  duration_months int check (duration_months is null or duration_months >= 1),
  label           text check (label is null or char_length(label) between 1 and 120),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index life_events_user_idx on public.life_events (user_id);

create trigger life_events_set_updated_at
  before update on public.life_events
  for each row execute function public.set_updated_at();

alter table public.life_events enable row level security;

revoke all on table public.life_events from anon;
grant select, insert, update, delete on table public.life_events to authenticated;

create policy "life_events_select_own" on public.life_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy "life_events_insert_own" on public.life_events
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "life_events_update_own" on public.life_events
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "life_events_delete_own" on public.life_events
  for delete to authenticated using (user_id = (select auth.uid()));