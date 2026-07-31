-- Fix a pre-existing RLS defect discovered while writing Task 15's E2E
-- acceptance test for the Recurring page: recurring_streams has had RLS
-- enabled since 0001_init.sql but has never had an UPDATE policy. The only
-- policy on the table is the SELECT one
-- (recurring_streams_select_visible, added by
-- 20260730020500_recurring_shared_authorization.sql).
--
-- The review workflow's PATCH /api/recurring route (Confirm, Dismiss,
-- Restore, correct amount) runs through the RLS-bound cookie client, not
-- the service client. With no UPDATE policy, Postgres's implicit USING
-- clause for a command with zero defined policies matches no rows -- even
-- the row's true owner -- and PostgREST reports no error, so the route's
-- `.select("id").maybeSingle()` sees `data: null` and returns 404
-- "Recurring stream not found" for every legitimate request. Reproduced
-- directly against the live project: an authenticated owner update of
-- their own stream returned `{ data: null, error: null }`, and a
-- service-client re-read confirmed the row was unchanged. This silently
-- broke the entire review workflow (every Confirm/Dismiss/Restore/amount
-- edit), not a test-authoring artifact.
--
-- Fixed the same way every other owner-write table in this schema is:
-- one authenticated, owner-scoped UPDATE policy with a matching USING and
-- WITH CHECK clause.
create policy "recurring_streams_update_own"
  on public.recurring_streams
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
