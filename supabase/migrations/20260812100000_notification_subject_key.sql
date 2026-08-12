-- Add a stable subject_key to notifications so dedupe never depends on
-- substring-matching rendered text.
--
-- The goal-reached path used to pass the goal UUID as its subject while the
-- dedupe searched the notification title and body (which contain the goal's
-- *name*, not its id) for that UUID. The window was therefore inert and the
-- notification was re-inserted on every cron run that still saw the goal as
-- reached.
--
-- This migration adds the column and a partial unique index scoped to
-- (user_id, type, subject_key) so a subject claims its notification exactly
-- once — the same pattern the net-worth milestone block already uses — and
-- concurrent runs cannot double-insert. Bulletins without a subject (legacy
-- callers) leave the column null and keep their existing window-based dedupe,
-- and the partial index deliberately ignores null keys so those rows never
-- collide.
alter table public.notifications
  add column subject_key text
    check (subject_key is null or char_length(subject_key) between 1 and 160);

create unique index notifications_user_type_subject_key_unique
  on public.notifications (user_id, type, subject_key)
  where subject_key is not null;