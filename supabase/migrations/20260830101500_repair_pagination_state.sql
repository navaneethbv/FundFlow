-- Bounded Repair calls may pause while Plaid still has more pages, but Plaid's
-- mutation recovery contract requires the committed sync cursor to remain at
-- the start of the entire pagination chain. Keep resumable Repair progress in
-- a separate cursor until has_more is false.

alter table public.plaid_items
  add column if not exists repair_sync_cursor text,
  add column if not exists repair_sync_started_at timestamptz;

-- No index is needed: these fields are read and written only after the item is
-- selected by its primary key and explicit user_id ownership scope.
