-- ---------------------------------------------------------------------------
-- 20260812120000_budget_suggestion_history.sql: aggregate budget-suggestion
-- history in SQL.
--
-- The /settings categories section read four months of raw transactions with
-- no .limit() and folded them into a month|category total on the server. The
-- row count was whatever PostgREST's max-rows setting allows, so a large
-- history silently truncated and produced incomplete budget suggestions.
--
-- This RPC returns the same month|category totals the page derives, computed
-- by the database: positive amounts only, transfer/loan categories excluded
-- (the same TRANSFER_GROUPS rule as lib/finance-domain.ts), grouped by month
-- and category. The page then feeds these rows straight into suggestBudgets.
-- ---------------------------------------------------------------------------
create or replace function public.budget_suggestion_history(
  p_user_id uuid,
  p_start text,
  p_end text
)
returns table (
  month text,
  category text,
  amount numeric
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    to_char(t.date, 'YYYY-MM') as month,
    coalesce(t.pfc_primary, 'UNCATEGORIZED') as category,
    sum(t.amount) as amount
  from public.transactions t
  where t.user_id = p_user_id
    and t.date >= p_start::date
    and t.date < p_end::date
    and t.amount > 0
    and coalesce(t.pfc_primary, 'UNCATEGORIZED') not in (
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'LOAN_PAYMENTS',
      'LOAN_DISBURSEMENTS'
    )
  group by to_char(t.date, 'YYYY-MM'), coalesce(t.pfc_primary, 'UNCATEGORIZED')
  order by month asc, category asc;
$$;

revoke all on function public.budget_suggestion_history(uuid, text, text)
  from public, anon;
grant execute on function public.budget_suggestion_history(uuid, text, text)
  to authenticated;
