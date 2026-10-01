-- Apply before deploying the corresponding sync code.
-- Provider linkage is nullable for old rows and manual/imported transactions.
alter table public.transactions add column pending_transaction_id text;

-- A non-partial index supports PostgREST ON CONFLICT inference.
-- PostgreSQL still permits multiple NULL subjects, preserving window dedupe.
drop index public.notifications_user_type_subject_key_unique;
create unique index notifications_user_type_subject_key_unique
  on public.notifications (user_id, type, subject_key);
-- Existing transaction and notification RLS policies remain unchanged.
