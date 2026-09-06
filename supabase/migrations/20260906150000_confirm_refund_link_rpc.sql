-- Migration for refund confirmation boundary.
-- Adds unique constraints to prevent either charge or refund from being linked twice,
-- and an atomic RPC to validate ownership, pair invariants, link the refund, and record the review decision.

create unique index if not exists linked_refunds_user_charge_transaction_unique
  on public.linked_refunds (user_id, charge_transaction_id);
create unique index if not exists linked_refunds_user_refund_transaction_unique
  on public.linked_refunds (user_id, refund_transaction_id);

create or replace function public.confirm_refund_link(
  p_user_id uuid,
  p_subject_id text,
  p_charge_id uuid,
  p_refund_id uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  charge_amount numeric;
  refund_amount numeric;
  charge_date date;
  refund_date date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if p_user_id is distinct from auth.uid() then
      raise exception 'refund_user_mismatch' using errcode = '42501';
    end if;
    if not private.session_not_revoked() or not private.mfa_satisfied() then
      raise exception 'refund_session_not_authorized' using errcode = '42501';
    end if;
  end if;

  if p_charge_id = p_refund_id then
    raise exception 'refund_ids_equal' using errcode = '22023';
  end if;
  if p_subject_id is distinct from (p_charge_id::text || ':' || p_refund_id::text) then
    raise exception 'refund_subject_mismatch' using errcode = '22023';
  end if;

  select amount, date
    into charge_amount, charge_date
    from public.transactions
   where id = p_charge_id and user_id = p_user_id;
  if not found then
    raise exception 'refund_transactions_not_owned' using errcode = '42501';
  end if;

  select amount, date
    into refund_amount, refund_date
    from public.transactions
   where id = p_refund_id and user_id = p_user_id;
  if not found then
    raise exception 'refund_transactions_not_owned' using errcode = '42501';
  end if;

  if charge_amount is null or refund_amount is null or p_amount is null
    or charge_amount <= 0 or refund_amount >= 0
    or p_amount <= 0
    or round(p_amount * 100) > round(abs(charge_amount) * 100)
    or round(p_amount * 100) > round(abs(refund_amount) * 100) then
    raise exception 'refund_amounts_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.linked_refunds
     where user_id = p_user_id
       and (charge_transaction_id in (p_charge_id, p_refund_id)
         or refund_transaction_id in (p_charge_id, p_refund_id))
       and not (charge_transaction_id = p_charge_id
         and refund_transaction_id = p_refund_id)
  ) then
    raise exception 'refund_link_conflict' using errcode = '23505';
  end if;

  insert into public.linked_refunds (
    user_id, charge_transaction_id, refund_transaction_id, amount
  ) values (
    p_user_id, p_charge_id, p_refund_id, round(p_amount, 2)
  )
  on conflict (user_id, charge_transaction_id, refund_transaction_id)
  do update set amount = excluded.amount;

  insert into public.transaction_review_decisions (
    user_id, kind, subject_id, decision
  ) values (
    p_user_id, 'refund', p_subject_id, 'confirmed'
  )
  on conflict (user_id, kind, subject_id)
  do update set decision = 'confirmed', updated_at = now();
exception
  when unique_violation then
    raise exception 'refund_link_conflict' using errcode = '23505';
end;
$$;

revoke all on function public.confirm_refund_link(uuid, text, uuid, uuid, numeric)
  from public, anon;
grant execute on function public.confirm_refund_link(uuid, text, uuid, uuid, numeric)
  to authenticated, service_role;
