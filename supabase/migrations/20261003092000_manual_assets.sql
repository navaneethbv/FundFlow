-- Entered gross values remain intact. Owned estimates are separate history.
create table public.manual_assets (
  manual_account_id uuid primary key references public.manual_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('property','vehicle','other')),
  ownership_percentage numeric(5,2) not null check (ownership_percentage > 0 and ownership_percentage <= 100),
  value_source text not null check (length(btrim(value_source)) between 1 and 120),
  valuation_date date not null,
  valuation_value numeric(14,2) not null check (valuation_value >= 0 and valuation_value < 1000000000000),
  purchase_price numeric(14,2) check (purchase_price >= 0 and purchase_price < 1000000000000),
  purchase_date date check (purchase_date <= valuation_date),
  growth_kind text check (growth_kind in ('percent','absolute')),
  growth_amount numeric(14,2),
  growth_period text check (growth_period in ('month','year')),
  growth_start_date date,
  version integer not null default 1 check (version > 0),
  check ((growth_kind is null and growth_amount is null and growth_period is null and growth_start_date is null)
    or (growth_kind is not null and growth_amount is not null and growth_period is not null
      and abs(growth_amount) < 1000000000000
      and (growth_kind <> 'percent' or growth_amount between -100 and 100))),
  unique (manual_account_id,user_id)
);
create table public.manual_account_values (
  id uuid primary key default gen_random_uuid(),
  manual_account_id uuid not null,
  user_id uuid not null,
  valuation_date date not null,
  gross_value numeric(14,2) not null check (gross_value >= 0 and gross_value < 1000000000000),
  owned_value numeric(14,2) not null check (owned_value >= 0 and owned_value <= gross_value),
  provenance text not null check (provenance in ('manual','estimated')),
  value_source text not null,
  foreign key (manual_account_id,user_id) references public.manual_assets(manual_account_id,user_id) on delete cascade,
  unique (manual_account_id,valuation_date)
);
alter table public.manual_assets enable row level security;
alter table public.manual_account_values enable row level security;
revoke all on public.manual_assets,public.manual_account_values from public,anon,authenticated;
grant select on public.manual_assets,public.manual_account_values to authenticated;
grant all on public.manual_assets,public.manual_account_values to service_role;
create policy manual_assets_read on public.manual_assets for select to authenticated
  using (user_id=(select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()));
create policy manual_account_values_read on public.manual_account_values for select to authenticated
  using (user_id=(select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()));

create function private.protect_manual_asset_value() returns trigger language plpgsql set search_path='' as $$
begin
  if old.provenance='manual' and new.provenance='estimated' then
    raise exception 'An estimate cannot replace a manual valuation' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.protect_manual_asset_value() from public,anon,authenticated;
create trigger protect_manual_asset_value before update on public.manual_account_values
  for each row execute function private.protect_manual_asset_value();

-- Legacy balance writers must not silently change an asset's growth anchor,
-- including after a feature-flag rollback. The valuation RPC updates history
-- first, within the same transaction, before changing the raw balance.
create function private.require_asset_valuation() returns trigger language plpgsql set search_path='' as $$
begin
  if new.balance is distinct from old.balance and exists(
    select 1 from public.manual_assets where manual_account_id=old.id
  ) and not exists(
    select 1 from public.manual_assets a join public.manual_account_values v
      on v.manual_account_id=a.manual_account_id and v.valuation_date=a.valuation_date
    where a.manual_account_id=old.id and a.user_id=old.user_id and v.provenance='manual' and v.owned_value=new.balance
  ) then
    raise exception 'Record this valuation on the Manual assets page' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.require_asset_valuation() from public,anon,authenticated;
create trigger require_asset_valuation before update of balance on public.manual_accounts
  for each row execute function private.require_asset_valuation();

-- Service-only; locking the parent also serializes this with valuation edits.
create function public.materialize_manual_asset(p_user_id uuid,p_account_id uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
declare a public.manual_assets; base numeric; start_on date; point_on date;
  n integer; months integer; gross numeric; owned numeric; steps integer;
begin
  perform 1 from public.manual_accounts where id=p_account_id and user_id=p_user_id for update;
  if not found then raise exception 'Asset not found' using errcode='P0002'; end if;
  select * into a from public.manual_assets where manual_account_id=p_account_id and user_id=p_user_id;
  if not found then raise exception 'Asset not found' using errcode='P0002'; end if;
  base=a.valuation_value;
  if p_today is null or p_today<a.valuation_date or p_today>a.valuation_date+interval '100 years' then
    raise exception 'Invalid materialization date' using errcode='22023';
  end if;
  if a.growth_kind is null then return; end if;
  start_on=greatest(a.valuation_date,coalesce(a.growth_start_date,a.valuation_date));
  months=case when a.growth_period='year' then 12 else 1 end;
  steps=0;
  -- Include completed anniversaries and today's value; never project forward.
  for n in 1..1201 loop
    point_on=(start_on+make_interval(months=>n*months))::date;
    if point_on>p_today then point_on=p_today; else steps=n; end if;
    if point_on<=a.valuation_date then exit; end if;
    if a.growth_kind='percent' then
      gross=round(base*power(1+a.growth_amount/100,steps),2);
    else
      gross=greatest(0,round(base+a.growth_amount*steps,2));
    end if;
    if gross>=1000000000000 then raise exception 'Growth exceeds supported value' using errcode='22023'; end if;
    owned=round(gross*a.ownership_percentage/100,2);
    -- A pre-existing observation is authoritative for both history stores.
    if public.record_estimated_account_history(p_user_id,null,p_account_id,point_on,owned,'USD') then
      insert into public.manual_account_values(manual_account_id,user_id,valuation_date,gross_value,owned_value,provenance,value_source)
        values(p_account_id,p_user_id,point_on,gross,owned,'estimated','Growth assumption')
      on conflict(manual_account_id,valuation_date) do update
        set gross_value=excluded.gross_value,owned_value=excluded.owned_value,value_source=excluded.value_source
        where manual_account_values.provenance='estimated' and manual_account_values.user_id=p_user_id;
    end if;
    exit when point_on=p_today;
  end loop;
end $$;
revoke all on function public.materialize_manual_asset(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.materialize_manual_asset(uuid,uuid,date) to service_role;

create function public.save_manual_asset(p_user_id uuid,p_input jsonb,p_today date)
returns uuid language plpgsql security definer set search_path='' as $$
declare asset_id uuid=(p_input->>'id')::uuid; a public.manual_assets;
  v numeric=(p_input->>'value')::numeric; share numeric=(p_input->>'ownershipPercentage')::numeric;
  valued_on date=(p_input->>'valuationDate')::date; owned numeric;
begin
  if p_today is null or valued_on is null or valued_on>p_today or valued_on<p_today-interval '100 years'
    or v is null or v<0 or v>=1000000000000 or v<>round(v,2)
    or share is null or share<=0 or share>100 or share<>round(share,2) then
    raise exception 'Invalid valuation' using errcode='22023';
  end if;
  owned=round(v*share/100,2);
  if asset_id is null then
    insert into public.manual_accounts(user_id,name,account_type,balance)
      values(p_user_id,btrim(p_input->>'name'),'asset',owned) returning id into asset_id;
  else
    perform 1 from public.manual_accounts where id=asset_id and user_id=p_user_id for update;
    if not found then raise exception 'Asset not found' using errcode='P0002'; end if;
    select * into a from public.manual_assets where manual_account_id=asset_id and user_id=p_user_id;
    if not found then raise exception 'Asset not found' using errcode='P0002'; end if;
    if (p_input->>'version')::integer is distinct from a.version then
      raise exception 'Asset changed; reload before saving' using errcode='40001';
    end if;
    if valued_on<a.valuation_date then raise exception 'Valuation precedes latest entry' using errcode='22023'; end if;
  end if;
  insert into public.manual_assets(manual_account_id,user_id,asset_kind,ownership_percentage,value_source,valuation_date,valuation_value,
    purchase_price,purchase_date,growth_kind,growth_amount,growth_period,growth_start_date)
  values(asset_id,p_user_id,p_input->>'assetKind',share,btrim(p_input->>'valueSource'),valued_on,v,
    (p_input->>'purchasePrice')::numeric,(p_input->>'purchaseDate')::date,p_input#>>'{growth,kind}',
    (p_input#>>'{growth,amount}')::numeric,p_input#>>'{growth,period}',(p_input#>>'{growth,startDate}')::date)
  on conflict(manual_account_id) do update set asset_kind=excluded.asset_kind,ownership_percentage=excluded.ownership_percentage,
    value_source=excluded.value_source,valuation_date=excluded.valuation_date,valuation_value=excluded.valuation_value,purchase_price=excluded.purchase_price,
    purchase_date=excluded.purchase_date,growth_kind=excluded.growth_kind,growth_amount=excluded.growth_amount,
    growth_period=excluded.growth_period,growth_start_date=excluded.growth_start_date,version=manual_assets.version+1;
  delete from public.manual_account_values where manual_account_id=asset_id and user_id=p_user_id
    and valuation_date>=valued_on and provenance='estimated';
  delete from public.account_balance_snapshots where manual_account_id=asset_id and user_id=p_user_id
    and snapshot_date>=valued_on and provenance='estimated';
  insert into public.manual_account_values(manual_account_id,user_id,valuation_date,gross_value,owned_value,provenance,value_source)
    values(asset_id,p_user_id,valued_on,v,owned,'manual',btrim(p_input->>'valueSource'))
  on conflict(manual_account_id,valuation_date) do update set gross_value=excluded.gross_value,
    owned_value=excluded.owned_value,provenance='manual',value_source=excluded.value_source;
  insert into public.account_balance_snapshots(user_id,manual_account_id,snapshot_date,current_balance,iso_currency_code,provenance)
    values(p_user_id,asset_id,valued_on,owned,'USD','manual')
  on conflict(account_id,manual_account_id,snapshot_date) do update set current_balance=excluded.current_balance,provenance='manual';
  update public.manual_accounts set name=btrim(p_input->>'name'),balance=owned where id=asset_id and user_id=p_user_id;
  perform public.materialize_manual_asset(p_user_id,asset_id,p_today);
  return asset_id;
end $$;
revoke all on function public.save_manual_asset(uuid,jsonb,date) from public,anon,authenticated;
grant execute on function public.save_manual_asset(uuid,jsonb,date) to service_role;

-- Every balance consumer sees the same owned value. Raw account values and
-- names are retained for editing and backup. Labels travel with estimates.
create view public.manual_account_balances with (security_invoker=true) as
select m.id,m.user_id,
  m.name || case when v.provenance='estimated' then ' (Estimate)' else '' end as name,
  m.account_type,coalesce(v.owned_value,m.balance) as balance,m.include_in_net_worth,
  m.created_at,m.updated_at,m.apr,a.asset_kind,v.provenance
from public.manual_accounts m
left join public.manual_assets a on a.manual_account_id=m.id and a.user_id=m.user_id
left join lateral (select owned_value,provenance from public.manual_account_values
  where manual_account_id=m.id and user_id=m.user_id order by valuation_date desc limit 1) v on a.manual_account_id is not null;
revoke all on public.manual_account_balances from public,anon,authenticated;
grant select on public.manual_account_balances to authenticated,service_role;
