-- Run only against an isolated database. Every fixture is rolled back.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('11000000-0000-0000-0000-000000000001','financial-write-test@example.com'),
 ('11000000-0000-0000-0000-000000000002','financial-write-other@example.com');
insert into public.manual_accounts(id,user_id,name,account_type,balance) values
 ('22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Cash','cash',123),
 ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','Debt','liability',500),
 ('22000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000002','Other','cash',100);
insert into public.transactions(id,user_id,manual_account_id,plaid_transaction_id,date,amount,name,source,pending) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','manual-test-1','2026-09-02',100,'Expense','manual',false),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','manual-test-2','2026-09-03',20,'Outstanding','manual',false),
 ('33000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','manual-test-3','2026-10-02',100,'Later','manual',false);
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated","session_id":"test-session"}',true);
set local role authenticated;
do $$ declare s jsonb; begin
  s:= public.get_reconciliation_preview('manual','22000000-0000-0000-0000-000000000001','2026-09-30');
  assert (s->>'needsOpeningBalance')::boolean, 'First statement must require opening balance';
  begin
    perform public.get_reconciliation_preview('manual','22000000-0000-0000-0000-000000000003','2026-09-30');
    raise exception 'Cross-user read accepted';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.account_reconciliations(user_id,manual_account_id,statement_date,statement_balance,basis)
      values(auth.uid(),'22000000-0000-0000-0000-000000000001','2026-09-30',0,'{"originDate":"2026-09-01"}');
    raise exception 'Forged verified statement accepted';
  exception when insufficient_privilege then null; end;
  -- Exercise the old deployed route's exact insert shape without retaining a fixture.
  begin
    insert into public.account_reconciliations(user_id,manual_account_id,statement_date,statement_balance)
      values(auth.uid(),'22000000-0000-0000-0000-000000000001','2026-09-30',900);
    s:=public.get_reconciliation_preview('manual','22000000-0000-0000-0000-000000000001','2026-10-31');
    assert (s->>'needsOpeningBalance')::boolean, 'Legacy statement became a trusted opening balance';
    raise exception 'rollback legacy test';
  exception when raise_exception then if sqlerrm<>'rollback legacy test' then raise; end if; end;
  begin
    insert into public.account_reconciliations(user_id,manual_account_id,statement_date,statement_balance)
      values(auth.uid(),'22000000-0000-0000-0000-000000000003','2026-09-30',900);
    raise exception 'Legacy write accepted another user account';
  exception when insufficient_privilege then null; end;
  assert not has_column_privilege(current_user,'public.account_reconciliations','basis','INSERT');
  assert not has_table_privilege(current_user,'public.account_reconciliations','UPDATE');
  assert not has_table_privilege(current_user,'public.account_reconciliations','DELETE');
  assert not has_function_privilege(current_user,'public.save_reconciliation_atomic(uuid,text,uuid,date,numeric,date,numeric,uuid[],text,uuid,boolean)','execute');
  assert not has_function_privilege(current_user,'public.create_manual_transaction_atomic(uuid,text,uuid,numeric,date,text,text,text,uuid)','execute');
end $$;
reset role;
-- MFA gate is checked by the actual repository helper, not a mock.
insert into auth.mfa_factors(id,user_id,status,factor_type,friendly_name,created_at,updated_at) values
 ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','verified','totp','Test',now(),now());
set local role authenticated;
do $$ begin
  begin
    perform public.get_reconciliation_preview('manual','22000000-0000-0000-0000-000000000001','2026-09-30');
    raise exception 'AAL1 read accepted with MFA enrolled';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from auth.mfa_factors where id='44000000-0000-0000-0000-000000000001';

-- Revoked sessions cannot read financial previews through the definer function.
insert into public.user_session_records(user_id,session_id,revoked_at) values
 ('11000000-0000-0000-0000-000000000001','test-session',now());
set local role authenticated;
do $$ begin
  begin
    perform public.get_reconciliation_preview('manual','22000000-0000-0000-0000-000000000001','2026-09-30');
    raise exception 'Revoked session preview accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated","session_id":"fresh-session"}',true);

-- Exercise the exact write functions and verify every persisted effect under fault injection.
create function public.test_reject_adjustment() returns trigger language plpgsql as $$ begin
  if new.pfc_primary='RECONCILE_ADJUSTMENT' then raise exception 'Injected adjustment failure'; end if;
  return new;
end $$;
create trigger test_reject_adjustment before insert on public.transactions for each row execute function public.test_reject_adjustment();
do $$
declare s jsonb; r jsonb; first_result jsonb; revision text; before_count integer;
begin
  s:=private.reconciliation_state('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001','2026-09-30','2026-09-01',1000);
  assert jsonb_array_length(s->'transactions')=2, 'Historical statement included later transactions';
  revision:=s->>'revision';
  update public.manual_accounts set balance=9999 where id='22000000-0000-0000-0000-000000000001';
  assert revision = private.reconciliation_state('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001','2026-09-30','2026-09-01',1000)->>'revision', 'Live balance changed historical statement';
  begin
    perform public.save_reconciliation_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001','2026-09-30',850,'2026-09-01',1000,array['33000000-0000-0000-0000-000000000001']::uuid[],revision,'55000000-0000-0000-0000-000000000001',true);
    raise exception 'Expected injected failure';
  exception when raise_exception then
    if sqlerrm <> 'Injected adjustment failure' then raise; end if;
  end;
  assert not exists(select 1 from public.account_reconciliations where user_id='11000000-0000-0000-0000-000000000001'), 'Failed save left a statement';
  assert not exists(select 1 from public.transaction_annotations where user_id='11000000-0000-0000-0000-000000000001'), 'Failed save changed cleared flags';
  first_result:=public.save_reconciliation_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001','2026-09-30',900,'2026-09-01',1000,array['33000000-0000-0000-0000-000000000001']::uuid[],revision,'55000000-0000-0000-0000-000000000001',false);
  r:=public.save_reconciliation_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001','2026-09-30',900,'2026-09-01',1000,array['33000000-0000-0000-0000-000000000001']::uuid[],revision,'55000000-0000-0000-0000-000000000001',false);
  assert first_result=r and (r->>'difference')::numeric=0, 'Retry did not return the saved result';
  assert (select count(*) from public.account_reconciliations where user_id='11000000-0000-0000-0000-000000000001')=1, 'Retry duplicated the statement';
  s:=private.reconciliation_state('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001','2026-10-31',null,null);
  assert (s->>'openingBalance')::numeric=900 and jsonb_array_length(s->'transactions')=2, 'Outstanding item was not carried forward';
  begin
    perform public.save_reconciliation_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001','2026-10-31',780,null,null,array['33000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000003']::uuid[],revision,'55000000-0000-0000-0000-000000000002',false);
    raise exception 'Stale preview accepted';
  exception when serialization_failure then null; end;
  r:=public.save_reconciliation_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001','2026-10-31',780,null,null,array['33000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000003']::uuid[],s->>'revision','55000000-0000-0000-0000-000000000002',false);
  assert (r->>'difference')::numeric=0, 'Carry-forward statement did not balance';
  s:=private.reconciliation_state('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000002','2026-09-30','2026-09-01',500);
  assert (s->>'direction')::integer=1, 'Manual liability treated as an asset';
  select count(*) into before_count from public.transactions;
  begin
    perform public.create_manual_transaction_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000003',10,'2026-09-01','Unauthorized',null,null,null);
    raise exception 'Cross-user manual write accepted';
  exception when invalid_parameter_value then null; end;
  assert (select count(*) from public.transactions)=before_count;
end $$;
drop trigger test_reject_adjustment on public.transactions;
-- Now prove successful adjustments are cleared and not applied a second time.
do $$ declare s jsonb; r jsonb; begin
  s:=private.reconciliation_state('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000002','2026-09-30','2026-09-01',500);
  r:=public.save_reconciliation_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000002','2026-09-30',550,'2026-09-01',500,'{}',s->>'revision','55000000-0000-0000-0000-000000000003',true);
  assert (r->>'adjustment_amount')::numeric=50;
  assert exists(select 1 from public.transactions t join public.transaction_annotations a on a.transaction_id=t.id where t.plaid_transaction_id='manual-reconcile-55000000-0000-0000-0000-000000000003' and a.cleared_at is not null);
end $$;
create function public.test_reject_metadata() returns trigger language plpgsql as $$ begin
  if new.note='reject metadata' then raise exception 'Injected metadata failure'; end if;
  return new;
end $$;
create trigger test_reject_metadata before insert on public.transaction_annotations for each row execute function public.test_reject_metadata();
do $$ declare n integer; v_id uuid; begin
  select count(*) into n from public.transactions;
  begin
    perform public.create_manual_transaction_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001',10,'2026-09-01','Test',null,'reject metadata',null);
    raise exception 'Expected metadata failure';
  exception when raise_exception then if sqlerrm<>'Injected metadata failure' then raise; end if; end;
  assert (select count(*) from public.transactions)=n, 'Failed metadata left a transaction';
  v_id:=public.create_manual_transaction_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001',10,'2026-09-01','Test',null,'Saved note',null);
  assert exists(select 1 from public.transaction_annotations where transaction_id=v_id and note='Saved note');
end $$;
-- Goal progress is part of the same transaction, including failure rollback.
insert into public.goals(id,user_id,name,target_amount,spending_reduces) values
 ('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Trip',1000,true),
 ('66000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000002','Other trip',1000,true);
create function public.test_reject_goal_progress() returns trigger language plpgsql as $$ begin
  raise exception 'Injected goal progress failure';
end $$;
create trigger test_reject_goal_progress before insert on public.goal_progress_events for each row execute function public.test_reject_goal_progress();
do $$ declare n integer; begin
  select count(*) into n from public.transactions;
  begin
    perform public.create_manual_transaction_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001',10,'2026-09-01','Goal write',null,'Goal note','66000000-0000-0000-0000-000000000001');
    raise exception 'Expected goal progress failure';
  exception when raise_exception then if sqlerrm<>'Injected goal progress failure' then raise; end if; end;
  assert (select count(*) from public.transactions)=n, 'Failed goal progress left a transaction';
  assert not exists(select 1 from public.transaction_annotations where note='Goal note'), 'Failed goal progress left metadata';
  begin
    perform public.create_manual_transaction_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001',10,'2026-09-01','Goal write',null,null,'66000000-0000-0000-0000-000000000002');
    raise exception 'Cross-user goal accepted';
  exception when invalid_parameter_value then null; end;
end $$;
drop trigger test_reject_goal_progress on public.goal_progress_events;
do $$ declare v_id uuid; begin
  v_id:=public.create_manual_transaction_atomic('11000000-0000-0000-0000-000000000001','manual','22000000-0000-0000-0000-000000000001',10,'2026-09-01','Goal write',null,'Goal note','66000000-0000-0000-0000-000000000001');
  assert exists(select 1 from public.goal_progress_events where transaction_id=v_id and amount=-10), 'Goal progress missing';
  assert exists(select 1 from public.transaction_annotations where transaction_id=v_id and note='Goal note' and goal_id='66000000-0000-0000-0000-000000000001'), 'Goal annotation missing';
end $$;
rollback;
\echo 'Financial write contracts passed (fixtures rolled back)'
