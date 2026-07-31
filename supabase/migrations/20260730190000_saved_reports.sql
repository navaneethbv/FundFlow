-- Phase 6: Reports page with Sankey — saved report definitions.
--
-- Owner-only, no household sharing: a saved report is a personal view
-- preference, and its `filters` payload can name merchants and categories the
-- owner has not chosen to share. Household members already see shared
-- *transactions* through the existing account-level opt-in; nothing here
-- widens that.
--
-- This table joins `budgets` and the `profiles` preference columns as
-- client-writable by design. That is safe here for the same reason it is safe
-- there: every column is user-authored configuration. There is no
-- provider-synced state, no token, and no column whose value could grant the
-- writer access to anything (`user_id` is pinned by the with-check, and
-- `filters` is only ever read back through a validating parser). Contrast
-- 20260730180000_recurring_streams_revert_client_write.sql, where the table
-- held Plaid state and a client-write policy was correctly reverted.

create table if not exists public.saved_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  report_type text not null check (report_type in ('cash_flow', 'spending', 'income')),
  filters     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);

-- The page lists a user's reports most-recently-updated first.
create index if not exists saved_reports_user_idx
  on public.saved_reports (user_id, updated_at desc);

create trigger saved_reports_set_updated_at
  before update on public.saved_reports
  for each row execute function public.set_updated_at();

alter table public.saved_reports enable row level security;

revoke all on table public.saved_reports from anon;
grant select, insert, update, delete on table public.saved_reports to authenticated;

-- `using` covers select/update/delete, `with check` covers insert/update, so
-- neither a read nor a write can cross users, and a row cannot be inserted or
-- re-pointed at another user_id.
create policy "saved_reports_all_own"
  on public.saved_reports for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Verification (expect 0 rows from each):
--
--   -- no cross-user rows reachable as a signed-in user
--   select count(*) from public.saved_reports where user_id <> auth.uid();
--
--   -- no duplicate names per user (the unique constraint should make this
--   -- impossible; run it after any bulk insert or restore)
--   select user_id, name, count(*)
--     from public.saved_reports
--    group by user_id, name
--   having count(*) > 1;
--
-- Rollback: drop table public.saved_reports cascade;
-- Nothing reads this table unless the `reportsPage` flag is on and a user has
-- saved a report, so dropping it degrades the Reports page to unsaved
-- ad-hoc filtering rather than breaking it.
