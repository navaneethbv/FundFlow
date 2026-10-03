-- Separate annotations never overwrite provider balances or cost basis.
alter table public.accounts add constraint accounts_owner_identity unique(id,user_id);
alter table public.manual_accounts add constraint manual_accounts_owner_identity unique(id,user_id);
alter table public.holdings add constraint holdings_owner_identity unique(id,user_id);

create table public.holding_basis_annotations (
 holding_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 amount numeric(14,2) not null check(amount>=0),
 quantity numeric(18,6) not null,
 source text not null check(source in ('manual','imported','estimated')),
 version integer not null check(version>0),
 foreign key(holding_id,user_id) references public.holdings(id,user_id) on delete cascade
);
create table public.account_tax_treatments (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid,
 manual_account_id uuid,
 bucket text not null check(bucket in ('taxable','deferred','roth','hsa','education','unknown')),
 version integer not null check(version>0),
 check((account_id is null)<>(manual_account_id is null)),
 check(id=coalesce(account_id,manual_account_id)),
 foreign key(account_id,user_id) references public.accounts(id,user_id) on delete cascade,
 foreign key(manual_account_id,user_id) references public.manual_accounts(id,user_id) on delete cascade
);
create table public.property_mortgages (
 manual_account_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 liability_account_id uuid unique,
 liability_manual_account_id uuid unique,
 terms jsonb not null check(jsonb_typeof(terms)='object'),
 version integer not null check(version>0),
 check((liability_account_id is null)<>(liability_manual_account_id is null)),
 check(manual_account_id is distinct from liability_manual_account_id),
 foreign key(manual_account_id,user_id) references public.manual_assets(manual_account_id,user_id) on delete cascade,
 foreign key(liability_account_id,user_id) references public.accounts(id,user_id) on delete cascade,
 foreign key(liability_manual_account_id,user_id) references public.manual_accounts(id,user_id) on delete cascade
);

do $$ declare t text; begin
 foreach t in array array['holding_basis_annotations','account_tax_treatments','property_mortgages'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy owner_read on public.%I for select to authenticated using (user_id=(select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()))',t);
  execute format('create index on public.%I(user_id)',t);
 end loop;
end $$;

-- Parent locks serialize first inserts as well as compare-and-swap updates.
-- This service-only function is not an alternate authentication entry point.
-- Monotonic versions prevent an old edit matching a reset-and-recreated row.
create sequence public.portfolio_annotation_version as integer;
revoke all on sequence public.portfolio_annotation_version from public,anon,authenticated;
grant usage on sequence public.portfolio_annotation_version to service_role;
create function public.save_portfolio_annotation(p_user_id uuid,p_kind text,p_id uuid,p_version integer,p_data jsonb)
returns integer language plpgsql set search_path=public as $$
declare current_version integer; next_version integer; current_quantity numeric; manual boolean;
begin
 if p_version is null or p_version<0 or p_version>=2147483646 then raise invalid_parameter_value; end if;
 if p_kind='basis' then
  select quantity into current_quantity from public.holdings where id=p_id and user_id=p_user_id and is_active for update;
  if not found then raise no_data_found; end if;
  select version into current_version from public.holding_basis_annotations where holding_id=p_id and user_id=p_user_id;
 elsif p_kind='tax' then
  perform 1 from public.accounts where id=p_id and user_id=p_user_id for update;
  manual=not found;
  if manual then
   perform 1 from public.manual_accounts where id=p_id and user_id=p_user_id for update;
   if not found then raise no_data_found; end if;
  end if;
  select version into current_version from public.account_tax_treatments where id=p_id and user_id=p_user_id;
 elsif p_kind='mortgage' then
  perform 1 from public.manual_assets where manual_account_id=p_id and user_id=p_user_id and asset_kind='property' for update;
  if not found then raise no_data_found; end if;
  select version into current_version from public.property_mortgages where manual_account_id=p_id and user_id=p_user_id;
 else raise invalid_parameter_value;
 end if;
 if coalesce(current_version,0)<>p_version then raise serialization_failure; end if;
 next_version=nextval('public.portfolio_annotation_version');
 if p_data is null then
  if p_kind='basis' then delete from public.holding_basis_annotations where holding_id=p_id and user_id=p_user_id;
  elsif p_kind='tax' then delete from public.account_tax_treatments where id=p_id and user_id=p_user_id;
  else delete from public.property_mortgages where manual_account_id=p_id and user_id=p_user_id;
  end if;
  return 0;
 end if;
 if p_kind='basis' then
  if current_quantity is null or current_quantity is distinct from (p_data->>'quantity')::numeric then raise serialization_failure; end if;
  insert into public.holding_basis_annotations values(p_id,p_user_id,(p_data->>'amount')::numeric,current_quantity,p_data->>'source',next_version)
  on conflict(holding_id) do update set amount=excluded.amount,quantity=excluded.quantity,source=excluded.source,version=excluded.version
  where holding_basis_annotations.user_id=p_user_id;
 elsif p_kind='tax' then
  insert into public.account_tax_treatments values(p_id,p_user_id,case when not manual then p_id end,case when manual then p_id end,p_data->>'bucket',next_version)
  on conflict(id) do update set bucket=excluded.bucket,version=excluded.version where account_tax_treatments.user_id=p_user_id;
 else
  if p_data->>'liabilitySource'='plaid' then
   perform 1 from public.accounts where id=(p_data->>'liabilityId')::uuid and user_id=p_user_id and type='loan' and iso_currency_code='USD' for update;
  elsif p_data->>'liabilitySource'='manual' then
   perform 1 from public.manual_accounts where id=(p_data->>'liabilityId')::uuid and user_id=p_user_id and account_type='liability' and id<>p_id for update;
  else raise invalid_parameter_value;
  end if;
  if not found then raise no_data_found; end if;
  insert into public.property_mortgages values(p_id,p_user_id,
   case when p_data->>'liabilitySource'='plaid' then (p_data->>'liabilityId')::uuid end,
   case when p_data->>'liabilitySource'='manual' then (p_data->>'liabilityId')::uuid end,p_data->'terms',next_version)
  on conflict(manual_account_id) do update set liability_account_id=excluded.liability_account_id,liability_manual_account_id=excluded.liability_manual_account_id,terms=excluded.terms,version=excluded.version
  where property_mortgages.user_id=p_user_id;
 end if;
 return next_version;
end $$;
revoke all on function public.save_portfolio_annotation(uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_portfolio_annotation(uuid,text,uuid,integer,jsonb) to service_role;
