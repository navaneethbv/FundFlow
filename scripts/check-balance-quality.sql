-- Disposable database only. All synthetic fixtures roll back.
begin;
insert into auth.users(id,email) values
 ('81000000-0000-0000-0000-000000000001','quality-owner@example.invalid'),
 ('81000000-0000-0000-0000-000000000002','quality-other@example.invalid');
insert into public.plaid_items(id,user_id,plaid_item_id,access_token_ciphertext,access_token_iv,access_token_tag)
 values('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','quality-item','test','test','test');
insert into public.accounts(id,user_id,plaid_item_id,plaid_account_id)
 values('83000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','quality-account');
insert into public.account_balance_snapshots(id,user_id,account_id,snapshot_date,current_balance,captured_at) values
 ('84000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001','2026-09-30',2000,'2026-09-30T12:00:00Z'),
 ('84000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001','2026-10-01',8000,'2026-10-01T12:00:00Z');
do $$ declare
 u uuid='81000000-0000-0000-0000-000000000001'; other_u uuid='81000000-0000-0000-0000-000000000002';
 prior uuid='84000000-0000-0000-0000-000000000001'; current_id uuid='84000000-0000-0000-0000-000000000002';
 review_id uuid; first_version uuid; context jsonb;
begin
 context=public.balance_quality_context(u,'2026-10-01');
 assert jsonb_array_length(context)=1 and (context->0->'previous'->>'balance')::numeric=2000, 'Missing reliable anchor';
 assert context->0->'current'->'holdings'='null'::jsonb, 'Unobserved holdings treated as empty';
 assert public.balance_quality_context(other_u,'2026-10-01')='[]'::jsonb, 'Foreign context leaked';
 review_id=public.record_balance_quality_review(u,current_id,'2026-10-01T12:00:00Z',prior,'{balance_jump}');
 select version into first_version from public.balance_quality_reviews where id=review_id;
 begin
  perform public.resolve_balance_quality_review(other_u,review_id,first_version,'accepted');
  raise exception 'Foreign decision accepted';
 exception when no_data_found then null; end;
 begin
  perform public.resolve_balance_quality_review(u,review_id,gen_random_uuid(),'accepted');
  raise exception 'Stale version accepted';
 exception when serialization_failure then null; end;
 perform public.resolve_balance_quality_review(u,review_id,first_version,'carried');
 perform public.resolve_balance_quality_review(u,review_id,first_version,'carried');
 assert (select current_balance=8000 from public.account_balance_snapshots where id=current_id), 'Decision rewrote raw balance';
 assert (select anchor_balance=2000 and decision='carried' from public.balance_quality_reviews where id=review_id), 'Stale value not retained';
 begin
  perform public.resolve_balance_quality_review(u,review_id,first_version,'accepted');
  raise exception 'Resolved decision overwritten';
 exception when serialization_failure then null; end;
 assert public.record_balance_quality_review(u,current_id,'2026-10-01T12:00:00Z',prior,'{balance_jump}')=review_id, 'Replay duplicates review';
 assert (select count(*)=1 from public.balance_quality_reviews where snapshot_id=current_id), 'Replay duplicates rows';
 update public.account_balance_snapshots set current_balance=10000,captured_at='2026-10-01T13:00:00Z' where id=current_id;
 begin
  perform public.resolve_balance_quality_review(u,review_id,first_version,'carried');
  raise exception 'Changed raw observation accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.record_balance_quality_review(u,current_id,'2026-10-01T12:00:00Z',prior,'{balance_jump}');
  raise exception 'Stale job accepted';
 exception when serialization_failure then null; end;
 perform public.record_balance_quality_review(u,current_id,'2026-10-01T13:00:00Z',prior,'{balance_jump}');
 assert (select count(*)=2 from public.balance_quality_reviews where snapshot_id=current_id), 'Decision history lost';
 assert (select superseded_at is not null from public.balance_quality_reviews where id=review_id), 'Old decision still active';
 perform public.record_balance_quality_review(u,current_id,'2026-10-01T13:00:00Z',prior,'{}');
 assert not exists(select 1 from public.balance_quality_reviews where snapshot_id=current_id and superseded_at is null), 'Clean observation retained active concern';
 assert not has_table_privilege('authenticated','public.balance_quality_reviews','UPDATE'), 'Client can alter financial review';
 assert not has_function_privilege('authenticated','public.record_balance_quality_review(uuid,uuid,timestamptz,uuid,text[])','EXECUTE'), 'Client can fabricate reviews';
 assert not has_function_privilege('authenticated','public.resolve_balance_quality_review(uuid,uuid,uuid,text)','EXECUTE'), 'Client can bypass route';
end $$;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ begin assert (select count(*)=2 from public.balance_quality_reviews), 'Owner cannot read history'; end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ begin assert not exists(select 1 from public.balance_quality_reviews), 'Other user can read history'; end $$;
reset role;
rollback;
