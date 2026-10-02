-- Isolated database only. Synthetic records are rolled back.
begin;
insert into auth.users(id,email) values
 ('61000000-0000-0000-0000-000000000001','layout-owner@example.invalid'),
 ('61000000-0000-0000-0000-000000000002','layout-other@example.invalid');
insert into public.import_review_batches(id,user_id,file_name,layout_profile) values
 ('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','bank.csv','{"dateOrder":"dmy","positiveIsIncome":true}');
do $$ begin
 begin
  perform public.save_committed_import_profile('61000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','Bank');
  raise exception 'Pending preview saved';
 exception when raise_exception then
  if sqlerrm <> 'A successfully committed layout is required' then raise; end if;
 end;
end $$;
update public.import_review_batches set status='committed' where id='62000000-0000-0000-0000-000000000001';
do $$ begin
 begin
  perform public.save_committed_import_profile('61000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','Bank');
  raise exception 'Empty import saved';
 exception when raise_exception then
  if sqlerrm <> 'A successfully committed layout is required' then raise; end if;
 end;
end $$;
insert into public.import_review_rows(user_id,batch_id,row_hash,date,description,amount,status,row_index) values
 ('61000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','layout-test','2026-01-31','Cafe',12.5,'committed',0);
select public.save_committed_import_profile('61000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001',' Bank ');
do $$ begin
 assert exists(select 1 from public.import_profiles where user_id='61000000-0000-0000-0000-000000000001' and name='Bank' and layout->>'dateOrder'='dmy'), 'Layout snapshot lost';
 begin
  perform public.save_committed_import_profile('61000000-0000-0000-0000-000000000002','62000000-0000-0000-0000-000000000001','Foreign');
  raise exception 'Foreign batch saved';
 exception when raise_exception then
  if sqlerrm <> 'A successfully committed layout is required' then raise; end if;
 end;
 begin
  perform public.save_committed_import_profile('61000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','Bank');
  raise exception 'Duplicate overwrote layout';
 exception when raise_exception then
  if sqlerrm <> 'A layout with that name already exists' then raise; end if;
 end;
 assert not has_function_privilege('authenticated','public.save_committed_import_profile(uuid,uuid,text)','EXECUTE'), 'Client may save uncommitted layout';
 assert not has_function_privilege('anon','public.save_committed_import_profile(uuid,uuid,text)','EXECUTE'), 'Anonymous may save layout';
 assert not has_table_privilege('authenticated','public.import_profiles','INSERT'), 'Client may insert layout directly';
 assert not has_table_privilege('authenticated','public.import_profiles','UPDATE'), 'Client may rewrite layout directly';
end $$;
insert into public.import_profiles(user_id,name,layout)
 select '61000000-0000-0000-0000-000000000001','Layout '||value,'{}'::jsonb from generate_series(1,99) value;
do $$ begin
 begin
  perform public.save_committed_import_profile('61000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','Overflow');
  raise exception 'Quota overflow saved';
 exception when raise_exception then
  if sqlerrm <> 'Saved layout limit reached' then raise; end if;
 end;
end $$;
-- A valid owner session can read the layouts, making the isolation check non-vacuous.
select set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ begin
 assert (select count(*) from public.import_profiles)=100, 'Owner cannot read layouts';
end $$;
reset role;
-- RLS proves that an authenticated other owner cannot read the saved layouts.
select set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ begin
 assert not exists(select 1 from public.import_profiles), 'Foreign layout disclosed';
end $$;
reset role;
rollback;
