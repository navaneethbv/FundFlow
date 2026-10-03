-- Isolated database only. Synthetic records are rolled back.
begin;
insert into auth.users(id,email) values
 ('71000000-0000-0000-0000-000000000001','history-owner@example.invalid'),
 ('71000000-0000-0000-0000-000000000002','history-other@example.invalid');
insert into public.manual_accounts(id,user_id,name,account_type) values
 ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','Original wallet','cash'),
 ('72000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','Foreign wallet','cash');
insert into public.import_review_batches(id,user_id,file_name) values
 ('73000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','history.csv');
insert into public.import_review_rows(id,user_id,batch_id,row_hash,date,description,amount,row_index,review_flags) values
 ('74000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','history-1','2026-10-01','Cafe',10,0,'{}'),
 ('74000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','history-2','2026-10-01','Cafe',10,1,'{duplicate}');
do $$ declare v_summary jsonb; v_rows jsonb; begin
 v_rows='[{"id":"74000000-0000-0000-0000-000000000001","manual_account_id":"72000000-0000-0000-0000-000000000001"}]';
 perform public.finish_import_with_history('71000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001',v_rows);
 select history_summary into v_summary from public.import_review_batches where id='73000000-0000-0000-0000-000000000001';
 assert v_summary->>'imported'='1' and v_summary->>'skipped'='1' and v_summary->>'flagged'='1', 'Partial counts incorrect';
 assert v_summary->'targets'->0->>'name'='Original wallet', 'Account snapshot missing';
 assert v_summary->>'committedBy'='71000000-0000-0000-0000-000000000001', 'Wrong actor';
 update public.manual_accounts set name='Renamed wallet' where id='72000000-0000-0000-0000-000000000001';
 perform public.finish_import_with_history('71000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001',v_rows);
 assert (select history_summary=v_summary from public.import_review_batches where id='73000000-0000-0000-0000-000000000001'), 'Replay changed history';
 begin
  perform public.finish_import_with_history('71000000-0000-0000-0000-000000000002','73000000-0000-0000-0000-000000000001',v_rows);
  raise exception 'Foreign batch accepted';
 exception when raise_exception then if sqlerrm<>'Import batch not found' then raise; end if; end;
 begin
  perform public.finish_import_with_history('71000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','[{"id":"74000000-0000-0000-0000-000000000002","manual_account_id":"72000000-0000-0000-0000-000000000002"}]');
  raise exception 'Foreign target accepted';
 exception when raise_exception then if sqlerrm<>'Invalid import history target' then raise; end if; end;
 assert (select status='pending' from public.import_review_rows where id='74000000-0000-0000-0000-000000000002'), 'Failed operation changed row';
 begin
  perform public.finish_import_with_history('71000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001',v_rows||v_rows);
  raise exception 'Duplicate accepted';
 exception when raise_exception then if sqlerrm<>'Duplicate import history row' then raise; end if; end;
 perform public.finish_import_with_history('71000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','[{"id":"74000000-0000-0000-0000-000000000002","manual_account_id":"72000000-0000-0000-0000-000000000001"}]');
 select history_summary into v_summary from public.import_review_batches where id='73000000-0000-0000-0000-000000000001';
 assert jsonb_array_length(v_summary->'targets')=1, 'Renamed account duplicated';
 assert v_summary->>'imported'='2' and v_summary->>'skipped'='0' and v_summary->>'flagged'='1', 'Approved flagged row lost';
 assert not has_table_privilege('authenticated','public.import_review_batches','UPDATE'), 'Client can alter batch metadata';
 assert not has_table_privilege('authenticated','public.import_review_rows','INSERT'), 'Client can fabricate review rows';
 assert not has_function_privilege('authenticated','public.finish_import_with_history(uuid,uuid,jsonb)','EXECUTE'), 'Client can rewrite history';
 assert not has_function_privilege('anon','public.finish_import_with_history(uuid,uuid,jsonb)','EXECUTE'), 'Anonymous can rewrite history';
end $$;
select set_config('request.jwt.claims','{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ begin
 assert exists(select 1 from public.import_review_batches where id='73000000-0000-0000-0000-000000000001' and history_summary->>'imported'='2'), 'Owner cannot read history';
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ begin
 assert not exists(select 1 from public.import_review_batches where id='73000000-0000-0000-0000-000000000001'), 'Foreign history disclosed';
end $$;
reset role;
rollback;
