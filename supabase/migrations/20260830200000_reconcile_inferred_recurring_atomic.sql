-- Apply one prepared inferred-recurring snapshot atomically.
-- The caller is the trusted service client; all ownership checks remain here
-- because SECURITY DEFINER functions must not trust caller-controlled ids.

create or replace function public.reconcile_inferred_recurring(
  p_user_id uuid,
  p_item_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_row jsonb;
  dedup_row jsonb;
  transaction_value text;
  identity_key_value text;
  stream_id_value text;
  stream_row_id uuid;
  inferred_stream_id uuid;
  plaid_stream_id uuid;
  candidate_account_id uuid;
  transaction_id_value uuid;
  inferred_active boolean;
  inserted_count integer := 0;
  deduplicated_count integer := 0;
  deactivated_count integer := 0;
  stale_count integer := 0;
  active_count integer := 0;
begin
  if not exists (
    select 1
    from public.plaid_items
    where id = p_item_id
      and user_id = p_user_id
  ) then
    raise exception 'recurring_item_not_owned' using errcode = '42501';
  end if;

  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ? 'candidates')
     or not (p_payload ? 'deduplications')
     or jsonb_typeof(p_payload->'candidates') <> 'array'
     or jsonb_typeof(p_payload->'deduplications') <> 'array' then
    raise exception 'recurring_payload_invalid' using errcode = '22023';
  end if;

  -- Validate the complete prepared snapshot before starting any DML. This
  -- keeps malformed later entries from leaving an earlier candidate changed.
  for candidate_row in
    select value from jsonb_array_elements(p_payload->'candidates')
  loop
    if jsonb_typeof(candidate_row) is distinct from 'object'
       or not (candidate_row ? 'identity_key')
       or jsonb_typeof(candidate_row->'identity_key') is distinct from 'string'
       or nullif(candidate_row->>'identity_key', '') is null
       or not (candidate_row ? 'stream_id')
       or jsonb_typeof(candidate_row->'stream_id') is distinct from 'string'
       or nullif(candidate_row->>'stream_id', '') is null
       or not (candidate_row ? 'stream_type')
       or jsonb_typeof(candidate_row->'stream_type') is distinct from 'string'
       or nullif(candidate_row->>'stream_type', '') is null
       or nullif(candidate_row->>'stream_type', '') not in ('inflow', 'outflow')
       or not (candidate_row ? 'frequency')
       or jsonb_typeof(candidate_row->'frequency') is distinct from 'string'
       or nullif(candidate_row->>'frequency', '') is null
       or not (candidate_row ? 'expected_amount')
       or jsonb_typeof(candidate_row->'expected_amount') is distinct from 'number'
       or nullif(candidate_row->>'expected_amount', '') is null
       or not (candidate_row ? 'last_amount')
       or jsonb_typeof(candidate_row->'last_amount') is distinct from 'number'
       or nullif(candidate_row->>'last_amount', '') is null
       or not (candidate_row ? 'first_date')
       or jsonb_typeof(candidate_row->'first_date') is distinct from 'string'
       or nullif(candidate_row->>'first_date', '') is null
       or not (candidate_row ? 'last_date')
       or jsonb_typeof(candidate_row->'last_date') is distinct from 'string'
       or nullif(candidate_row->>'last_date', '') is null
       or not (candidate_row ? 'predicted_next_date')
       or jsonb_typeof(candidate_row->'predicted_next_date') is distinct from 'string'
       or nullif(candidate_row->>'predicted_next_date', '') is null
       or not (candidate_row ? 'detection_version')
       or jsonb_typeof(candidate_row->'detection_version') is distinct from 'number'
       or nullif(candidate_row->>'detection_version', '') is null
       or jsonb_typeof(coalesce(candidate_row->'detection_evidence', '{}'::jsonb)) is distinct from 'object'
       or not (candidate_row ? 'transaction_ids')
       or jsonb_typeof(candidate_row->'transaction_ids') is distinct from 'array'
       -- The parentheses are load-bearing: plpgsql ends an IF condition at the
       -- first top-level THEN, so an unparenthesized CASE ... THEN truncates
       -- the expression and the function fails to compile.
       or (case when jsonb_typeof(candidate_row->'transaction_ids') = 'array'
           then jsonb_array_length(candidate_row->'transaction_ids')
           else 0 end) = 0
       or not (candidate_row ? 'account_id')
       or jsonb_typeof(candidate_row->'account_id') is distinct from 'string'
       or candidate_row->>'account_id' is null
       or candidate_row->>'account_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'recurring_candidate_payload_invalid' using errcode = '22023';
    end if;
    begin
      candidate_account_id := (candidate_row->>'account_id')::uuid;
      perform (candidate_row->>'expected_amount')::numeric;
      perform (candidate_row->>'last_amount')::numeric;
      perform (candidate_row->>'first_date')::date;
      perform (candidate_row->>'last_date')::date;
      perform (candidate_row->>'predicted_next_date')::date;
      perform (candidate_row->>'detection_version')::integer;
      if (candidate_row->>'detection_version')::integer <= 0 then
        raise exception 'invalid detection version';
      end if;
    exception when others then
      raise exception 'recurring_candidate_payload_invalid' using errcode = '22023';
    end;
    if not exists (
      select 1
      from public.accounts
      where id = candidate_account_id
        and user_id = p_user_id
        and plaid_item_id = p_item_id
    ) then
      raise exception 'recurring_candidate_account_not_owned' using errcode = '42501';
    end if;
    for transaction_value in
      select value from jsonb_array_elements_text(candidate_row->'transaction_ids')
    loop
      if transaction_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'recurring_candidate_payload_invalid' using errcode = '22023';
      end if;
      transaction_id_value := transaction_value::uuid;
      if not exists (
        select 1
        from public.transactions t
        join public.accounts a on a.id = t.account_id
        where t.id = transaction_id_value
          and t.user_id = p_user_id
          and t.account_id = candidate_account_id
          and a.user_id = p_user_id
          and a.plaid_item_id = p_item_id
      ) then
        raise exception 'recurring_candidate_transaction_not_owned' using errcode = '42501';
      end if;
    end loop;
  end loop;

  for dedup_row in
    select value from jsonb_array_elements(p_payload->'deduplications')
  loop
    if jsonb_typeof(dedup_row) <> 'object'
       or dedup_row->>'plaid_id' is null
       or dedup_row->>'plaid_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (nullif(dedup_row->>'inferred_id', '') is not null
           and dedup_row->>'inferred_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'recurring_dedup_payload_invalid' using errcode = '22023';
    end if;
    plaid_stream_id := (dedup_row->>'plaid_id')::uuid;
    if not exists (
      select 1 from public.recurring_streams
      where id = plaid_stream_id
        and user_id = p_user_id
        and plaid_item_id = p_item_id
        and source = 'plaid'
    ) then
      raise exception 'recurring_plaid_stream_not_owned' using errcode = '42501';
    end if;
    inferred_stream_id := nullif(dedup_row->>'inferred_id', '')::uuid;
    if inferred_stream_id is not null and not exists (
      select 1 from public.recurring_streams
      where id = inferred_stream_id
        and user_id = p_user_id
        and plaid_item_id = p_item_id
        and source = 'inferred'
    ) then
      raise exception 'recurring_inferred_stream_not_owned' using errcode = '42501';
    end if;
  end loop;

  -- Candidate writes and their joins are all part of this function transaction.
  for candidate_row in
    select value from jsonb_array_elements(coalesce(p_payload->'candidates', '[]'::jsonb))
  loop
    identity_key_value := candidate_row->>'identity_key';
    stream_id_value := candidate_row->>'stream_id';
    candidate_account_id := (candidate_row->>'account_id')::uuid;

    insert into public.recurring_streams (
      user_id, plaid_item_id, stream_id, stream_type, description,
      merchant_name, average_amount, last_amount, frequency, status,
      category, is_active, account_id, first_date, last_date,
      predicted_next_date, source, identity_key, detection_version,
      detection_evidence
    ) values (
      p_user_id, p_item_id, stream_id_value,
      candidate_row->>'stream_type', candidate_row->>'description',
      candidate_row->>'merchant_name', (candidate_row->>'expected_amount')::numeric,
      (candidate_row->>'last_amount')::numeric, candidate_row->>'frequency',
      'MATURE', candidate_row->>'category', true, candidate_account_id,
      (candidate_row->>'first_date')::date, (candidate_row->>'last_date')::date,
      (candidate_row->>'predicted_next_date')::date, 'inferred',
      identity_key_value, (candidate_row->>'detection_version')::integer,
      coalesce(candidate_row->'detection_evidence', '{}'::jsonb)
    )
    on conflict (user_id, identity_key)
      where source = 'inferred' and identity_key is not null
      do nothing
    returning id into stream_row_id;
    if stream_row_id is not null then
      inserted_count := inserted_count + 1;
    else
      select id into stream_row_id
      from public.recurring_streams
      where user_id = p_user_id
        and plaid_item_id = p_item_id
        and source = 'inferred'
        and identity_key = identity_key_value
      for update;
      if stream_row_id is null then
        raise exception 'recurring_inferred_stream_race_unresolved' using errcode = '40001';
      end if;
    end if;

    update public.recurring_streams
    set stream_id = stream_id_value,
        stream_type = candidate_row->>'stream_type',
        description = candidate_row->>'description',
        merchant_name = candidate_row->>'merchant_name',
        average_amount = (candidate_row->>'expected_amount')::numeric,
        last_amount = (candidate_row->>'last_amount')::numeric,
        frequency = candidate_row->>'frequency',
        status = 'MATURE',
        category = candidate_row->>'category',
        is_active = true,
        account_id = candidate_account_id,
        first_date = (candidate_row->>'first_date')::date,
        last_date = (candidate_row->>'last_date')::date,
        predicted_next_date = (candidate_row->>'predicted_next_date')::date,
        source = 'inferred',
        identity_key = identity_key_value,
        detection_version = (candidate_row->>'detection_version')::integer,
        detection_evidence = coalesce(candidate_row->'detection_evidence', '{}'::jsonb)
    where id = stream_row_id
      and user_id = p_user_id
      and plaid_item_id = p_item_id
      and source = 'inferred';

    delete from public.recurring_stream_transactions
    where recurring_stream_id = stream_row_id
      and user_id = p_user_id;

    for transaction_value in
      select value from jsonb_array_elements_text(coalesce(candidate_row->'transaction_ids', '[]'::jsonb))
    loop
      transaction_id_value := transaction_value::uuid;
      if not exists (
        select 1
        from public.transactions t
        join public.accounts a on a.id = t.account_id
        where t.id = transaction_id_value
          and t.user_id = p_user_id
          and t.account_id = candidate_account_id
          and a.user_id = p_user_id
          and a.plaid_item_id = p_item_id
      ) then
        raise exception 'recurring_candidate_transaction_not_owned' using errcode = '42501';
      end if;
      insert into public.recurring_stream_transactions (
        user_id, recurring_stream_id, transaction_id
      ) values (p_user_id, stream_row_id, transaction_id_value);
    end loop;
  end loop;

  -- Plaid state is read from the current row, so concurrent user edits that
  -- made a control non-null always win over inferred state transfer.
  for dedup_row in
    select value from jsonb_array_elements(coalesce(p_payload->'deduplications', '[]'::jsonb))
  loop
    plaid_stream_id := (dedup_row->>'plaid_id')::uuid;
    inferred_stream_id := nullif(dedup_row->>'inferred_id', '')::uuid;
    if inferred_stream_id is not null then
      select is_active into inferred_active
      from public.recurring_streams
      where id = inferred_stream_id
        and user_id = p_user_id
        and plaid_item_id = p_item_id
        and source = 'inferred'
      for update;
      update public.recurring_streams plaid
      set reviewed_at = coalesce(plaid.reviewed_at, inferred.reviewed_at),
          dismissed_at = coalesce(plaid.dismissed_at, inferred.dismissed_at),
          user_amount = coalesce(plaid.user_amount, inferred.user_amount)
      from public.recurring_streams inferred
      where plaid.id = plaid_stream_id
        and plaid.user_id = p_user_id
        and plaid.plaid_item_id = p_item_id
        and plaid.source = 'plaid'
        and inferred.id = inferred_stream_id
        and inferred.user_id = p_user_id
        and inferred.plaid_item_id = p_item_id
        and inferred.source = 'inferred';
      update public.recurring_streams
      set is_active = false
      where id = inferred_stream_id
        and user_id = p_user_id
        and plaid_item_id = p_item_id
        and source = 'inferred';
      if inferred_active then deactivated_count := deactivated_count + 1; end if;
    end if;
    deduplicated_count := deduplicated_count + 1;
  end loop;

  update public.recurring_streams
  set is_active = false
  where user_id = p_user_id
    and plaid_item_id = p_item_id
    and source = 'inferred'
    and is_active
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_payload->'candidates', '[]'::jsonb)) c
      where c->>'stream_id' = recurring_streams.stream_id
    );
  get diagnostics stale_count = row_count;
  deactivated_count := deactivated_count + stale_count;

  select count(*) into active_count
  from public.recurring_streams
  where user_id = p_user_id
    and plaid_item_id = p_item_id
    and source = 'inferred'
    and is_active;

  return jsonb_build_object(
    'active', active_count,
    'added', inserted_count,
    'deactivated', deactivated_count,
    'deduplicated', deduplicated_count
  );
end;
$$;

revoke all on function public.reconcile_inferred_recurring(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_inferred_recurring(uuid, uuid, jsonb)
  to service_role;
