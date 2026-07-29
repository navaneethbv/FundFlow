-- Transaction splits and linked refunds are canonical metadata attached to
-- source transactions.
-- Household members who can read a shared transaction must see that metadata
-- or their totals and breakdowns disagree with the transaction owner.
--
-- Keep every write policy owner-only.
-- Read visibility follows the transactions table, whose policy already
-- authorizes owners and members of the account's shared household.

create index if not exists transaction_splits_transaction_id_idx
  on public.transaction_splits (transaction_id);
create index if not exists linked_refunds_charge_transaction_id_idx
  on public.linked_refunds (charge_transaction_id);
create index if not exists linked_refunds_refund_transaction_id_idx
  on public.linked_refunds (refund_transaction_id);

drop policy if exists "transaction_splits_select_own"
  on public.transaction_splits;
drop policy if exists "transaction_splits_select_visible"
  on public.transaction_splits;

create policy "transaction_splits_select_visible"
  on public.transaction_splits
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.transactions visible_transaction
      where visible_transaction.id = transaction_splits.transaction_id
    )
  );

drop policy if exists "linked_refunds_select_own"
  on public.linked_refunds;
drop policy if exists "linked_refunds_select_visible"
  on public.linked_refunds;

create policy "linked_refunds_select_visible"
  on public.linked_refunds
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      exists (
        select 1
        from public.transactions visible_charge
        where visible_charge.id = linked_refunds.charge_transaction_id
      )
      and exists (
        select 1
        from public.transactions visible_refund
        where visible_refund.id = linked_refunds.refund_transaction_id
      )
    )
  );

-- Verification:
-- select tablename, policyname, roles, cmd, qual
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('transaction_splits', 'linked_refunds')
-- order by tablename, policyname;
--
-- Expected: one authenticated SELECT policy named *_select_visible on each
-- table, while insert, update, and delete policies remain owner-only.
--
-- Roll-forward:
-- If transaction visibility changes, replace these policies with corrected
-- SELECT policies that preserve both owner access and shared-transaction
-- metadata access.
