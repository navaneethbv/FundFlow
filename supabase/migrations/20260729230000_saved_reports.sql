-- Phase 6: Saved Reports
create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  report_type text not null check (report_type in ('cash_flow', 'spending', 'income')),
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists saved_reports_user_idx on public.saved_reports (user_id, updated_at desc);

alter table public.saved_reports enable row level security;

create policy "saved_reports_all_own" on public.saved_reports
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
