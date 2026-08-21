-- Mint/Monarch/YNAB migration imports carry a useful per-row category (unlike
-- a plain bank CSV). Persist it on the staged review row so the commit route
-- can thread it into transactions.pfc_primary instead of dropping it.
-- Nullable and backward compatible: existing staged rows simply have no
-- category, exactly as before.
alter table public.import_review_rows
  add column if not exists category text;