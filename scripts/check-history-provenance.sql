-- Disposable synthetic fixtures only.
begin;
insert into auth.users(id,email) values('85000000-0000-0000-0000-000000000001','history-source@example.invalid');
insert into public.manual_accounts(id,user_id,name,account_type) values('86000000-0000-0000-0000-000000000001','85000000-0000-0000-0000-000000000001','Asset','cash');
insert into public.plaid_items(id,user_id,plaid_item_id,access_token_ciphertext,access_token_iv,access_token_tag)
 values('88000000-0000-0000-0000-000000000001','85000000-0000-0000-0000-000000000001','source-item','test','test','test');
insert into public.accounts(id,user_id,plaid_item_id,plaid_account_id,iso_currency_code)
 values('89000000-0000-0000-0000-000000000001','85000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000001','source-account','USD');
insert into public.account_balance_snapshots(user_id,account_id,snapshot_date,current_balance,provenance)
 values('85000000-0000-0000-0000-000000000001','89000000-0000-0000-0000-000000000001','2026-01-01',300,'observed');
do $$ declare u uuid='85000000-0000-0000-0000-000000000001'; a uuid='86000000-0000-0000-0000-000000000001'; begin
 assert public.record_estimated_account_history(u,null,a,'2026-01-01',100,'USD'), 'Initial estimate not stored';
 assert public.record_estimated_account_history(u,null,a,'2026-01-01',120,'USD'), 'Estimate cannot refresh estimate';
 assert (select current_balance=120 and provenance='estimated' from public.account_balance_snapshots where manual_account_id=a), 'Wrong estimate';
 update public.account_balance_snapshots set current_balance=150,provenance='manual' where manual_account_id=a;
 assert not public.record_estimated_account_history(u,null,a,'2026-01-01',200,'USD'), 'Estimate overwrote manual observation';
 assert (select current_balance=150 and provenance='manual' from public.account_balance_snapshots where manual_account_id=a), 'Manual value changed';
 begin
  update public.account_balance_snapshots set current_balance=200,provenance='estimated' where manual_account_id=a;
  raise exception 'Direct update bypassed observation protection';
 exception when invalid_parameter_value then null; end;
 insert into public.account_balance_snapshots(user_id,manual_account_id,snapshot_date,current_balance) values(u,a,'2026-01-02',170);
 assert not public.record_estimated_account_history(u,null,a,'2026-01-02',200,'USD'), 'Estimate overwrote legacy observation';
 begin
  perform public.record_estimated_account_history('85000000-0000-0000-0000-000000000002',null,a,'2026-01-01',100,'USD');
  raise exception 'Foreign estimate accepted';
 exception when no_data_found then null; end;
 assert not public.record_estimated_account_history(u,'89000000-0000-0000-0000-000000000001',null,'2026-01-01',999,'USD'), 'Estimate overwrote provider observation';
 assert (select current_balance=300 and provenance='observed' from public.account_balance_snapshots where account_id='89000000-0000-0000-0000-000000000001'), 'Observed value changed';
 assert public.record_estimated_account_history(u,'89000000-0000-0000-0000-000000000001',null,'2026-01-02',320,'USD'), 'New estimated account date refused';
 begin
  perform public.record_estimated_account_history(u,'89000000-0000-0000-0000-000000000001',null,'2026-01-03',320,'EUR');
  raise exception 'Currency mismatch accepted';
 exception when no_data_found then null; end;
 assert not has_function_privilege('authenticated','public.record_estimated_account_history(uuid,uuid,uuid,date,numeric,text)','EXECUTE'), 'Client can bypass estimate route';
end $$;
rollback;
