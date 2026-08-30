-- Aggregate reconciliation inputs in PostgreSQL so the Settings page does not
-- download up to 20,000 transaction rows for every connected account.
-- The function runs with caller privileges and returns only the caller's rows.

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
          and t.date > anchor.snapshot_date
      ) * 100)::bigint,
      0
    ) as post_anchor_total_cents,
    min(t.date) as oldest_transaction_date,
    max(t.date) as newest_transaction_date
  from public.accounts a
  left join lateral (
    select abs.snapshot_date, abs.current_balance
    from public.account_balance_snapshots abs
    where abs.user_id = (select auth.uid())
      and abs.account_id = a.id
    order by abs.snapshot_date desc
    limit 1
  ) anchor on true
  left join public.transactions t
    on t.user_id = (select auth.uid())
    and t.account_id = a.id
  where a.user_id = (select auth.uid())
  group by a.id, anchor.snapshot_date, anchor.current_balance;
$$;

revoke all on function public.account_reconciliation_aggregates() from public, anon;
grant execute on function public.account_reconciliation_aggregates()
  to authenticated, service_role;
