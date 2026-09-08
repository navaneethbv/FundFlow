-- Run only against an isolated database. Every fixture is rolled back.
begin;

-- Create test users
insert into auth.users(id, email) values
  ('55000000-0000-0000-0000-000000000001', 'review-user-a@example.com'),
  ('55000000-0000-0000-0000-000000000002', 'review-user-b@example.com');

insert into public.manual_accounts(id, user_id, name, account_type, balance) values
  ('66000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000001', 'Checking', 'cash', 1000),
  ('66000000-0000-0000-0000-000000000002', '55000000-0000-0000-0000-000000000002', 'User B Account', 'cash', 500);

-- Insert transactions for User A
insert into public.transactions(id, user_id, manual_account_id, plaid_transaction_id, date, amount, name, merchant_name, pfc_primary, source, pending) values
  ('77000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', 'tx-test-1', '2026-09-01', 50, 'Coffee', 'Starbucks', 'FOOD_AND_DRINK', 'manual', false),
  ('77000000-0000-0000-0000-000000000002', '55000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', 'tx-test-2', '2026-09-02', 120, 'Groceries', 'Whole Foods', 'FOOD_AND_DRINK', 'manual', false),
  ('77000000-0000-0000-0000-000000000003', '55000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', 'tx-test-3', '2026-09-03', 25, 'Pending Cab', 'Uber', 'TRAVEL', 'manual', true),
  ('77000000-0000-0000-0000-000000000004', '55000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', 'tx-test-4', '2026-09-04', 30, 'Duplicate 1', 'Store', 'GENERAL_MERCHANDISE', 'manual', false),
  ('77000000-0000-0000-0000-000000000005', '55000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', 'tx-test-5', '2026-09-04', 30, 'Duplicate 2', 'Store', 'GENERAL_MERCHANDISE', 'manual', false);

-- Insert transaction for User B
insert into public.transactions(id, user_id, manual_account_id, plaid_transaction_id, date, amount, name, merchant_name, pfc_primary, source, pending) values
  ('77000000-0000-0000-0000-000000000009', '55000000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-000000000002', 'tx-test-b1', '2026-09-01', 99, 'B Purchase', 'Target', 'GENERAL_MERCHANDISE', 'manual', false);

-- Link duplicates for User A (exclude tx-test-5)
insert into public.linked_duplicates(id, user_id, subject_id, kept_transaction_id, excluded_transaction_id) values
  ('88000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000001', '77000000-0000-0000-0000-000000000004:77000000-0000-0000-0000-000000000005', '77000000-0000-0000-0000-000000000004', '77000000-0000-0000-0000-000000000005');

-- Test 1: Assert all transactions have needs_review state initialized
do $$
begin
  assert (
    select count(*) from public.transaction_review_states
    where user_id = '55000000-0000-0000-0000-000000000001' and status = 'needs_review' and version = 1
  ) = 5, 'User A should have 5 transactions in needs_review with version 1';

  assert (
    select count(*) from public.transaction_review_states
    where user_id = '55000000-0000-0000-0000-000000000002' and status = 'needs_review' and version = 1
  ) = 1, 'User B should have 1 transaction in needs_review with version 1';
end $$;

-- Test 2: RLS check for User A
select set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated","session_id":"review-session"}', true);
set local role authenticated;

do $$
declare
  v_count integer;
  v_view_row record;
begin
  -- Authenticated user can select own review states
  select count(*) into v_count from public.transaction_review_states;
  assert v_count = 5, 'User A should only see their 5 review states';

  -- Authenticated user cannot write directly to transaction_review_states
  begin
    update public.transaction_review_states set status = 'reviewed' where transaction_id = '77000000-0000-0000-0000-000000000001';
    raise exception 'Direct update permitted';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.transaction_review_states(transaction_id, user_id, status) values ('77000000-0000-0000-0000-000000000001', auth.uid(), 'reviewed');
    raise exception 'Direct insert permitted';
  exception when insufficient_privilege then null; end;

  -- Authenticated user cannot execute atomic RPC directly
  begin
    perform public.set_transaction_review_state_atomic(auth.uid(), 'reviewed', '[]'::jsonb);
    raise exception 'Direct RPC execution permitted';
  exception when insufficient_privilege then null; end;

  -- Read view tests
  select * into v_view_row from public.transaction_review_ledger where id = '77000000-0000-0000-0000-000000000001';
  assert v_view_row.review_eligible = true, 'Posted non-duplicate row should be review_eligible';
  assert v_view_row.review_status = 'needs_review', 'Should have needs_review status';

  select * into v_view_row from public.transaction_review_ledger where id = '77000000-0000-0000-0000-000000000003';
  assert v_view_row.review_eligible = false, 'Pending row should not be review_eligible';

  select * into v_view_row from public.transaction_review_ledger where id = '77000000-0000-0000-0000-000000000005';
  assert v_view_row.review_eligible = false, 'Excluded duplicate row should not be review_eligible';
end $$;

reset role;

-- Test 2b: anonymous role sees nothing through the table or the view
set local role anon;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.transaction_review_states;
  assert v_count = 0, 'anon must not read transaction_review_states';
  select count(*) into v_count from public.transaction_review_ledger;
  assert v_count = 0, 'anon must not read transaction_review_ledger';
  begin
    perform public.set_transaction_review_state_atomic(
      '55000000-0000-0000-0000-000000000001', 'reviewed', '[]'::jsonb);
    raise exception 'anon executed the atomic RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Test 2c: an aal1 session for a user WITH a verified factor is MFA-insufficient
-- and must be denied even though user_id = auth.uid() holds.
insert into auth.mfa_factors(id, user_id, status, factor_type, friendly_name, created_at, updated_at) values
  ('99000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000001', 'verified', 'totp', 'Test', now(), now());
select set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated","session_id":"review-session"}', true);
set local role authenticated;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.transaction_review_states;
  assert v_count = 0, 'aal1 session with an enrolled factor must not read review states';
end $$;
reset role;
delete from auth.mfa_factors where id = '99000000-0000-0000-0000-000000000001';

-- Test 3: Service role executes set_transaction_review_state_atomic
do $$
declare
  v_res jsonb;
  v_rev record;
begin
  -- Single item mark reviewed
  v_res := public.set_transaction_review_state_atomic(
    '55000000-0000-0000-0000-000000000001',
    'reviewed',
    '[{"transaction_id": "77000000-0000-0000-0000-000000000001", "expected_version": "1"}]'::jsonb
  );
  assert (v_res->>'updated')::int = 1, 'Should update 1 item';
  assert (v_res->>'unchanged')::int = 0, 'Should be 0 unchanged';
  assert (v_res->'items'->0->>'version') = '2', 'Version should increment to 2';
  assert (v_res->'items'->0->>'status') = 'reviewed', 'Status should be reviewed';
  assert (v_res->'items'->0->>'reviewed_at') is not null, 'reviewed_at should be non-null';

  -- No-op repeat request
  v_res := public.set_transaction_review_state_atomic(
    '55000000-0000-0000-0000-000000000001',
    'reviewed',
    '[{"transaction_id": "77000000-0000-0000-0000-000000000001", "expected_version": "2"}]'::jsonb
  );
  assert (v_res->>'updated')::int = 0, 'Should be 0 updated';
  assert (v_res->>'unchanged')::int = 1, 'Should be 1 unchanged';

  -- Stale version rejection (409)
  begin
    perform public.set_transaction_review_state_atomic(
      '55000000-0000-0000-0000-000000000001',
      'needs_review',
      '[{"transaction_id": "77000000-0000-0000-0000-000000000001", "expected_version": "1"}]'::jsonb
    );
    raise exception 'Stale version accepted';
  exception when sqlstate '40001' then null; end;

  -- Rejection of pending transaction
  begin
    perform public.set_transaction_review_state_atomic(
      '55000000-0000-0000-0000-000000000001',
      'reviewed',
      '[{"transaction_id": "77000000-0000-0000-0000-000000000003", "expected_version": "1"}]'::jsonb
    );
    raise exception 'Pending transaction review accepted';
  exception when sqlstate '40001' then null; end;

  -- Rejection of excluded duplicate transaction
  begin
    perform public.set_transaction_review_state_atomic(
      '55000000-0000-0000-0000-000000000001',
      'reviewed',
      '[{"transaction_id": "77000000-0000-0000-0000-000000000005", "expected_version": "1"}]'::jsonb
    );
    raise exception 'Excluded duplicate review accepted';
  exception when sqlstate '40001' then null; end;

  -- Rejection of foreign transaction (User B transaction submitted as User A)
  begin
    perform public.set_transaction_review_state_atomic(
      '55000000-0000-0000-0000-000000000001',
      'reviewed',
      '[{"transaction_id": "77000000-0000-0000-0000-000000000009", "expected_version": "1"}]'::jsonb
    );
    raise exception 'Foreign transaction review accepted';
  exception when sqlstate 'P0002' then null; end;

  -- Material update reopening test:
  -- Update amount of tx-test-1 (currently reviewed with version 2)
  update public.transactions set amount = 65.00 where id = '77000000-0000-0000-0000-000000000001';
  select * into v_rev from public.transaction_review_states where transaction_id = '77000000-0000-0000-0000-000000000001';
  assert v_rev.status = 'needs_review', 'Material update must reset status to needs_review';
  assert v_rev.reviewed_at is null, 'Material update must clear reviewed_at';
  assert v_rev.version = 3, 'Material update must advance version from 2 to 3';

  -- Non-material update test:
  -- Updating updated_at alone must NOT reset status or increment version
  update public.transactions set updated_at = now() + interval '1 hour' where id = '77000000-0000-0000-0000-000000000001';
  select * into v_rev from public.transaction_review_states where transaction_id = '77000000-0000-0000-0000-000000000001';
  assert v_rev.version = 3, 'Non-material update must not change version';
end $$;

rollback;
