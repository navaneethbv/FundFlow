-- Isolated database only. Synthetic fixtures are rolled back.
begin;
insert into auth.users(id, email) values
 ('51000000-0000-0000-0000-000000000001', 'pending-fixture@example.invalid');
insert into public.plaid_items(id,user_id,plaid_item_id,access_token_ciphertext,access_token_iv,access_token_tag)
 values ('52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','pending-fixture-item','fixture','fixture','fixture');
insert into public.accounts(id,user_id,plaid_item_id,plaid_account_id)
 values ('53000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','pending-fixture-account');
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,amount,date,pending)
 values ('54000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-pending',40,'2026-10-01',true);
insert into public.transaction_annotations(user_id,transaction_id,note,tags,display_category,cash_flow_classification)
 values ('51000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000001','Trip meal',array['trip'],'Dining','expense');
insert into public.transaction_splits(user_id,transaction_id,category,amount) values
 ('51000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000001','Dining',30),
 ('51000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000001','Travel',10);
update public.transaction_review_states set version=7 where transaction_id='54000000-0000-0000-0000-000000000001';

-- Plaid removes the pending row on an earlier page than its replacement.
\if :legacy
 delete from public.transactions where user_id='51000000-0000-0000-0000-000000000001' and plaid_transaction_id='fixture-pending';
\else
 select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',array['fixture-pending'],false,true);
\endif
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,pending_transaction_id,amount,date,pending)
 values ('54000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-posted','fixture-pending',40,'2026-10-02',false);
\if :legacy
\else
 select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',array[]::text[],true,false);
\endif

do $$ begin
 assert exists (select 1 from public.transaction_annotations where transaction_id='54000000-0000-0000-0000-000000000002' and note='Trip meal' and tags=array['trip'] and display_category='Dining' and cash_flow_classification='expense'), 'Pending annotation, tags and override were lost';
 assert (select sum(amount) from public.transaction_splits where transaction_id='54000000-0000-0000-0000-000000000002')=40, 'Pending splits were lost';
 assert exists (select 1 from public.transaction_review_states where transaction_id='54000000-0000-0000-0000-000000000002' and status='needs_review' and version>7), 'Review state/version was lost';
 assert not exists(select 1 from public.transactions where plaid_transaction_id='fixture-pending'), 'Pending row still counted';
end $$;
-- Replaying a completed chain cannot erase edits or regress reviewed state.
update public.transaction_review_states set status='reviewed', reviewed_at=now(), version=20
 where transaction_id='54000000-0000-0000-0000-000000000002';
select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',array['fixture-pending'],true,true);
do $$ begin
 assert exists(select 1 from public.transaction_review_states where transaction_id='54000000-0000-0000-0000-000000000002' and status='reviewed' and version=20), 'Replay changed review state';
 assert not has_function_privilege('authenticated','public.finish_transaction_sync_page(uuid,uuid,text[],boolean,boolean)','EXECUTE'), 'Client may invoke provider writes';
 assert not has_function_privilege('anon','public.finish_transaction_sync_page(uuid,uuid,text[],boolean,boolean)','EXECUTE'), 'Anonymous may invoke provider writes';
end $$;

-- A conflicting posted edit refuses the complete operation, retaining the queue
-- and every source annotation. No partial moves or deletes may escape failure.
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,amount,date,pending)
 values ('54000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-pending',40,'2026-10-01',true);
insert into public.transaction_annotations(user_id,transaction_id,note)
 values ('51000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000001','Conflicting note');
select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',array['fixture-pending'],false,true);
do $$ begin
 begin
  perform public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','{}',true,false);
  raise exception 'Conflict incorrectly succeeded';
 exception when raise_exception then
  if sqlerrm <> 'Pending and posted annotations both edited; reconcile before retrying sync' then raise; end if;
 end;
 assert (select count(*) from public.transaction_annotations where user_id='51000000-0000-0000-0000-000000000001')=2, 'Conflict lost an edit';
 assert (select transaction_removal_ids from public.plaid_items where id='52000000-0000-0000-0000-000000000001')=array['fixture-pending'], 'Conflict lost queued removal';
 begin
  perform public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000099','52000000-0000-0000-0000-000000000001','{}',true,true);
  raise exception 'Cross-owner item access succeeded';
 exception when raise_exception then
  if sqlerrm <> 'Sync item not found for owner' then raise; end if;
 end;
end $$;
-- A restart discards tombstones from an invalidated pagination chain.
select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','{}',true,true);
do $$ begin
 assert exists(select 1 from public.transactions where plaid_transaction_id='fixture-pending'), 'Restart applied stale tombstone';
end $$;
rollback;
