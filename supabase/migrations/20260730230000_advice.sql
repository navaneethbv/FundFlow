-- Phase 11: sourced education checklists. `content_version` is stamped onto
-- each completion so a future content rewrite can distinguish "completed
-- under the old wording" from "completed under the new one" without any
-- extra bookkeeping — task ids stay stable across content edits (see
-- lib/advice-content.ts), so a rename never invalidates existing progress.

create table if not exists public.advice_progress (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  advice_id        text not null,
  task_id          text not null,
  content_version  int not null check (content_version > 0),
  completed_at     timestamptz not null default now(),
  unique (user_id, advice_id, task_id)
);

create index if not exists advice_progress_user_idx on public.advice_progress (user_id);

alter table public.advice_progress enable row level security;

revoke all on table public.advice_progress from anon;
grant select, insert, update, delete on table public.advice_progress to authenticated;

create policy "advice_progress_all_own" on public.advice_progress
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Priorities (an ordered array of advice ids) and profile answers (a small,
-- explicitly optional questionnaire) both live on profiles, matching the
-- existing preference-column pattern rather than new single-purpose tables.
alter table public.profiles
  add column if not exists advice_priorities jsonb,
  add column if not exists advice_profile jsonb;

-- Verification (expect 0 rows):
--   select count(*) from public.advice_progress where content_version <= 0;
--
-- Rollback:
--   drop table if exists public.advice_progress;
--   alter table public.profiles
--     drop column if exists advice_priorities,
--     drop column if exists advice_profile;
