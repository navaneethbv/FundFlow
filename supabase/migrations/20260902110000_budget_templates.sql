-- Saved budget templates: a named snapshot of per-category planned amounts
-- (with group + rollover) that can seed any month's budget in one action.
-- The template is the seed; per-month `budget_periods` rows are still the
-- plan, and the per-row rollover choice on `budgets` is the carry.

create table public.budget_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  items       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index budget_templates_user_idx on public.budget_templates (user_id);

create trigger budget_templates_set_updated_at
  before update on public.budget_templates
  for each row execute function public.set_updated_at();

alter table public.budget_templates enable row level security;

revoke all on table public.budget_templates from anon;
grant select, insert, update, delete on table public.budget_templates to authenticated;

create policy "budget_templates_select_own" on public.budget_templates
  for select to authenticated using (user_id = (select auth.uid()));
create policy "budget_templates_insert_own" on public.budget_templates
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "budget_templates_update_own" on public.budget_templates
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "budget_templates_delete_own" on public.budget_templates
  for delete to authenticated using (user_id = (select auth.uid()));
