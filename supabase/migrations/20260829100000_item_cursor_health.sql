-- Item-scoped transaction cursor health.
--
-- sync_jobs records the per-run observability trail, but it cannot answer two
-- questions the repair flow needs from the item row itself:
--   - did the last sync drain every page (has_more=false), or stop early?
--   - was the initial historical backfill ever completed, and was a cursor
--     that previously existed ever cleared (a cursor reset)?
--
-- These columns live on plaid_items next to sync_cursor so one row owns the
-- full cursor state. Values are always written through the service client with
-- an explicit user_id + id scope; nothing here stores tokens or payloads.

alter table public.plaid_items
  add column if not exists last_sync_attempt_at timestamptz,
  add column if not exists last_sync_success_at timestamptz,
  add column if not exists last_sync_completed_pages boolean not null default false,
  add column if not exists initial_history_incomplete boolean not null default false,
  add column if not exists cursor_reset_detected_at timestamptz;

-- Cursor health is always read/written scoped by user and item; the existing
-- plaid_items_user_id_idx already covers that access path.