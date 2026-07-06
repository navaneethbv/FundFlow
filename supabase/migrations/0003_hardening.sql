-- Hardening batch (must-have follow-ups):
-- 1. Per-user weekly report opt-out, editable by the owner via RLS.
-- 2. Index for "latest successful sync" lookups (stale-data banner reads
--    sync_jobs with the user-scoped client; writes stay service-role only).

alter table public.profiles
  add column if not exists weekly_report_enabled boolean not null default true;

create index if not exists sync_jobs_user_created_idx
  on public.sync_jobs (user_id, created_at desc);
