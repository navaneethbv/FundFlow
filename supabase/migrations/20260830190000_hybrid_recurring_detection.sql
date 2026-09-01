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

revoke insert, update, delete on public.recurring_streams from authenticated;
revoke insert, update, delete on public.recurring_stream_transactions from authenticated;
