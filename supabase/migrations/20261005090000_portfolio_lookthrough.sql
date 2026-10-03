-- User-authored constituent weights for portfolio look-through.
-- No provider feed is implied: every row is explicitly marked manual and
-- carries the date on which the user supplied the weights.
create table public.holding_constituent_weights (
  holding_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  weights jsonb not null check (jsonb_typeof(weights) = 'array'),
  source text not null default 'manual' check (source = 'manual'),
  as_of_date date not null,
  version integer not null check (version > 0),
  foreign key (holding_id, user_id)
    references public.holdings(id, user_id) on delete cascade
);

create index holding_constituent_weights_user_idx
  on public.holding_constituent_weights(user_id);

alter table public.holding_constituent_weights enable row level security;
revoke all on public.holding_constituent_weights from anon, authenticated;
grant select on public.holding_constituent_weights to authenticated;
grant all on public.holding_constituent_weights to service_role;
create policy holding_constituent_weights_owner_read
  on public.holding_constituent_weights for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- The service-only RPC locks the holding before comparing the version. This
-- keeps two tabs from accepting the same stale edit and uses the existing
-- monotonic portfolio sequence so reset/recreate cannot revive an old version.
create or replace function public.save_holding_constituent_weights(
  p_user_id uuid,
  p_holding_id uuid,
  p_version integer,
  p_data jsonb
) returns integer
language plpgsql
set search_path = public
as $$
declare
  current_version integer;
  next_version integer;
  weight_total numeric;
  row_data jsonb;
  as_of_text text;
  as_of_date date;
begin
  if p_version is null or p_version < 0 or p_version >= 2147483646 then
    raise invalid_parameter_value;
  end if;

  perform 1 from public.holdings
    where id = p_holding_id and user_id = p_user_id and is_active
    for update;
  if not found then raise no_data_found; end if;

  select version into current_version
    from public.holding_constituent_weights
    where holding_id = p_holding_id and user_id = p_user_id;
  if coalesce(current_version, 0) <> p_version then
    raise serialization_failure;
  end if;

  next_version = nextval('public.portfolio_annotation_version');
  if p_data is null then
    delete from public.holding_constituent_weights
      where holding_id = p_holding_id and user_id = p_user_id;
    return 0;
  end if;

  if jsonb_typeof(p_data) <> 'object'
     or jsonb_typeof(p_data->'weights') <> 'array'
     or jsonb_array_length(p_data->'weights') < 1
     or jsonb_array_length(p_data->'weights') > 100 then
    raise invalid_parameter_value;
  end if;
  as_of_text = p_data->>'asOfDate';
  if as_of_text is null or as_of_text !~ '^\d{4}-\d{2}-\d{2}$' then
    raise invalid_parameter_value;
  end if;
  begin
    as_of_date = to_date(as_of_text, 'YYYY-MM-DD');
  exception when datetime_field_overflow then
    raise invalid_parameter_value;
  end;
  if to_char(as_of_date, 'YYYY-MM-DD') <> as_of_text or as_of_date > current_date then
    raise invalid_parameter_value;
  end if;
  for row_data in select value from jsonb_array_elements(p_data->'weights') loop
    if jsonb_typeof(row_data) <> 'object'
       or coalesce(row_data->>'key', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
       or char_length(trim(coalesce(row_data->>'name', ''))) < 1
       or char_length(trim(coalesce(row_data->>'name', ''))) > 120
       or char_length(trim(coalesce(row_data->>'sector', ''))) < 1
       or char_length(trim(coalesce(row_data->>'region', ''))) < 1
       or jsonb_typeof(row_data->'weight') <> 'number'
       or (row_data->>'weight') !~ '^(0|0?\.\d+|1(\.0+)?)$' then
      raise invalid_parameter_value;
    end if;
  end loop;
  if exists (
    select 1
      from jsonb_array_elements(p_data->'weights') as constituent
     group by constituent->>'key'
    having count(*) > 1
  ) then
    raise invalid_parameter_value;
  end if;
  select sum((value->>'weight')::numeric) into weight_total
    from jsonb_array_elements(p_data->'weights');
  if abs(weight_total - 1) > 0.0001 then raise invalid_parameter_value; end if;

  insert into public.holding_constituent_weights(
    holding_id, user_id, weights, source, as_of_date, version
  ) values (
    p_holding_id, p_user_id, p_data->'weights', 'manual', as_of_date, next_version
  )
  on conflict (holding_id) do update set
    weights = excluded.weights,
    source = excluded.source,
    as_of_date = excluded.as_of_date,
    version = excluded.version
  where holding_constituent_weights.user_id = p_user_id;
  return next_version;
end;
$$;

revoke all on function public.save_holding_constituent_weights(uuid, uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_holding_constituent_weights(uuid, uuid, integer, jsonb)
  to service_role;
