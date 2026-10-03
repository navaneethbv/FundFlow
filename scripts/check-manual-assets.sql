-- Synthetic records, rolled back. Run only against a disposable database.
begin;
insert into auth.users(id,email) values
 ('91000000-0000-4000-8000-000000000001','asset-owner@example.invalid'),
 ('91000000-0000-4000-8000-000000000002','asset-other@example.invalid');
do $$
declare u uuid='91000000-0000-4000-8000-000000000001'; other_u uuid='91000000-0000-4000-8000-000000000002';
 a uuid; b uuid; body jsonb;
begin
 body='{"name":"House","assetKind":"property","value":100000,"valuationDate":"2026-01-31","valueSource":"Appraisal","ownershipPercentage":50,"growth":{"kind":"percent","amount":10,"period":"month"}}';
 a=public.save_manual_asset(u,body,'2026-03-31');
 assert (select balance=50000 from public.manual_accounts where id=a), 'Legacy balance does not retain entered owned share';
 assert (select valuation_value=100000 from public.manual_assets where manual_account_id=a), 'Growth overwrote entered gross value';
 begin
   update public.manual_accounts set balance=123 where id=a;
   raise exception 'Legacy writer corrupted the valuation anchor';
 exception when invalid_parameter_value then null; end;
 assert (select balance=60500 and name='House (Estimate)' from public.manual_account_balances where id=a), 'Owned net worth is wrong';
 assert (select gross_value=110000 and owned_value=55000 and provenance='estimated' from public.manual_account_values where manual_account_id=a and valuation_date='2026-02-28'), 'Month-end growth is wrong';
 assert (select current_balance=50000 and provenance='manual' from public.account_balance_snapshots where manual_account_id=a and snapshot_date='2026-01-31'), 'Manual anchor changed';
 perform public.materialize_manual_asset(u,a,'2026-03-31');
 assert (select count(*)=3 from public.manual_account_values where manual_account_id=a), 'Repeated materialization is not idempotent';
 begin
   perform public.materialize_manual_asset(other_u,a,'2026-03-31');
   raise exception 'Foreign owner materialized an asset';
 exception when no_data_found then null; end;
 begin
   perform public.save_manual_asset(other_u,body||jsonb_build_object('id',a,'version',1),'2026-03-31');
   raise exception 'Foreign owner changed an asset';
 exception when no_data_found then null; end;
 begin
   perform public.save_manual_asset(u,body||jsonb_build_object('id',a,'version',2),'2026-03-31');
   raise exception 'Stale update accepted';
 exception when serialization_failure then null; end;
 begin
   update public.manual_account_values set provenance='estimated' where manual_account_id=a and valuation_date='2026-01-31';
   raise exception 'Estimate overwrote manual value';
 exception when invalid_parameter_value then null; end;
 -- A newer manual valuation replaces the estimate, and becomes the new anchor.
 perform public.save_manual_asset(u,body||jsonb_build_object('id',a,'version',1,'value',80000,'valuationDate','2026-02-28','ownershipPercentage',25),'2026-03-31');
 assert (select balance=22000 from public.manual_account_balances where id=a), 'New owned valuation not projected';
 assert (select owned_value=50000 from public.manual_account_values where manual_account_id=a and valuation_date='2026-01-31'), 'Historical ownership was rewritten';
 assert (select provenance='manual' and owned_value=20000 from public.manual_account_values where manual_account_id=a and valuation_date='2026-02-28'), 'New manual anchor missing';
 -- Explicit observation wins over a growth assumption on the same date.
 insert into public.account_balance_snapshots(user_id,manual_account_id,snapshot_date,current_balance,provenance)
 values(u,a,'2026-04-28',23000,'observed');
 perform public.materialize_manual_asset(u,a,'2026-04-28');
 assert not exists(select 1 from public.manual_account_values where manual_account_id=a and valuation_date='2026-04-28'), 'Estimate superseded observed history';
 assert (select current_balance=23000 from public.account_balance_snapshots where manual_account_id=a and snapshot_date='2026-04-28'), 'Observation overwritten';
 -- Leap-day annual anchoring, absolute depreciation, and floor at zero.
 b=public.save_manual_asset(u,'{"name":"Car","assetKind":"vehicle","value":1000,"valuationDate":"2024-02-29","valueSource":"Invoice","ownershipPercentage":100,"growth":{"kind":"absolute","amount":-600,"period":"year"}}','2026-02-28');
 assert (select gross_value=400 from public.manual_account_values where manual_account_id=b and valuation_date='2025-02-28'), 'Annual leap anniversary wrong';
 assert (select balance=0 from public.manual_account_balances where id=b), 'Depreciation went below zero';
 -- Delayed start and partial periods never accrue a full period early.
 b=public.save_manual_asset(u,'{"name":"Delayed","assetKind":"other","value":100,"valuationDate":"2026-01-01","valueSource":"Entry","ownershipPercentage":10,"growth":{"kind":"percent","amount":20,"period":"month","startDate":"2026-02-15"}}','2026-03-14');
 assert (select balance=10 from public.manual_account_balances where id=b), 'Growth started early';
 perform public.materialize_manual_asset(u,b,'2026-03-15');
 assert (select balance=12 from public.manual_account_balances where id=b), 'Growth anniversary not applied';
 b=public.save_manual_asset(u,'{"name":"Static","assetKind":"other","value":100,"valuationDate":"2026-01-01","valueSource":"Entry","ownershipPercentage":25}','2026-03-31');
 assert (select balance=25 and name='Static' from public.manual_account_balances where id=b), 'Static owned value wrong';
 assert not has_function_privilege('authenticated','public.save_manual_asset(uuid,jsonb,date)','execute'), 'Client can bypass API';
 assert not has_function_privilege('authenticated','public.materialize_manual_asset(uuid,uuid,date)','execute'), 'Client can forge estimates';
 assert not has_table_privilege('authenticated','public.manual_account_values','insert'), 'Client can write history';
 perform set_config('request.jwt.claim.sub',other_u::text,true);
end $$;
set local role authenticated;
do $$ begin
 assert (select count(*)=0 from public.manual_assets), 'Foreign asset leaked';
 assert (select count(*)=0 from public.manual_account_values), 'Foreign history leaked';
 assert (select count(*)=0 from public.manual_account_balances), 'Security-invoker view leaked';
end $$;
reset role;
rollback;
