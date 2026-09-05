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
    -- The authenticated role may refresh metadata on its own row and may
    -- mark another row revoked, but it must never rewrite the identity of a
    -- session record. Otherwise a stolen token could manufacture an
    -- unrevoked row for a different session before the real row is revoked.
    if coalesce(auth.role(), '') <> 'service_role'
      and (NEW.session_id <> OLD.session_id or NEW.user_id <> OLD.user_id) then
      raise exception 'Cannot modify user_id or session_id of a session record';
    end if;
    -- If already revoked, keep it revoked and immutable
    if OLD.revoked_at is not null then
      NEW.revoked_at := OLD.revoked_at;
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

-- A pair-unique constraint alone still allows one transaction to be linked
-- twice, which double-counts it in the canonical projection. These indexes
-- make the one-use invariant database-enforced even when two confirmations
-- race or a caller bypasses the route-level precheck.
create unique index if not exists linked_transfers_user_out_transaction_unique
  on public.linked_transfers (user_id, out_transaction_id);
create unique index if not exists linked_transfers_user_in_transaction_unique
  on public.linked_transfers (user_id, in_transaction_id);
create unique index if not exists linked_refunds_user_charge_transaction_unique
  on public.linked_refunds (user_id, charge_transaction_id);
create unique index if not exists linked_refunds_user_refund_transaction_unique
  on public.linked_refunds (user_id, refund_transaction_id);

-- Link confirmation and its review decision must commit together. The route
-- still validates the pair for fast user feedback, but this function is the
-- authoritative boundary for concurrent tabs and direct PostgREST callers.
create or replace function public.confirm_transfer_link(
  p_user_id uuid,
  p_subject_id text,
  p_out_transaction_id uuid,
  p_in_transaction_id uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  out_amount numeric;
  in_amount numeric;
  out_date date;
  in_date date;
  out_account uuid;
  in_account uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if p_user_id is distinct from auth.uid() then
      raise exception 'transfer_user_mismatch' using errcode = '42501';
    end if;
    if not private.session_not_revoked() or not private.mfa_satisfied() then
      raise exception 'transfer_session_not_authorized' using errcode = '42501';
    end if;
  end if;

  if p_out_transaction_id = p_in_transaction_id then
    raise exception 'transfer_ids_equal' using errcode = '22023';
  end if;
  if p_subject_id is distinct from
    least(p_out_transaction_id::text, p_in_transaction_id::text)
      || ':' || greatest(p_out_transaction_id::text, p_in_transaction_id::text) then
    raise exception 'transfer_subject_mismatch' using errcode = '22023';
  end if;

  select amount, date, coalesce(account_id, manual_account_id)
    into out_amount, out_date, out_account
    from public.transactions
   where id = p_out_transaction_id and user_id = p_user_id;
  if not found then
    raise exception 'transfer_transactions_not_owned' using errcode = '42501';
  end if;
  select amount, date, coalesce(account_id, manual_account_id)
    into in_amount, in_date, in_account
    from public.transactions
   where id = p_in_transaction_id and user_id = p_user_id;
  if not found then
    raise exception 'transfer_transactions_not_owned' using errcode = '42501';
  end if;

  if out_amount <= 0 or in_amount >= 0
    or round(abs(out_amount) * 100) <> round(abs(in_amount) * 100)
    or p_amount <= 0
    or round(p_amount * 100) <> round(abs(out_amount) * 100) then
    raise exception 'transfer_amounts_invalid' using errcode = '22023';
  end if;
  if out_account is not null and in_account is not null and out_account = in_account then
    raise exception 'transfer_same_account' using errcode = '22023';
  end if;
  if abs(out_date - in_date) > 7 then
    raise exception 'transfer_dates_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.linked_transfers
     where user_id = p_user_id
       and (out_transaction_id in (p_out_transaction_id, p_in_transaction_id)
         or in_transaction_id in (p_out_transaction_id, p_in_transaction_id))
       and not (out_transaction_id = p_out_transaction_id
         and in_transaction_id = p_in_transaction_id)
  ) then
    raise exception 'transfer_link_conflict' using errcode = '23505';
  end if;

  insert into public.linked_transfers (
    user_id, out_transaction_id, in_transaction_id, amount
  ) values (
    p_user_id, p_out_transaction_id, p_in_transaction_id, round(p_amount, 2)
  )
  on conflict (user_id, out_transaction_id, in_transaction_id)
  do update set amount = excluded.amount;

  insert into public.transaction_review_decisions (
    user_id, kind, subject_id, decision
  ) values (
    p_user_id, 'transfer', p_subject_id, 'confirmed'
  )
  on conflict (user_id, kind, subject_id)
  do update set decision = 'confirmed', updated_at = now();
exception
  when unique_violation then
    raise exception 'transfer_link_conflict' using errcode = '23505';
end;
$$;

revoke all on function public.confirm_transfer_link(uuid, text, uuid, uuid, numeric)
  from public, anon;
grant execute on function public.confirm_transfer_link(uuid, text, uuid, uuid, numeric)
  to authenticated, service_role;

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
drop policy if exists "holding_snapshots_select_shared_holding" on public.holding_snapshots;
create policy "holding_snapshots_select_own" on public.holding_snapshots
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );
create policy "holding_snapshots_select_shared_holding" on public.holding_snapshots
  for select to authenticated
  using (
    exists (
      select 1 from public.holdings h
      where h.id = holding_snapshots.holding_id
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- securities
drop policy if exists "securities_select_visible" on public.securities;
drop policy if exists "securities_select_own" on public.securities;
drop policy if exists "securities_insert_own" on public.securities;
drop policy if exists "securities_update_own" on public.securities;
drop policy if exists "securities_delete_own" on public.securities;
create policy "securities_select_visible" on public.securities
  for select to authenticated
  using (
    (user_id is null or user_id = (select auth.uid()))
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );
create policy "securities_insert_own" on public.securities
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );
create policy "securities_update_own" on public.securities
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
create policy "securities_delete_own" on public.securities
  for delete to authenticated
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
drop policy if exists "receipts_all_own" on public.receipts;
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
drop policy if exists "transaction_splits_select_visible" on public.transaction_splits;
create policy "transaction_splits_select_visible" on public.transaction_splits
  for select to authenticated
  using (
    (
      user_id = (select auth.uid())
      or exists (
        select 1 from public.transactions visible_transaction
        where visible_transaction.id = transaction_splits.transaction_id
      )
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

drop policy if exists "linked_refunds_select_own" on public.linked_refunds;
drop policy if exists "linked_refunds_select_visible" on public.linked_refunds;
create policy "linked_refunds_select_visible" on public.linked_refunds
  for select to authenticated
  using (
    (
      user_id = (select auth.uid())
      or (
        exists (
          select 1 from public.transactions visible_charge
          where visible_charge.id = linked_refunds.charge_transaction_id
        )
        and exists (
          select 1 from public.transactions visible_refund
          where visible_refund.id = linked_refunds.refund_transaction_id
        )
      )
    )
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

drop policy if exists "rst_select_own" on public.recurring_stream_transactions;
drop policy if exists "rst_select_shared_stream" on public.recurring_stream_transactions;
drop policy if exists "rst_select_visible" on public.recurring_stream_transactions;
create policy "rst_select_visible" on public.recurring_stream_transactions
  for select to authenticated
  using (
    (
      user_id = (select auth.uid())
      or private.can_read_shared_stream(recurring_stream_id)
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

drop policy if exists "linked_duplicates_select_own" on public.linked_duplicates;
create policy "linked_duplicates_select_own" on public.linked_duplicates
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- The earlier ownership migrations left write policies on these child tables
-- that checked only user_id (and, for annotations/splits/refunds, the parent
-- transaction). Recreate every write policy with the same ownership checks
-- plus the session and MFA gates, so a revoked or low-assurance session cannot
-- mutate financial metadata through a direct PostgREST call.
drop policy if exists "transaction_annotations_insert_own" on public.transaction_annotations;
drop policy if exists "transaction_annotations_update_own" on public.transaction_annotations;
drop policy if exists "transaction_annotations_delete_own" on public.transaction_annotations;

create policy "transaction_annotations_insert_own" on public.transaction_annotations
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_annotations.transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "transaction_annotations_update_own" on public.transaction_annotations
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_annotations.transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_annotations.transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "transaction_annotations_delete_own" on public.transaction_annotations
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_annotations.transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

drop policy if exists "transaction_splits_insert_own" on public.transaction_splits;
drop policy if exists "transaction_splits_update_own" on public.transaction_splits;
drop policy if exists "transaction_splits_delete_own" on public.transaction_splits;

create policy "transaction_splits_insert_own" on public.transaction_splits
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_splits.transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "transaction_splits_update_own" on public.transaction_splits
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_splits.transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_splits.transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "transaction_splits_delete_own" on public.transaction_splits
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_splits.transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

drop policy if exists "linked_refunds_insert_own" on public.linked_refunds;
drop policy if exists "linked_refunds_update_own" on public.linked_refunds;
drop policy if exists "linked_refunds_delete_own" on public.linked_refunds;

create policy "linked_refunds_insert_own" on public.linked_refunds
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.charge_transaction_id
        and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.refund_transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "linked_refunds_update_own" on public.linked_refunds
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.charge_transaction_id
        and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.refund_transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.charge_transaction_id
        and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.refund_transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "linked_refunds_delete_own" on public.linked_refunds
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.charge_transaction_id
        and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.transactions t
      where t.id = linked_refunds.refund_transaction_id
        and t.user_id = (select auth.uid())
    )
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

drop policy if exists "transaction_review_decisions_insert_own" on public.transaction_review_decisions;
drop policy if exists "transaction_review_decisions_update_own" on public.transaction_review_decisions;
drop policy if exists "transaction_review_decisions_delete_own" on public.transaction_review_decisions;

create policy "transaction_review_decisions_insert_own" on public.transaction_review_decisions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create policy "transaction_review_decisions_update_own" on public.transaction_review_decisions
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

create policy "transaction_review_decisions_delete_own" on public.transaction_review_decisions
  for delete to authenticated
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
    and (select private.mfa_satisfied())
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );
