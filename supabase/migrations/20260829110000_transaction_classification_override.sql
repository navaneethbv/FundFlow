-- Transaction-level classification overrides.
--
-- Reuses the existing owner-scoped transaction_annotations table (one row per
-- user transaction, RLS-scoped, already keyed by (user_id, transaction_id)).
-- The Plaid-synced transactions row stays immutable: pfc_primary and
-- pfc_detailed remain the raw provider facts, and the override lives beside
-- notes/tags/cleared_at instead of rewriting the transaction.
--
-- display_category holds the user's display category. cash_flow_classification
-- is an explicit spend/income override: it exists so a provider TRANSFER_OUT
-- or LOAN_PAYMENTS row can be deliberately reclassified as real spending or
-- income. The API refuses such a change without an explicit confirmation;
-- writing 'transfer' here is intentionally impossible.

alter table public.transaction_annotations
  add column if not exists display_category text,
  add column if not exists cash_flow_classification text
    check (cash_flow_classification in ('expense', 'income'));

-- Existing annotation policies and the (user_id, transaction_id) unique
-- constraint already cover this table; no new grants or policies are needed.