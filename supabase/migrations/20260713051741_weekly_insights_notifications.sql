-- Weekly insight delivery preferences and idempotent send tracking.
-- Browser clients may read their own delivery status. Only trusted server code
-- writes delivery rows, so authenticated receives SELECT only.

alter table public.profiles
  add column if not exists timezone text not null default 'America/Los_Angeles',
  add column if not exists daily_digest_email_enabled boolean not null default true;

alter table public.profiles
  add constraint profiles_timezone_length
  check (char_length(timezone) between 1 and 80) not valid;

alter table public.profiles validate constraint profiles_timezone_length;

create table public.weekly_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('processing', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error_code text check (
    error_code is null or char_length(error_code) between 1 and 80
  ),
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, period_start),
  check (period_end >= period_start)
);

create index weekly_report_deliveries_user_attempted_idx
  on public.weekly_report_deliveries (user_id, attempted_at desc);

alter table public.weekly_report_deliveries enable row level security;

grant select on public.weekly_report_deliveries to authenticated;

create policy "weekly_report_deliveries_select_own"
  on public.weekly_report_deliveries
  for select to authenticated
  using (user_id = (select auth.uid()));
