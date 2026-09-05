-- ---------------------------------------------------------------------------
-- 20260905110000_backup_delivery_journal (FF-10)
--
-- The monthly backup cron deduplicated on audit_logs rows written by
-- writeAudit(), which neither checks the error PostgREST returns nor rethrows.
-- An email could therefore be delivered while its completion marker was
-- silently lost, and the next run would send the same archive again. Two
-- concurrent invocations had nothing to arbitrate them at all.
--
-- This table is the delivery journal. The claim is the insert itself: the
-- primary key makes "one delivery per user per period" a database invariant,
-- so a second worker's `insert ... on conflict do nothing` returns no row and
-- steps aside. Rows are only ever written by the cron under the service role.
-- ---------------------------------------------------------------------------

create table if not exists public.backup_deliveries (
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- The delivery window, as YYYY-MM. One backup per user per calendar month.
  period       text not null check (period ~ '^\d{4}-\d{2}$'),
  claimed_at   timestamptz not null default now(),
  -- Null until the email is actually accepted by the mail provider. A stale
  -- claim with no delivered_at is what a retry is allowed to take over.
  delivered_at timestamptz,
  rows_backed_up integer,
  primary key (user_id, period)
);

create index if not exists backup_deliveries_period_idx
  on public.backup_deliveries (period);

alter table public.backup_deliveries enable row level security;

-- Cron-only bookkeeping. No authenticated client reads or writes it, so no
-- policy is granted; the service role bypasses RLS.
revoke all on table public.backup_deliveries from anon, authenticated;
