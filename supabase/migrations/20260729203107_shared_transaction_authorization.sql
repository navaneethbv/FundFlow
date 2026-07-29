-- Household transaction reads previously joined public.plaid_items directly.
-- Household members intentionally cannot select those token-bearing rows, so
-- nested RLS made the shared-transaction policy evaluate false.
--
-- Reuse the private account-authorization helper that already protects
-- Accounts and balance snapshots.
-- The helper checks auth.uid() internally and can inspect the protected item
-- without exposing any Plaid item columns through the Data API.

drop policy if exists "transactions_select_own"
  on public.transactions;
drop policy if exists "transactions_select_household"
  on public.transactions;
drop policy if exists "transactions_select_visible"
  on public.transactions;

create policy "transactions_select_visible"
  on public.transactions
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.can_read_shared_account(account_id)
  );

-- Verification:
-- select policyname, roles, cmd, qual
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'transactions'
-- order by policyname;
--
-- Expected: one SELECT policy named transactions_select_visible, scoped to
-- authenticated, with owner or private shared-account authorization.
--
-- Roll-forward:
-- If the helper contract changes, replace this policy with a corrected
-- authenticated SELECT policy.
-- Do not restore the direct plaid_items join because its nested RLS blocks
-- legitimate members and weakening plaid_items visibility would expose token
-- ciphertext.
