-- Turn off weekly reports for accounts that can never receive mail.
--
-- The integration suite (tests/integration/*) signs up throwaway accounts on
-- example.com against the real project. Each spec deletes them in afterAll, but
-- a run interrupted before that hook leaves the rows behind, and profiles
-- default weekly_report_enabled to true (0003_hardening.sql). example.com is
-- reserved by RFC 2606 and can never accept mail, so the weekly-report cron
-- retried those addresses on every hourly run and alerted every day.
--
-- Run against the linked project:
--   npx supabase db query --linked --file scripts/disable-test-account-weekly-reports.sql
--
-- Safe to re-run: it only ever clears the flag, and the predicate is already
-- false for every row it has fixed.

update public.profiles p
set weekly_report_enabled = false
from auth.users u
where u.id = p.id
  and p.weekly_report_enabled
  and u.email like '%@example.com'
returning p.id;
