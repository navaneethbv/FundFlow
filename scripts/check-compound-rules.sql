-- Run on an isolated database only; all synthetic records roll back.
begin;
insert into auth.users(id,email) values ('71000000-0000-0000-0000-000000000001','rules-owner@example.invalid'),('71000000-0000-0000-0000-000000000002','rules-other@example.invalid');
insert into public.plaid_items(id,user_id,plaid_item_id,access_token_ciphertext,access_token_iv,access_token_tag) values ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','rules-fixture','fixture','fixture','fixture');
insert into public.accounts(id,user_id,plaid_item_id,plaid_account_id) values ('73000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','rules-account');
insert into public.transactions(id,user_id,account_id,plaid_transaction_id,amount,date,pending,merchant_name,pfc_primary) values
 ('74000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','rule-tx',40,'2026-10-01',false,'Raw cafe','FOOD');
insert into public.transaction_annotations(user_id,transaction_id,note,tags,display_category) values ('71000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000001','Keep note',array['mine'],'Manual');
insert into public.merchant_rules(id,user_id,match_type,pattern,conditions,actions) values ('75000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','compound','compound','{"op":"and","children":[{"field":"amount","operator":"gt","value":30}]}','{"category":"Dining","tags":["rule"]}');
insert into public.rule_runs(id,user_id,rule_id,trigger,matched) values ('76000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000001','manual',1);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ declare rows jsonb; result integer; begin
 select jsonb_build_array(jsonb_build_object('id',t.id,'version',t.updated_at,'annotationVersion',a.updated_at,'actions','{"category":"Dining","tags":["rule"],"notify":true}'::jsonb,'ruleId','75000000-0000-0000-0000-000000000001')) into rows from public.transactions t join public.transaction_annotations a on a.transaction_id=t.id where t.id='74000000-0000-0000-0000-000000000001';
 result := public.apply_compound_rule_run('71000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000001',rows);
 assert result=1, 'Expected one changed row';
 assert (select note='Keep note' and tags=array['mine'] and display_category='Manual' and rule_actions->>'category'='Dining' from public.transaction_annotations where transaction_id='74000000-0000-0000-0000-000000000001'), 'User annotations changed';
 assert (select merchant_name='Raw cafe' and pfc_primary='FOOD' and amount=40 from public.transactions where id='74000000-0000-0000-0000-000000000001'), 'Provider facts changed';
 assert (select status='success' and changed=1 from public.rule_runs where id='76000000-0000-0000-0000-000000000001'), 'Run not completed';
 assert (select count(*) from public.rule_changes)=1, 'Provenance missing';
 assert (select count(*) from public.notifications where type='rule_match')=1, 'Rule notification missing';
 begin
  perform public.apply_compound_rule_run('71000000-0000-0000-0000-000000000002',null,rows);
  raise exception 'Foreign write accepted';
 exception when serialization_failure then null; end;
 rows := jsonb_set(rows,'{0,annotationVersion}','"2000-01-01T00:00:00Z"');
 begin
  perform public.apply_compound_rule_run('71000000-0000-0000-0000-000000000001',null,rows);
  raise exception 'Stale annotation overwritten';
 exception when serialization_failure then null; end;
 assert not has_function_privilege('authenticated','public.apply_compound_rule_run(uuid,uuid,jsonb)','execute'), 'Client may call rule writer';
 assert not has_column_privilege('authenticated','public.merchant_rules','conditions','insert'), 'Client may bypass condition validation';
 assert not has_column_privilege('authenticated','public.transaction_annotations','rule_actions','update'), 'Client may forge effects';
 assert has_column_privilege('authenticated','public.transaction_annotations','note','update'), 'Existing annotation write removed';
 assert private.rule_condition_leaves('{"op":"and","children":[]}')=-1;
 assert private.rule_condition_leaves('{"op":"and","children":[{"op":"and","children":[{"op":"and","children":[{"op":"and","children":[{"field":"amount","operator":"any"}]}]}]}]}')=-1;
 begin
  update public.merchant_rules set conditions='{"field":"unknown"}' where id='75000000-0000-0000-0000-000000000001';
  raise exception 'Invalid condition stored';
 exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ begin
 assert (select count(*) from public.rule_runs)=1, 'Owner cannot read run';
 assert (select count(*) from public.rule_changes)=1, 'Owner cannot read change';
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ begin
 assert not exists(select 1 from public.rule_runs), 'Other owner read run';
 assert not exists(select 1 from public.rule_changes), 'Other owner read change';
end $$;
reset role;
rollback;
