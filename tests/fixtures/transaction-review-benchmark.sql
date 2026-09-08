-- Isolated database only. Fixtures and statistics changes roll back.
begin;
insert into auth.users(id,email) values('aa000000-0000-0000-0000-000000000001','review-benchmark@example.com');
insert into manual_accounts(id,user_id,name,account_type,balance) values
 ('aa000000-0000-0000-0000-000000000002','aa000000-0000-0000-0000-000000000001','Benchmark checking','cash',10000),
 ('aa000000-0000-0000-0000-000000000003','aa000000-0000-0000-0000-000000000001','Benchmark savings','cash',10000);
insert into transactions(id,user_id,manual_account_id,plaid_transaction_id,date,amount,name,merchant_name,pfc_primary,pending,source)
select md5('review-bench-'||i)::uuid,'aa000000-0000-0000-0000-000000000001',
 case when i%2=0 then 'aa000000-0000-0000-0000-000000000002'::uuid else 'aa000000-0000-0000-0000-000000000003'::uuid end,
 'review-bench-'||i,'2026-09-01'::date-(i%180),i%1000,'Benchmark '||(i%50),'Benchmark '||(i%50),'GENERAL_MERCHANDISE',i%10=0,'manual'
from generate_series(1,10000) i;
update transaction_review_states set status='reviewed',reviewed_at=now(),version=2
where user_id='aa000000-0000-0000-0000-000000000001' and transaction_id in(select md5('review-bench-'||i)::uuid from generate_series(1,10000) i where i%3=0);
insert into linked_duplicates(user_id,subject_id,kept_transaction_id,excluded_transaction_id)
select 'aa000000-0000-0000-0000-000000000001','bench-duplicate-'||i,md5('review-bench-'||(i-1))::uuid,md5('review-bench-'||i)::uuid
from generate_series(20,10000,20) i;
analyze transactions;
analyze transaction_review_states;
analyze linked_duplicates;
select set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
\echo BASELINE_DATE
explain(analyze,buffers,format json) select id,date,amount,name from transactions where user_id='aa000000-0000-0000-0000-000000000001' order by date desc,id asc limit 51;
\echo REVIEW_DATE
explain(analyze,buffers,format json) select id,date,amount,name,review_status,review_version,review_eligible from transaction_review_ledger where user_id='aa000000-0000-0000-0000-000000000001' order by date desc,id asc limit 51;
\echo NEEDS_REVIEW_DATE
explain(analyze,buffers,format json) select id,date,amount,name,review_status,review_version,review_eligible from transaction_review_ledger where user_id='aa000000-0000-0000-0000-000000000001' and review_status='needs_review' and review_eligible order by date desc,id asc limit 51;
\echo OWNER_COUNT
explain(analyze,buffers,format json) select count(*) from transaction_review_ledger where user_id='aa000000-0000-0000-0000-000000000001' and review_status='needs_review' and review_eligible;
\echo MISSING_COUNT
explain(analyze,buffers,format json) select count(*) from transaction_review_ledger where user_id='aa000000-0000-0000-0000-000000000001' and review_state_missing;
\echo PROJECTION_SCAN_CHUNK
explain(analyze,buffers,format json) select id,date,amount,name,merchant_name,pfc_primary,pfc_detailed,account_id,manual_account_id,review_status,review_version,review_eligible from transaction_review_ledger where user_id='aa000000-0000-0000-0000-000000000001' and review_status='needs_review' and review_eligible order by date desc,id asc limit 1000;
rollback;
