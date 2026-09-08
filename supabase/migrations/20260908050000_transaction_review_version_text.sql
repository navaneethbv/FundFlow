-- Preserve bigint compare-and-set tokens through PostgREST and JavaScript.
-- Transactional replacement retains security_invoker, ownership and explicit grants.
set local lock_timeout = '15s';
drop view public.transaction_review_ledger;
create or replace view public.transaction_review_ledger
with (security_invoker = true)
as
select
  t.id,
  t.user_id,
  t.account_id,
  t.manual_account_id,
  t.plaid_transaction_id,
  t.amount,
  t.iso_currency_code,
  t.date,
  t.authorized_date,
  t.name,
  t.merchant_name,
  t.pfc_primary,
  t.pfc_detailed,
  t.payment_channel,
  t.pending,
  t.source,
  t.created_at,
  t.updated_at,
  r.status as review_status,
  r.version::text as review_version,
  r.reviewed_at,
  (
    not t.pending
    and not exists (
      select 1 from public.linked_duplicates d
      where d.user_id = t.user_id and d.excluded_transaction_id = t.id
    )
    and r.transaction_id is not null
  ) as review_eligible,
  (r.transaction_id is null) as review_state_missing
from public.transactions t
left join public.transaction_review_states r
  on r.transaction_id = t.id and r.user_id = t.user_id;

revoke all on public.transaction_review_ledger from anon;
grant select on public.transaction_review_ledger to authenticated;

-- `security_invoker = true` evaluates the underlying-table privileges as the
-- calling role, so the authenticated role needs an explicit SELECT on the
-- source tables. `transaction_review_states` (above) and `linked_duplicates`
-- (20260809194242) are already granted; `public.transactions` relied on the
-- project-level default privilege, which is not reproduced on a clean local
-- stack (the same divergence PR #165 hit). Grant it explicitly. RLS on
-- `public.transactions` is unchanged and still filters every row.
grant select on public.transactions to authenticated;

