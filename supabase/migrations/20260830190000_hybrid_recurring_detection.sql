-- Hybrid recurring detection: metadata for locally inferred streams.
--
-- `recurring_streams` keeps storing every recurring stream. Existing rows are
-- provider (Plaid) rows and default to source 'plaid'; the local detector
-- writes rows with source 'inferred' carrying a versioned identity hash so
-- reruns converge on the same row, plus non-sensitive explainability evidence.
-- The partial unique index blocks duplicate inferred rows per user identity
-- while still letting Plaid return several provider streams that share a
-- merchant and cadence.

alter table public.recurring_streams
  add column source text not null default 'plaid'
    check (source in ('plaid', 'inferred')),
  add column identity_key text,
  add column detection_version integer
    check (detection_version is null or detection_version > 0),
  add column detection_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detection_evidence) = 'object');

create unique index recurring_streams_inferred_identity_unique
  on public.recurring_streams (user_id, identity_key)
  where source = 'inferred' and identity_key is not null;

create index recurring_streams_item_source_idx
  on public.recurring_streams (plaid_item_id, source, is_active);

-- Every write to the recurring tables already goes through the service client
-- (page mutations use owner-scoped RPC-free service flows), so direct
-- authenticated table writes are removed: the detector must be the only thing
-- that can materialize or deactivate rows.
revoke insert, update, delete on public.recurring_streams from authenticated;
revoke insert, update, delete on public.recurring_stream_transactions from authenticated;
