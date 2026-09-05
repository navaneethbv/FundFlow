-- Restore the transfer confirmation boundary in environments where the
-- transfer tables were deployed before the hardening migration.
--
-- The indexes prevent either side of a transfer from being linked twice.
-- The RPC validates ownership and the pair invariants inside one transaction,
-- then records the link and its review decision atomically.

create unique index if not exists linked_transfers_user_out_transaction_unique
  on public.linked_transfers (user_id, out_transaction_id);
create unique index if not exists linked_transfers_user_in_transaction_unique
  on public.linked_transfers (user_id, in_transaction_id);

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
