-- Phase 13: Profile Fields, Display Prefs, and User Tags
alter table public.profiles
  add column if not exists full_name text check (full_name is null or char_length(full_name) between 1 and 120),
  add column if not exists display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  add column if not exists birthday date,
  add column if not exists avatar_path text,
  add column if not exists display_prefs jsonb not null default '{}'::jsonb;

create table if not exists public.user_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color_slot int not null default 0 check (color_slot between 0 and 5),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists user_tags_user_idx on public.user_tags (user_id, name);

alter table public.user_tags enable row level security;

create policy "user_tags_all_own" on public.user_tags
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
