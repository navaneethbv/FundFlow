-- Statement balances are cleared end-of-day balances, independent of live bank balances.
alter table public.account_reconciliations
  add column basis jsonb,
  add column request_id uuid,
  add column request_data jsonb,
  add column result jsonb,
  add constraint reconciliation_request_unique unique (user_id, request_id);

-- Trusted opening balances must only be created by the atomic save operation.
revoke insert, update, delete on public.account_reconciliations from authenticated;
drop policy if exists account_reconciliations_insert_own on public.account_reconciliations;
drop policy if exists account_reconciliations_update_own on public.account_reconciliations;
drop policy if exists account_reconciliations_delete_own on public.account_reconciliations;

-- Keep the currently deployed form working during an additive schema rollout.
-- Legacy rows have no verified basis and never anchor the new workflow.
-- Column grants prevent callers from fabricating trusted state or retry results.
grant insert (user_id,account_id,manual_account_id,statement_date,statement_balance)
  on public.account_reconciliations to authenticated;
create policy account_reconciliations_insert_legacy on public.account_reconciliations
  for insert to authenticated with check (
    user_id=(select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
    and basis is null and request_id is null and request_data is null and result is null
    and (
      exists(select 1 from public.accounts a where a.id=account_id and a.user_id=(select auth.uid()))
      or exists(select 1 from public.manual_accounts a where a.id=manual_account_id and a.user_id=(select auth.uid()))
    )
  );

create or replace function private.reconciliation_state(
  p_user_id uuid, p_source text, p_account_id uuid, p_statement_date date,
  p_opening_date date, p_opening_balance numeric
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_name text; v_type text; v_subtype text; v_direction integer;
  v_previous public.account_reconciliations%rowtype;
  v_opening_date date; v_origin_date date; v_opening_balance numeric;
  v_rows jsonb; v_state jsonb; v_count integer;
begin
  if p_user_id is null or p_statement_date is null or p_source is null or p_source not in ('plaid','manual') then
    raise exception 'Invalid reconciliation input' using errcode = '22023';
  end if;
  if p_source = 'plaid' then
    select name, type, subtype into v_name, v_type, v_subtype
    from public.accounts where id = p_account_id and user_id = p_user_id;
  else
    select name, account_type, null into v_name, v_type, v_subtype
    from public.manual_accounts where id = p_account_id and user_id = p_user_id;
  end if;
  if not found then raise exception 'Account not found' using errcode = '22023'; end if;
  v_direction := case when lower(coalesce(v_type,'')) in ('credit','loan','debt','liability')
    or lower(coalesce(v_subtype,'')) similar to '%(credit card|loan|mortgage|student)%'
    then 1 else -1 end;
  -- Legacy records lack a verified opening basis and cannot anchor new statements.
  select * into v_previous from public.account_reconciliations
    where user_id = p_user_id and basis is not null
      and (case when p_source = 'plaid' then account_id else manual_account_id end) = p_account_id
    order by statement_date desc, created_at desc, id desc limit 1;
  if found then
    if p_statement_date <= v_previous.statement_date then
      raise exception 'Choose a date after the last reconciled statement' using errcode = '22023';
    end if;
    v_opening_date := v_previous.statement_date;
    v_origin_date := (v_previous.basis->>'originDate')::date;
    v_opening_balance := v_previous.statement_balance;
  else
    v_opening_date := p_opening_date;
    v_origin_date := p_opening_date;
    v_opening_balance := p_opening_balance;
  end if;
  if v_opening_date is null or v_opening_balance is null then
    return jsonb_build_object('needsOpeningBalance',true,'direction',v_direction,
      'account',jsonb_build_object('name',coalesce(v_name,'Account')));
  end if;
  if v_opening_date >= p_statement_date or abs(v_opening_balance) > 999999999999.99 then
    raise exception 'Invalid opening balance or date' using errcode = '22023';
  end if;
  -- A hard refusal protects the HTTP payload. It must never return a partial statement.
  select count(*) into v_count from public.transactions t
    left join public.transaction_annotations a on a.transaction_id=t.id and a.user_id=p_user_id
    where t.user_id=p_user_id and not t.pending
      and (case when p_source='plaid' then t.account_id else t.manual_account_id end)=p_account_id
      and t.date > v_origin_date and t.date <= p_statement_date
      and (t.date > v_opening_date or a.cleared_at is null);
  if v_count > 10000 then raise exception 'Statement has too many transactions; use a shorter period' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'date',t.date,'amount',t.amount,'merchant',coalesce(t.merchant_name,t.name,'Unknown'),
    'cleared',a.cleared_at is not null,'clearedAt',a.cleared_at
  ) order by t.date,t.id),'[]'::jsonb) into v_rows
    from public.transactions t
    left join public.transaction_annotations a on a.transaction_id=t.id and a.user_id=p_user_id
    where t.user_id=p_user_id and not t.pending
      and (case when p_source='plaid' then t.account_id else t.manual_account_id end)=p_account_id
      and t.date > v_origin_date and t.date <= p_statement_date
      and (t.date > v_opening_date or a.cleared_at is null);
  v_state := jsonb_build_object('needsOpeningBalance',false,'direction',v_direction,
    'account',jsonb_build_object('name',coalesce(v_name,'Account')),
    'openingDate',v_opening_date,'originDate',v_origin_date,'openingBalance',v_opening_balance,
    'statementDate',p_statement_date,'previousId',v_previous.id,'transactions',v_rows);
  return v_state || jsonb_build_object('revision',md5(v_state::text));
end $$;
revoke all on function private.reconciliation_state(uuid,text,uuid,date,date,numeric) from public,anon,authenticated;

create or replace function public.get_reconciliation_preview(
  p_source text, p_account_id uuid, p_statement_date date,
  p_opening_date date default null, p_opening_balance numeric default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.session_not_revoked() or not private.mfa_satisfied() then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  return private.reconciliation_state(auth.uid(),p_source,p_account_id,p_statement_date,p_opening_date,p_opening_balance);
end $$;
revoke all on function public.get_reconciliation_preview(text,uuid,date,date,numeric) from public,anon;
grant execute on function public.get_reconciliation_preview(text,uuid,date,date,numeric) to authenticated;

create or replace function public.save_reconciliation_atomic(
  p_user_id uuid, p_source text, p_account_id uuid, p_statement_date date,
  p_statement_balance numeric, p_opening_date date, p_opening_balance numeric,
  p_cleared_ids uuid[], p_revision text, p_request_id uuid, p_create_adjustment boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state jsonb; v_request jsonb; v_existing public.account_reconciliations%rowtype;
  v_ids uuid[]; v_selected uuid[]; v_difference numeric; v_adjustment numeric; v_result jsonb;
begin
  if p_user_id is null or p_request_id is null or p_statement_balance is null
    or abs(p_statement_balance)>999999999999.99 or p_revision is null or p_create_adjustment is null then
    raise exception 'Invalid reconciliation input' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_source || ':' || p_account_id::text,0));
  select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into v_selected from unnest(p_cleared_ids) x;
  v_request := jsonb_build_object('source',p_source,'account',p_account_id,'date',p_statement_date,
    'balance',p_statement_balance,'openingDate',p_opening_date,'openingBalance',p_opening_balance,
    'cleared',v_selected,'revision',p_revision,'adjustment',p_create_adjustment);
  select * into v_existing from public.account_reconciliations where user_id=p_user_id and request_id=p_request_id;
  if found then
    if v_existing.request_data is distinct from v_request then
      raise exception 'This save key was already used for different input' using errcode='40001';
    end if;
    return v_existing.result;
  end if;
  -- Parent locks also block new transactions and annotations through their foreign keys.
  -- This closes the gap where a new row could appear after revision validation.
  if p_source='plaid' then
    perform 1 from public.accounts where id=p_account_id and user_id=p_user_id for update;
  else
    perform 1 from public.manual_accounts where id=p_account_id and user_id=p_user_id for update;
  end if;
  -- Freeze existing inputs while validating the preview and committing its changes.
  perform 1 from public.transactions t where t.user_id=p_user_id
    and (case when p_source='plaid' then t.account_id else t.manual_account_id end)=p_account_id for update;
  perform 1 from public.transaction_annotations a where a.user_id=p_user_id and a.transaction_id in (
    select t.id from public.transactions t where t.user_id=p_user_id
      and (case when p_source='plaid' then t.account_id else t.manual_account_id end)=p_account_id
  ) for update;
  v_state := private.reconciliation_state(p_user_id,p_source,p_account_id,p_statement_date,p_opening_date,p_opening_balance);
  if (v_state->>'needsOpeningBalance')::boolean then
    raise exception 'An opening balance is required' using errcode='22023';
  end if;
  if v_state->>'revision' is distinct from p_revision then
    raise exception 'Account activity changed; reload the statement before saving' using errcode='40001';
  end if;
  select coalesce(array_agg((x->>'id')::uuid),'{}'::uuid[]) into v_ids from jsonb_array_elements(v_state->'transactions') x;
  if not v_selected <@ v_ids then raise exception 'Cleared transactions are outside this statement' using errcode='22023'; end if;
  select round((v_state->>'openingBalance')::numeric + (v_state->>'direction')::integer *
    coalesce(sum((x->>'amount')::numeric),0) - p_statement_balance,2) into v_difference
    from jsonb_array_elements(v_state->'transactions') x where (x->>'id')::uuid=any(v_selected);
  if v_difference<>0 and not p_create_adjustment then
    raise exception 'The cleared balance must match the statement or include an explicit adjustment' using errcode='22023';
  end if;
  v_adjustment := -(v_state->>'direction')::integer * v_difference;
  insert into public.transaction_annotations(user_id,transaction_id,cleared_at)
    select p_user_id,x,now() from unnest(v_selected) x
    on conflict (user_id,transaction_id) do update set cleared_at=excluded.cleared_at;
  update public.transaction_annotations set cleared_at=null
    where user_id=p_user_id and transaction_id=any(v_ids) and not transaction_id=any(v_selected);
  if v_adjustment<>0 then
    with inserted as (
      insert into public.transactions(user_id,account_id,manual_account_id,plaid_transaction_id,amount,date,name,merchant_name,pfc_primary,source,pending)
      values(p_user_id,case when p_source='plaid' then p_account_id end,case when p_source='manual' then p_account_id end,
        'manual-reconcile-'||p_request_id::text,v_adjustment,p_statement_date,'Balance adjustment','Balance adjustment','RECONCILE_ADJUSTMENT','manual',false)
      returning id
    ) insert into public.transaction_annotations(user_id,transaction_id,cleared_at) select p_user_id,id,now() from inserted;
  end if;
  v_result := jsonb_build_object('ok',true,'difference',0,'adjustment_amount',v_adjustment,'cleared_count',cardinality(v_selected));
  insert into public.account_reconciliations(user_id,account_id,manual_account_id,statement_date,statement_balance,basis,request_id,request_data,result)
    values(p_user_id,case when p_source='plaid' then p_account_id end,case when p_source='manual' then p_account_id end,
      p_statement_date,p_statement_balance,v_state-'transactions',p_request_id,v_request,v_result);
  return v_result;
end $$;
revoke all on function public.save_reconciliation_atomic(uuid,text,uuid,date,numeric,date,numeric,uuid[],text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.save_reconciliation_atomic(uuid,text,uuid,date,numeric,date,numeric,uuid[],text,uuid,boolean) to service_role;
