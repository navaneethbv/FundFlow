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
do $$ begin
 if current_setting('fundflow.test_legacy_sync', true)='on' then
 delete from public.transactions where user_id='51000000-0000-0000-0000-000000000001' and plaid_transaction_id='fixture-pending';
else
 perform public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',array['fixture-pending'],false,true);
end if;
end $$;
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,pending_transaction_id,amount,date,pending)
 values ('54000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-posted','fixture-pending',40,'2026-10-02',false);
do $$ begin
 if current_setting('fundflow.test_legacy_sync', true) is distinct from 'on' then
 perform public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',array[]::text[],true,false);
end if;
end $$;

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

-- A conflicting posted edit skips carryover for that row only. The posted
-- edit survives, the pending row is removed as before carryover existed, and
-- the sync completes instead of failing every later run for the item.
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,amount,date,pending)
 values ('54000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-pending',40,'2026-10-01',true);
insert into public.transaction_annotations(user_id,transaction_id,note)
 values ('51000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000001','Conflicting note');
select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',array['fixture-pending'],false,true);
select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','{}',true,false);
do $$ begin
 assert exists(select 1 from public.transaction_annotations where transaction_id='54000000-0000-0000-0000-000000000002' and note='Trip meal'), 'Conflict overwrote the posted edit';
 assert not exists(select 1 from public.transactions where plaid_transaction_id='fixture-pending'), 'Conflict left the pending row counted';
 assert (select transaction_removal_ids from public.plaid_items where id='52000000-0000-0000-0000-000000000001')='{}', 'Conflict left the removal queued';
 begin
  perform public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000099','52000000-0000-0000-0000-000000000001','{}',true,true);
  raise exception 'Cross-owner item access succeeded';
 exception when raise_exception then
  if sqlerrm <> 'Sync item not found for owner' then raise; end if;
 end;
end $$;
-- A confirmed link on the pending row also skips carryover without failing.
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,amount,date,pending) values
 ('54000000-0000-0000-0000-000000000005','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-dup-pending',9,'2026-10-05',true),
 ('54000000-0000-0000-0000-000000000007','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-dup-other',9,'2026-10-05',false);
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,pending_transaction_id,amount,date,pending) values
 ('54000000-0000-0000-0000-000000000006','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-dup-posted','fixture-dup-pending',9,'2026-10-06',false);
insert into public.linked_duplicates(user_id,subject_id,kept_transaction_id,excluded_transaction_id) values
 ('51000000-0000-0000-0000-000000000001','fixture-dup-subject','54000000-0000-0000-0000-000000000007','54000000-0000-0000-0000-000000000005');
select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',array['fixture-dup-pending'],true,true);
do $$ begin
 assert not exists(select 1 from public.transactions where plaid_transaction_id='fixture-dup-pending'), 'Linked pending row still counted';
 assert exists(select 1 from public.transactions where plaid_transaction_id='fixture-dup-posted'), 'Posted replacement lost';
end $$;
-- A restart discards tombstones from an invalidated pagination chain.
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,amount,date,pending)
 values ('54000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-pending',40,'2026-10-01',true);
select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',array['fixture-pending'],false,true);
select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','{}',true,true);
do $$ begin
 assert exists(select 1 from public.transactions where plaid_transaction_id='fixture-pending'), 'Restart applied stale tombstone';
end $$;
delete from public.transactions where plaid_transaction_id='fixture-pending';
-- A posted row already linked to the same recurring stream or goal keeps one
-- link; the pending link must not violate either unique constraint.
insert into public.recurring_streams(id,user_id,plaid_item_id,stream_id)
 values ('55000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','pending-fixture-stream');
insert into public.goals(id,user_id,name,target_amount)
 values ('56000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','Fixture goal',100);
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,amount,date,pending) values
 ('54000000-0000-0000-0000-000000000003','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-linked-pending',12,'2026-10-03',true);
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,pending_transaction_id,amount,date,pending) values
 ('54000000-0000-0000-0000-000000000004','51000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','fixture-linked-posted','fixture-linked-pending',12,'2026-10-04',false);
insert into public.recurring_stream_transactions(user_id,recurring_stream_id,transaction_id) values
 ('51000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000003'),
 ('51000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000004');
insert into public.goal_progress_events(user_id,goal_id,event_date,amount,event_type,transaction_id) values
 ('51000000-0000-0000-0000-000000000001','56000000-0000-0000-0000-000000000001','2026-10-03',12,'transaction','54000000-0000-0000-0000-000000000003'),
 ('51000000-0000-0000-0000-000000000001','56000000-0000-0000-0000-000000000001','2026-10-04',12,'transaction','54000000-0000-0000-0000-000000000004');
select public.finish_transaction_sync_page('51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',array['fixture-linked-pending'],true,true);
do $$ begin
 assert (select count(*) from public.recurring_stream_transactions where recurring_stream_id='55000000-0000-0000-0000-000000000001')=1, 'Recurring link duplicated or lost';
 assert (select count(*) from public.goal_progress_events where goal_id='56000000-0000-0000-0000-000000000001' and transaction_id='54000000-0000-0000-0000-000000000004')=1, 'Goal event duplicated or lost';
 assert not exists(select 1 from public.goal_progress_events where goal_id='56000000-0000-0000-0000-000000000001' and transaction_id is null), 'Pending goal event survived detached';
end $$;
rollback;
