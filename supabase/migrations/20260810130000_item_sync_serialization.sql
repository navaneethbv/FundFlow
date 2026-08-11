-- Serialize per-item transaction syncs so overlapping triggers (webhook,
-- cron, manual sync, auto-refresh, initial exchange) cannot run the same item
-- concurrently. A concurrent run wastes Plaid API spend, leaves sync_jobs rows
-- stuck at `running`, duplicates notifications, and can regress the item's
-- sync cursor when a slow run started from an old cursor finishes last.
--
-- The guard is a `syncing_at` claim on plaid_items, taken atomically by a
-- SECURITY DEFINER helper. A crashed run leaves a stale claim; it is treated
-- as expired after `p_stale_seconds` so syncs recover automatically.

alter table public.plaid_items
  add column if not exists syncing_at timestamptz;

create index if not exists plaid_items_syncing_idx
  on public.plaid_items (id, syncing_at);

-- Private implementations, never exposed as RPCs.

create or replace function private.claim_item_sync(p_item_id uuid, p_stale_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
begin
  update public.plaid_items
  set syncing_at = now()
  where id = p_item_id
    and (
      syncing_at is null
      or syncing_at < now() - make_interval(secs => p_stale_seconds)
    )
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

create or replace function private.release_item_sync(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.plaid_items
  set syncing_at = null
  where id = p_item_id;
end;
$$;

-- Public wrappers so the service client can call them via PostgREST. Revoked
-- from public/anon/authenticated: no browser RPC surface, only the app's
-- service_role may execute them.

create or replace function public.claim_item_sync(p_item_id uuid, p_stale_seconds int)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.claim_item_sync(p_item_id, p_stale_seconds);
$$;

create or replace function public.release_item_sync(p_item_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.release_item_sync(p_item_id);
$$;

revoke all on function public.claim_item_sync(uuid, int) from public, anon, authenticated;
revoke all on function public.release_item_sync(uuid) from public, anon, authenticated;
grant execute on function public.claim_item_sync(uuid, int) to service_role;
grant execute on function public.release_item_sync(uuid) to service_role;

-- The private implementations are SECURITY DEFINER too, so revoke the default
-- PUBLIC execute on them as well. They are reached only through the public
-- wrappers above (which run as the definer), never as a browser RPC.
revoke all on function private.claim_item_sync(uuid, int) from public, anon, authenticated;
revoke all on function private.release_item_sync(uuid) from public, anon, authenticated;
grant execute on function private.claim_item_sync(uuid, int) to service_role;
grant execute on function private.release_item_sync(uuid) to service_role;

-- Verification (expect 0 rows):
--   select count(*) from public.plaid_items
--   where syncing_at is not null and syncing_at >= now() - interval '1 hour';
