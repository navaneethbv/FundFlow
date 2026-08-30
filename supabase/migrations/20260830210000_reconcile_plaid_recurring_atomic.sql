-- Apply one complete Plaid recurring snapshot atomically.
-- The caller is the trusted service client, but ownership and payload checks
-- remain in the SECURITY DEFINER function.

create or replace function public.reconcile_plaid_recurring(
  p_user_id uuid,
  p_item_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stream_row jsonb;
  join_row jsonb;
  transaction_value text;
  stream_id_value text;
  stream_row_id uuid;
  account_id_value uuid;
  transaction_id_value uuid;
  stream_account_id text;
  existing_source text;
  stream_count integer;
begin
  if not exists (
    select 1 from public.plaid_items
    where id = p_item_id and user_id = p_user_id
  ) then
    raise exception 'recurring_item_not_owned' using errcode = '42501';
  end if;

  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'streams') <> 'array'
     or jsonb_typeof(p_payload->'joins') <> 'array' then
    raise exception 'recurring_plaid_payload_invalid' using errcode = '22023';
  end if;

  -- Validate the complete snapshot and all join ids before any DML.
  for stream_row in select value from jsonb_array_elements(p_payload->'streams') loop
    if jsonb_typeof(stream_row) is distinct from 'object'
       or jsonb_typeof(stream_row->'stream_id') is distinct from 'string'
       or nullif(stream_row->>'stream_id', '') is null
       or stream_row->>'source' is distinct from 'plaid'
       or stream_row->>'stream_type' not in ('inflow', 'outflow')
       or (stream_row->>'account_id' is not null and stream_row->>'account_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'recurring_plaid_stream_invalid' using errcode = '22023';
    end if;
    if stream_row->>'account_id' is not null then
      account_id_value := (stream_row->>'account_id')::uuid;
      if not exists (
        select 1 from public.accounts
        where id = account_id_value and user_id = p_user_id and plaid_item_id = p_item_id
      ) then
        raise exception 'recurring_plaid_account_not_owned' using errcode = '42501';
      end if;
    end if;
    if stream_row->>'average_amount' is not null then
      perform (stream_row->>'average_amount')::numeric;
    end if;
    if stream_row->>'last_amount' is not null then
      perform (stream_row->>'last_amount')::numeric;
    end if;
    if stream_row->>'first_date' is not null then
      perform (stream_row->>'first_date')::date;
    end if;
    if stream_row->>'last_date' is not null then
      perform (stream_row->>'last_date')::date;
    end if;
    if stream_row->>'predicted_next_date' is not null then
      perform (stream_row->>'predicted_next_date')::date;
    end if;
    if stream_row->>'identity_key' is not null and jsonb_typeof(stream_row->'identity_key') is distinct from 'string' then
      raise exception 'recurring_plaid_stream_invalid' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.recurring_streams
      where stream_id = stream_row->>'stream_id'
        and source <> 'plaid'
    ) then
      raise exception 'recurring_plaid_stream_conflict' using errcode = '40901';
    end if;
    if exists (
      select 1 from public.recurring_streams
      where stream_id = stream_row->>'stream_id'
        and source = 'plaid'
        and (user_id <> p_user_id or plaid_item_id <> p_item_id)
    ) then
      raise exception 'recurring_plaid_stream_not_owned' using errcode = '42501';
    end if;
  end loop;

  for join_row in select value from jsonb_array_elements(p_payload->'joins') loop
    if jsonb_typeof(join_row) is distinct from 'object'
       or jsonb_typeof(join_row->'stream_id') is distinct from 'string'
       or nullif(join_row->>'stream_id', '') is null
       or jsonb_typeof(join_row->'transaction_ids') is distinct from 'array'
       or not exists (
         select 1 from jsonb_array_elements(p_payload->'streams') s
         where s->>'stream_id' = join_row->>'stream_id'
       ) then
      raise exception 'recurring_plaid_join_invalid' using errcode = '22023';
    end if;
    select s->>'account_id' into stream_account_id
    from jsonb_array_elements(p_payload->'streams') s
    where s->>'stream_id' = join_row->>'stream_id';
    for transaction_value in select value from jsonb_array_elements_text(join_row->'transaction_ids') loop
      if transaction_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'recurring_plaid_join_invalid' using errcode = '22023';
      end if;
      transaction_id_value := transaction_value::uuid;
      if not exists (
        select 1
        from public.transactions t
        join public.accounts a on a.id = t.account_id
        where t.id = transaction_id_value
          and t.user_id = p_user_id
          and a.user_id = p_user_id
          and a.plaid_item_id = p_item_id
          and (stream_account_id is null or t.account_id = stream_account_id::uuid)
      ) then
        raise exception 'recurring_plaid_transaction_not_owned' using errcode = '42501';
      end if;
    end loop;
  end loop;

  for stream_row in select value from jsonb_array_elements(p_payload->'streams') loop
    stream_id_value := stream_row->>'stream_id';
    insert into public.recurring_streams (
      user_id, plaid_item_id, stream_id, stream_type, description,
      merchant_name, average_amount, last_amount, frequency, status,
      category, is_active, account_id, first_date, last_date,
      predicted_next_date, source, identity_key
    ) values (
      p_user_id, p_item_id, stream_id_value, stream_row->>'stream_type',
      stream_row->>'description', stream_row->>'merchant_name',
      (stream_row->>'average_amount')::numeric, (stream_row->>'last_amount')::numeric,
      stream_row->>'frequency', stream_row->>'status', stream_row->>'category',
      coalesce((stream_row->>'is_active')::boolean, true),
      nullif(stream_row->>'account_id', '')::uuid,
      (stream_row->>'first_date')::date, (stream_row->>'last_date')::date,
      (stream_row->>'predicted_next_date')::date, 'plaid',
      nullif(stream_row->>'identity_key', '')
    )
    on conflict (stream_id) do update set
      stream_type = excluded.stream_type,
      description = excluded.description,
      merchant_name = excluded.merchant_name,
      average_amount = excluded.average_amount,
      last_amount = excluded.last_amount,
      frequency = excluded.frequency,
      status = excluded.status,
      category = excluded.category,
      is_active = excluded.is_active,
      account_id = excluded.account_id,
      first_date = excluded.first_date,
      last_date = excluded.last_date,
      predicted_next_date = excluded.predicted_next_date,
      source = 'plaid',
      identity_key = excluded.identity_key;
  end loop;

  -- Replace exact provider joins only after every stream and transaction was
  -- validated, then sweep the provider side of this item snapshot.
  delete from public.recurring_stream_transactions rst
  using public.recurring_streams rs
  where rst.recurring_stream_id = rs.id
    and rst.user_id = p_user_id
    and rs.user_id = p_user_id
    and rs.plaid_item_id = p_item_id
    and rs.source = 'plaid'
    and exists (
      select 1 from jsonb_array_elements(p_payload->'streams') s
      where s->>'stream_id' = rs.stream_id
    );

  for join_row in select value from jsonb_array_elements(p_payload->'joins') loop
    select id into stream_row_id
    from public.recurring_streams
    where user_id = p_user_id and plaid_item_id = p_item_id
      and source = 'plaid' and stream_id = join_row->>'stream_id';
    for transaction_value in select value from jsonb_array_elements_text(join_row->'transaction_ids') loop
      insert into public.recurring_stream_transactions (user_id, recurring_stream_id, transaction_id)
      values (p_user_id, stream_row_id, transaction_value::uuid);
    end loop;
  end loop;

  update public.recurring_streams
  set is_active = false
  where user_id = p_user_id
    and plaid_item_id = p_item_id
    and source = 'plaid'
    and not exists (
      select 1 from jsonb_array_elements(p_payload->'streams') s
      where s->>'stream_id' = recurring_streams.stream_id
    );

  select count(*) into stream_count
  from jsonb_array_elements(p_payload->'streams');
  return jsonb_build_object('plaid', stream_count);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
  raise exception 'recurring_plaid_payload_invalid' using errcode = '22023';
end;
$$;

revoke all on function public.reconcile_plaid_recurring(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_plaid_recurring(uuid, uuid, jsonb)
  to service_role;
