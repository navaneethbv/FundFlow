-- Synthetic records only; execute against a disposable database.
begin;
insert into auth.users(id,email) values
 ('92000000-0000-4000-8000-000000000001','portfolio-owner@example.invalid'),
 ('92000000-0000-4000-8000-000000000002','portfolio-other@example.invalid');
do $$
declare u uuid='92000000-0000-4000-8000-000000000001'; stranger uuid='92000000-0000-4000-8000-000000000002';
 property_id uuid; liability_id uuid; investment_id uuid; foreign_id uuid; h_id uuid; security_id uuid; v integer; old_v integer; before_worth numeric;
begin
 property_id=public.save_manual_asset(u,'{"name":"Home","assetKind":"property","value":10000,"valuationDate":"2026-01-01","valueSource":"Appraisal","ownershipPercentage":50}','2026-01-01');
 insert into public.manual_accounts(user_id,name,account_type,balance) values(u,'Mortgage','liability',1200) returning id into liability_id;
 insert into public.manual_accounts(user_id,name,account_type,balance) values(u,'Portfolio','investment',500) returning id into investment_id;
 insert into public.manual_accounts(user_id,name,account_type,balance) values(stranger,'Foreign loan','liability',100) returning id into foreign_id;
 insert into public.securities(user_id,name) values(u,'Fixture security') returning id into security_id;
 insert into public.holdings(user_id,manual_account_id,security_id,quantity,cost_basis,institution_value,source) values(u,investment_id,security_id,2,300,500,'manual') returning id into h_id;
 select sum(case when account_type='liability' then -balance else balance end) into before_worth from public.manual_account_balances where user_id=u;
 v=public.save_portfolio_annotation(u,'mortgage',property_id,0,jsonb_build_object('liabilityId',liability_id,'liabilitySource','manual','terms','{"principal":1200,"annualRate":0,"paymentAmount":100,"startDate":"2026-01-01","termMonths":12}'::jsonb));
 assert (select sum(case when account_type='liability' then -balance else balance end)=before_worth from public.manual_account_balances where user_id=u), 'Mortgage link double-counted the liability';
 assert (select current_balance=5000 from public.account_balance_snapshots where manual_account_id=property_id and snapshot_date='2026-01-01'), 'Mortgage link overwrote property history';
 begin
  perform public.save_portfolio_annotation(u,'mortgage',property_id,v,jsonb_build_object('liabilityId',foreign_id,'liabilitySource','manual','terms','{}'::jsonb));
  raise exception 'Foreign loan accepted';
 exception when no_data_found then null; end;
 v=public.save_portfolio_annotation(u,'basis',h_id,0,'{"amount":0,"quantity":2,"source":"imported"}');
 assert (select cost_basis=300 from public.holdings where id=h_id), 'Reported basis overwritten';
 assert (select amount=0 and source='imported' from public.holding_basis_annotations where holding_id=h_id), 'Zero basis lost';
 begin
  perform public.save_portfolio_annotation(stranger,'basis',h_id,v,'{"amount":100,"quantity":2,"source":"manual"}');
  raise exception 'Foreign holding accepted';
 exception when no_data_found then null; end;
 begin
  perform public.save_portfolio_annotation(u,'basis',h_id,0,'{"amount":100,"quantity":2,"source":"manual"}');
  raise exception 'Stale version accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.save_portfolio_annotation(u,'basis',h_id,v,'{"amount":100,"quantity":3,"source":"manual"}');
  raise exception 'Changed holding quantity accepted';
 exception when serialization_failure then null; end;
 old_v=v;
 perform public.save_portfolio_annotation(u,'basis',h_id,v,null);
 v=public.save_portfolio_annotation(u,'basis',h_id,0,'{"amount":20,"quantity":2,"source":"manual"}');
 assert v>old_v, 'Version reused after reset';
 begin
  perform public.save_portfolio_annotation(u,'basis',h_id,old_v,null);
  raise exception 'Old pre-reset version accepted';
 exception when serialization_failure then null; end;
 v=public.save_portfolio_annotation(u,'tax',investment_id,0,'{"bucket":"roth"}');
 assert (select bucket='roth' from public.account_tax_treatments where id=investment_id), 'Tax override lost';
 begin
  perform public.save_portfolio_annotation(stranger,'tax',investment_id,v,null);
  raise exception 'Foreign tax override accepted';
 exception when no_data_found then null; end;
 assert not has_function_privilege('authenticated','public.save_portfolio_annotation(uuid,text,uuid,integer,jsonb)','execute'), 'Client bypasses API';
 assert not has_table_privilege('authenticated','public.holding_basis_annotations','insert'), 'Direct basis writes allowed';
 perform set_config('request.jwt.claim.sub',stranger::text,true);
end $$;
set local role authenticated;
do $$ begin
 assert (select count(*)=0 from public.holding_basis_annotations), 'Basis leaked';
 assert (select count(*)=0 from public.account_tax_treatments), 'Tax treatment leaked';
 assert (select count(*)=0 from public.property_mortgages), 'Mortgage leaked';
end $$;
reset role;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"92000000-0000-4000-8000-000000000001","aal":"aal1","session_id":"portfolio-fixture"}',true);
set local role authenticated;
do $$ begin
 assert (select count(*)=1 from public.holding_basis_annotations), 'Owner cannot read basis';
 assert (select count(*)=1 from public.account_tax_treatments), 'Owner cannot read tax override';
 assert (select count(*)=1 from public.property_mortgages), 'Owner cannot read mortgage';
end $$;
reset role;
insert into auth.mfa_factors(id,user_id,status,factor_type,friendly_name,created_at,updated_at) values
 ('92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','verified','totp','Fixture',now(),now());
set local role authenticated;
do $$ begin
 assert (select count(*)=0 from public.holding_basis_annotations), 'AAL1 basis leak';
 assert (select count(*)=0 from public.account_tax_treatments), 'AAL1 tax leak';
 assert (select count(*)=0 from public.property_mortgages), 'AAL1 mortgage leak';
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"92000000-0000-4000-8000-000000000001","aal":"aal2","session_id":"portfolio-fixture"}',true);
set local role authenticated;
do $$ begin
 assert (select count(*)=1 from public.holding_basis_annotations), 'AAL2 basis denied';
end $$;
reset role;
insert into public.user_session_records(user_id,session_id,revoked_at) values('92000000-0000-4000-8000-000000000001','portfolio-fixture',now());
set local role authenticated;
do $$ begin
 assert (select count(*)=0 from public.holding_basis_annotations), 'Revoked basis leak';
 assert (select count(*)=0 from public.account_tax_treatments), 'Revoked tax leak';
 assert (select count(*)=0 from public.property_mortgages), 'Revoked mortgage leak';
end $$;
reset role;
rollback;
