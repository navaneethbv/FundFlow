-- A new manual transaction and its requested metadata either all commit or all roll back.
create or replace function public.create_manual_transaction_atomic(
  p_user_id uuid, p_source text, p_account_id uuid, p_amount numeric, p_date date,
  p_merchant text, p_category text, p_note text, p_goal_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_reduces boolean;
begin
  if p_user_id is null or p_source is null or p_source not in ('plaid','manual') or p_date is null
    or p_amount is null or abs(p_amount)>1000000 or p_amount=0
    or p_merchant is null or length(trim(p_merchant)) not between 1 and 120 then
    raise exception 'Invalid manual transaction' using errcode='22023';
  end if;
  if p_source='plaid' then
    perform 1 from public.accounts where id=p_account_id and user_id=p_user_id for key share;
  else
    perform 1 from public.manual_accounts where id=p_account_id and user_id=p_user_id for key share;
  end if;
  if not found then raise exception 'Account not found' using errcode='22023'; end if;
  if p_goal_id is not null then
    select spending_reduces into v_reduces from public.goals where id=p_goal_id and user_id=p_user_id for key share;
    if not found then raise exception 'Goal not found' using errcode='22023'; end if;
  end if;
  insert into public.transactions(user_id,account_id,manual_account_id,plaid_transaction_id,amount,date,name,merchant_name,pfc_primary,source,pending)
    values(p_user_id,case when p_source='plaid' then p_account_id end,case when p_source='manual' then p_account_id end,
      'manual-'||gen_random_uuid()::text,p_amount,p_date,p_merchant,p_merchant,p_category,'manual',false)
    returning id into v_id;
  if p_note is not null or p_goal_id is not null then
    insert into public.transaction_annotations(user_id,transaction_id,note,goal_id)
      values(p_user_id,v_id,left(p_note,500),p_goal_id);
  end if;
  if coalesce(v_reduces,false) and p_amount>0 then
    insert into public.goal_progress_events(user_id,goal_id,transaction_id,event_date,amount,event_type)
      values(p_user_id,p_goal_id,v_id,p_date,-p_amount,'transaction');
  end if;
  return v_id;
end $$;
revoke all on function public.create_manual_transaction_atomic(uuid,text,uuid,numeric,date,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_manual_transaction_atomic(uuid,text,uuid,numeric,date,text,text,text,uuid) to service_role;
