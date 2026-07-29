-- Phase 11: Advice Progress and Profile Priorities
create table if not exists public.advice_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  advice_id    text not null,
  task_id      text not null,
  content_version int not null check (content_version > 0),
  completed_at timestamptz not null default now(),
  unique (user_id, advice_id, task_id)
);

alter table public.advice_progress enable row level security;

create policy "advice_progress_all_own" on public.advice_progress
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.profiles
  add column if not exists advice_priorities jsonb,
  add column if not exists advice_profile jsonb;
