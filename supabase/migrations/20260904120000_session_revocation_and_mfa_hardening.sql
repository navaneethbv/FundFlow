-- ---------------------------------------------------------------------------
-- 20260904120000_session_revocation_and_mfa_hardening:
-- 1. Enforce immutable revocation and deletion protection on user_session_records (FF-01).
-- 2. Extend private.session_not_revoked() and private.mfa_satisfied() across all
--    remaining sensitive financial tables & storage (FF-02).
-- ---------------------------------------------------------------------------

-- 1. Immutable session revocation on public.user_session_records (FF-01)
create or replace function public.enforce_session_revocation_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.revoked_at is not null and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Cannot delete a revoked session record';
    end if;
    return OLD;
  elsif TG_OP = 'UPDATE' then
    -- If already revoked, keep it revoked and immutable
    if OLD.revoked_at is not null then
      NEW.revoked_at := OLD.revoked_at;
      if (NEW.session_id <> OLD.session_id or NEW.user_id <> OLD.user_id) and coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Cannot modify user_id or session_id of a revoked session';
      end if;
    end if;
    return NEW;
  end if;
  return NEW;
end;
$$;

revoke execute on function public.enforce_session_revocation_immutable() from public, anon;
grant execute on function public.enforce_session_revocation_immutable() to authenticated, service_role;

drop trigger if exists tr_enforce_session_revocation_immutable on public.user_session_records;
create trigger tr_enforce_session_revocation_immutable
  before update or delete on public.user_session_records
  for each row
  execute function public.enforce_session_revocation_immutable();

-- Restrict user deletion of session records so authenticated users cannot delete revoked rows
drop policy if exists "user_session_records_delete_own" on public.user_session_records;
create policy "user_session_records_delete_own" on public.user_session_records
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and revoked_at is null
  );

-- 2. Financial tables: MFA & Revocation Enforcement (FF-02)

-- holdings
drop policy if exists "holdings_select_own" on public.holdings;
drop policy if exists "holdings_select_shared_account" on public.holdings;
drop policy if exists "holdings_write_own" on public.holdings;

create policy "holdings_select_own" on public.holdings
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "holdings_select_shared_account" on public.holdings
  for select to authenticated
  using (
    exists (
      select 1 from public.accounts a
      where a.id = holdings.account_id
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "holdings_write_own" on public.holdings
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  )
  with check (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- holding_snapshots
drop policy if exists "holding_snapshots_select_own" on public.holding_snapshots;
create policy "holding_snapshots_select_own" on public.holding_snapshots
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- securities
drop policy if exists "securities_select_own" on public.securities;
create policy "securities_select_own" on public.securities
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- investment_transactions
drop policy if exists "invtx_select_own" on public.investment_transactions;
drop policy if exists "invtx_select_shared_account" on public.investment_transactions;

create policy "invtx_select_own" on public.investment_transactions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "invtx_select_shared_account" on public.investment_transactions
  for select to authenticated
  using (
    exists (
      select 1 from public.accounts a
      where a.id = investment_transactions.account_id
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- receipts
drop policy if exists "receipts_select_own" on public.receipts;
create policy "receipts_select_own" on public.receipts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- scheduled_transactions
drop policy if exists "scheduled_transactions_select_own" on public.scheduled_transactions;
drop policy if exists "scheduled_transactions_insert_own" on public.scheduled_transactions;
drop policy if exists "scheduled_transactions_update_own" on public.scheduled_transactions;
drop policy if exists "scheduled_transactions_delete_own" on public.scheduled_transactions;

create policy "scheduled_transactions_select_own" on public.scheduled_transactions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "scheduled_transactions_insert_own" on public.scheduled_transactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "scheduled_transactions_update_own" on public.scheduled_transactions
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  )
  with check (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "scheduled_transactions_delete_own" on public.scheduled_transactions
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- linked_transfers
drop policy if exists "linked_transfers_select_own" on public.linked_transfers;
drop policy if exists "linked_transfers_insert_own" on public.linked_transfers;
drop policy if exists "linked_transfers_update_own" on public.linked_transfers;
drop policy if exists "linked_transfers_delete_own" on public.linked_transfers;

create policy "linked_transfers_select_own" on public.linked_transfers
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "linked_transfers_insert_own" on public.linked_transfers
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "linked_transfers_update_own" on public.linked_transfers
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  )
  with check (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "linked_transfers_delete_own" on public.linked_transfers
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- manual_accounts
drop policy if exists "manual_accounts_select_own" on public.manual_accounts;
drop policy if exists "manual_accounts_insert_own" on public.manual_accounts;
drop policy if exists "manual_accounts_update_own" on public.manual_accounts;
drop policy if exists "manual_accounts_delete_own" on public.manual_accounts;

create policy "manual_accounts_select_own" on public.manual_accounts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "manual_accounts_insert_own" on public.manual_accounts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "manual_accounts_update_own" on public.manual_accounts
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  )
  with check (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "manual_accounts_delete_own" on public.manual_accounts
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- transaction annotations, splits, review decisions, refunds, duplicates
drop policy if exists "transaction_annotations_select_own" on public.transaction_annotations;
create policy "transaction_annotations_select_own" on public.transaction_annotations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

drop policy if exists "transaction_splits_select_own" on public.transaction_splits;
create policy "transaction_splits_select_own" on public.transaction_splits
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

drop policy if exists "linked_refunds_select_own" on public.linked_refunds;
create policy "linked_refunds_select_own" on public.linked_refunds
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

drop policy if exists "transaction_review_decisions_select_own" on public.transaction_review_decisions;
create policy "transaction_review_decisions_select_own" on public.transaction_review_decisions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- storage objects for avatars
drop policy if exists "avatar_objects_all_own" on storage.objects;
create policy "avatar_objects_all_own" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.session_not_revoked())
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.session_not_revoked())
  );
