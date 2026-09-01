-- Reconciliation: count every transaction the anchor snapshot cannot already
-- contain.
--
-- The previous definition summed only `t.date > anchor.snapshot_date`, which
-- assumes the snapshot balance reflects every transaction dated on or before
-- its own day. It does not. Snapshots are written by the daily cron after that
-- run's sync, so a transaction dated on the snapshot day — or backdated into an
-- earlier day — that arrives later through the webhook or reconnect sync paths
-- is absent from the snapshot balance *and* excluded from the post-anchor sum,
-- which reports a spurious difference.
--
-- `captured_at` is refreshed whenever the same daily snapshot is upserted.
-- The immutable transaction `created_at` is then an exact discriminator for
-- rows that landed after that balance capture, including same-day and
-- backdated arrivals. The snapshot row's original `created_at` cannot serve
-- this purpose because a same-day upsert changes the balance without changing
-- that timestamp.

alter table public.account_balance_snapshots
  add column if not exists captured_at timestamptz;

update public.account_balance_snapshots
set captured_at = created_at
where captured_at is null;

alter table public.account_balance_snapshots
  alter column captured_at set default now(),
  alter column captured_at set not null;

create index if not exists transactions_user_account_created_idx
  on public.transactions (user_id, account_id, created_at);

create or replace function public.account_reconciliation_aggregates()
returns table (
  account_id uuid,
  snapshot_date date,
  snapshot_balance_cents bigint,
  post_anchor_total_cents bigint,
  oldest_transaction_date date,
  newest_transaction_date date
)
language sql
security invoker
set search_path = ''
stable
as $$
  select
    a.id as account_id,
    anchor.snapshot_date,
    round(anchor.current_balance * 100)::bigint as snapshot_balance_cents,
    coalesce(
      round(sum(t.amount) filter (
        where anchor.snapshot_date is not null
          and t.created_at > anchor.captured_at
      ) * 100)::bigint,
      0
    ) as post_anchor_total_cents,
    min(t.date) as oldest_transaction_date,
    max(t.date) as newest_transaction_date
  from public.accounts a
  left join lateral (
    select abs.snapshot_date, abs.current_balance, abs.captured_at
    from public.account_balance_snapshots abs
    where abs.user_id = (select auth.uid())
      and abs.account_id = a.id
    order by abs.snapshot_date desc, abs.captured_at desc
    limit 1
  ) anchor on true
  left join public.transactions t
    on t.user_id = (select auth.uid())
    and t.account_id = a.id
  where a.user_id = (select auth.uid())
  group by a.id, anchor.snapshot_date, anchor.current_balance, anchor.captured_at;
$$;

revoke all on function public.account_reconciliation_aggregates() from public, anon;
grant execute on function public.account_reconciliation_aggregates()
  to authenticated, service_role;
