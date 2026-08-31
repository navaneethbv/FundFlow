begin;

select plan(32);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000301', 'recurring-owner-301@example.test'),
  ('00000000-0000-0000-0000-000000000302', 'recurring-other-302@example.test')
on conflict (id) do nothing;

insert into public.plaid_items (
  id, user_id, plaid_item_id, access_token_ciphertext,
  access_token_iv, access_token_tag, institution_name
)
values
  ('00000000-0000-0000-0000-000000001301', '00000000-0000-0000-0000-000000000301', 'recurring-item-301', 'cipher', 'iv', 'tag', 'Test Bank'),
  ('00000000-0000-0000-0000-000000001302', '00000000-0000-0000-0000-000000000301', 'recurring-item-302', 'cipher', 'iv', 'tag', 'Other Bank'),
  ('00000000-0000-0000-0000-000000001303', '00000000-0000-0000-0000-000000000302', 'recurring-item-303', 'cipher', 'iv', 'tag', 'Foreign Bank');

insert into public.accounts (
  id, user_id, plaid_item_id, plaid_account_id, name, iso_currency_code
)
values
  ('00000000-0000-0000-0000-000000002301', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000001301', 'recurring-account-301', 'Checking', 'USD');

insert into public.transactions (
  id, user_id, account_id, plaid_transaction_id, amount, iso_currency_code,
  date, name, merchant_name, pfc_primary, pfc_detailed, payment_channel
)
values
  ('00000000-0000-0000-0000-000000003301', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000002301', 'recurring-transaction-30001', 12.34, 'USD', '2026-06-01', 'Example Subscription', 'Example Subscription', 'ENTERTAINMENT', 'STREAMING', 'online'),
  ('00000000-0000-0000-0000-000000003302', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000002301', 'recurring-transaction-30002', 12.34, 'USD', '2026-07-01', 'Example Subscription', 'Example Subscription', 'ENTERTAINMENT', 'STREAMING', 'online'),
  ('00000000-0000-0000-0000-000000003303', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000002301', 'recurring-transaction-30003', 12.34, 'USD', '2026-08-01', 'Example Subscription', 'Example Subscription', 'ENTERTAINMENT', 'STREAMING', 'online');

insert into public.recurring_streams (
  id, user_id, plaid_item_id, stream_id, stream_type, source, identity_key,
  is_active, average_amount, account_id
)
values
  ('00000000-0000-0000-0000-000000004301', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000001301', 'stale-before-invalid', 'outflow', 'inferred', 'stale-before-invalid', true, 9.99, '00000000-0000-0000-0000-000000002301'),
  ('00000000-0000-0000-0000-000000004302', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000001302', 'stale-other-item', 'outflow', 'inferred', 'stale-other-item', true, 8.99, null),
  ('00000000-0000-0000-0000-000000004303', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000001303', 'stale-other-user', 'outflow', 'inferred', 'stale-other-user', true, 7.99, null),
  ('00000000-0000-0000-0000-000000004304', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000001301', 'plaid-example', 'outflow', 'plaid', null, true, 12.34, '00000000-0000-0000-0000-000000002301');

update public.recurring_streams
set reviewed_at = '2026-08-20T12:00:00Z',
    dismissed_at = '2026-08-21T12:00:00Z',
    user_amount = 99.99
where id = '00000000-0000-0000-0000-000000004304';

set local role service_role;

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    null::jsonb)$$,
  '22023', 'recurring_payload_invalid',
  'null payload is rejected before the stale sweep'
);

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    '{}'::jsonb)$$,
  '22023', 'recurring_payload_invalid',
  'missing payload arrays are rejected before the stale sweep'
);

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    '[]'::jsonb)$$,
  '22023', 'recurring_payload_invalid',
  'non-object payload is rejected before the stale sweep'
);

select is(
  (select is_active from public.recurring_streams where id = '00000000-0000-0000-0000-000000004301'),
  true,
  'malformed payloads leave the scoped stale stream active'
);

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', jsonb_build_array(jsonb_build_object(
        'identity_key', 'missing-stream-type', 'stream_id', 'missing-stream-type',
        'description', 'Missing Stream Type', 'merchant_name', 'Missing Stream Type',
        'expected_amount', 12.34, 'last_amount', 12.34, 'frequency', 'MONTHLY',
        'category', 'STREAMING', 'account_id', '00000000-0000-0000-0000-000000002301',
        'first_date', '2026-06-01', 'last_date', '2026-08-01',
        'predicted_next_date', '2026-09-01', 'detection_version', 1,
        'transaction_ids', jsonb_build_array('00000000-0000-0000-0000-000000003301'))),
      'deduplications', '[]'::jsonb))$$,
  '22023', 'recurring_candidate_payload_invalid',
  'missing stream_type is rejected during candidate preflight'
);

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', jsonb_build_array(jsonb_build_object(
        'identity_key', 'empty-stream-type', 'stream_id', 'empty-stream-type',
        'stream_type', '', 'description', 'Empty Stream Type', 'merchant_name', 'Empty Stream Type',
        'expected_amount', 12.34, 'last_amount', 12.34, 'frequency', 'MONTHLY',
        'category', 'STREAMING', 'account_id', '00000000-0000-0000-0000-000000002301',
        'first_date', '2026-06-01', 'last_date', '2026-08-01',
        'predicted_next_date', '2026-09-01', 'detection_version', 1,
        'transaction_ids', jsonb_build_array('00000000-0000-0000-0000-000000003301'))),
      'deduplications', '[]'::jsonb))$$,
  '22023', 'recurring_candidate_payload_invalid',
  'empty stream_type is rejected during candidate preflight'
);

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', jsonb_build_array(jsonb_build_object(
        'identity_key', 'missing-transaction-ids', 'stream_id', 'missing-transaction-ids',
        'stream_type', 'outflow', 'description', 'Missing Transaction IDs',
        'merchant_name', 'Missing Transaction IDs', 'expected_amount', 12.34,
        'last_amount', 12.34, 'frequency', 'MONTHLY', 'category', 'STREAMING',
        'account_id', '00000000-0000-0000-0000-000000002301',
        'first_date', '2026-06-01', 'last_date', '2026-08-01',
        'predicted_next_date', '2026-09-01', 'detection_version', 1)),
      'deduplications', '[]'::jsonb))$$,
  '22023', 'recurring_candidate_payload_invalid',
  'missing transaction_ids is rejected during candidate preflight'
);

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', jsonb_build_array(jsonb_build_object(
        'identity_key', 'empty-transaction-ids', 'stream_id', 'empty-transaction-ids',
        'stream_type', 'outflow', 'description', 'Empty Transaction IDs',
        'merchant_name', 'Empty Transaction IDs', 'expected_amount', 12.34,
        'last_amount', 12.34, 'frequency', 'MONTHLY', 'category', 'STREAMING',
        'account_id', '00000000-0000-0000-0000-000000002301',
        'first_date', '2026-06-01', 'last_date', '2026-08-01',
        'predicted_next_date', '2026-09-01', 'detection_version', 1,
        'transaction_ids', '[]'::jsonb)),
      'deduplications', '[]'::jsonb))$$,
  '22023', 'recurring_candidate_payload_invalid',
  'empty transaction_ids is rejected during candidate preflight'
);

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', jsonb_build_array(jsonb_build_object(
        'identity_key', 'non-array-transaction-ids', 'stream_id', 'non-array-transaction-ids',
        'stream_type', 'outflow', 'description', 'Non-array Transaction IDs',
        'merchant_name', 'Non-array Transaction IDs', 'expected_amount', 12.34,
        'last_amount', 12.34, 'frequency', 'MONTHLY', 'category', 'STREAMING',
        'account_id', '00000000-0000-0000-0000-000000002301',
        'first_date', '2026-06-01', 'last_date', '2026-08-01',
        'predicted_next_date', '2026-09-01', 'detection_version', 1,
        'transaction_ids', jsonb_build_object('unexpected', true))),
      'deduplications', '[]'::jsonb))$$,
  '22023', 'recurring_candidate_payload_invalid',
  'non-array transaction_ids is rejected during candidate preflight'
);

select is(
  (select count(*)::integer from public.recurring_streams where stream_id in ('missing-stream-type', 'empty-stream-type', 'missing-transaction-ids', 'empty-transaction-ids', 'non-array-transaction-ids')),
  0,
  'incomplete candidates do not persist streams'
);

select is(
  (select is_active from public.recurring_streams where id = '00000000-0000-0000-0000-000000004301'),
  true,
  'incomplete candidates do not reach the stale sweep'
);

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', jsonb_build_array(jsonb_build_object(
        'identity_key', 'rollback-candidate',
        'stream_id', 'rollback-candidate',
        'stream_type', 'outflow',
        'description', 'Rollback Candidate',
        'merchant_name', 'Rollback Candidate',
        'expected_amount', 12.34,
        'last_amount', 12.34,
        'frequency', 'MONTHLY',
        'category', 'STREAMING',
        'account_id', '00000000-0000-0000-0000-000000002301',
        'first_date', '2026-06-01',
        'last_date', '2026-08-01',
        'predicted_next_date', '2026-09-01',
        'detection_version', 1,
        'transaction_ids', jsonb_build_array('00000000-0000-0000-0000-000000003301'))),
      'deduplications', jsonb_build_array(jsonb_build_object(
        'plaid_id', '00000000-0000-0000-0000-000000004304',
        'inferred_id', '00000000-0000-0000-0000-000000004303'))))$$,
  '42501', 'recurring_inferred_stream_not_owned',
  'foreign inferred dedup targets are rejected before mutation'
);

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', '[]'::jsonb,
      'deduplications', jsonb_build_array(jsonb_build_object(
        'plaid_id', '00000000-0000-0000-0000-000000004304',
        'inferred_id', '00000000-0000-0000-0000-000000004399'))))$$,
  '42501', 'recurring_inferred_stream_not_owned',
  'absent inferred dedup targets are rejected before mutation'
);

select throws_ok(
  $$select public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', '[]'::jsonb,
      'deduplications', jsonb_build_array(jsonb_build_object(
        'plaid_id', '00000000-0000-0000-0000-000000004304',
        'inferred_id', '00000000-0000-0000-0000-000000004304'))))$$,
  '42501', 'recurring_inferred_stream_not_owned',
  'wrong-source inferred dedup targets are rejected before mutation'
);

select is(
  (select is_active from public.recurring_streams where id = '00000000-0000-0000-0000-000000004301'),
  true,
  'invalid inferred target rolls back without sweeping stale streams'
);

select is(
  (select count(*)::integer from public.recurring_streams where stream_id = 'rollback-candidate'),
  0,
  'invalid inferred target rolls back the candidate stream'
);

select is(
  (select count(*)::integer from public.recurring_stream_transactions rst
   join public.transactions t on t.id = rst.transaction_id
   where t.id = '00000000-0000-0000-0000-000000003301'),
  0,
  'invalid inferred target rolls back candidate joins'
);

select is(
  (public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', jsonb_build_array(jsonb_build_object(
        'identity_key', 'example-subscription|outflow|monthly',
        'stream_id', 'inferred-example-subscription',
        'stream_type', 'outflow',
        'description', 'Example Subscription',
        'merchant_name', 'Example Subscription',
        'expected_amount', 12.34,
        'last_amount', 12.34,
        'frequency', 'MONTHLY',
        'category', 'STREAMING',
        'account_id', '00000000-0000-0000-0000-000000002301',
        'first_date', '2026-06-01',
        'last_date', '2026-08-01',
        'predicted_next_date', '2026-09-01',
        'detection_version', 1,
        'transaction_ids', jsonb_build_array(
          '00000000-0000-0000-0000-000000003301',
          '00000000-0000-0000-0000-000000003302'))),
      'deduplications', '[]'::jsonb)))->>'added',
  '1',
  'a prepared candidate is inserted exactly once'
);

select is(
  (select average_amount from public.recurring_streams where identity_key = 'example-subscription|outflow|monthly'),
  12.34::numeric,
  'the expected amount is persisted as the stream forecast'
);

select is(
  (select count(*)::integer from public.recurring_stream_transactions rst
   join public.recurring_streams rs on rs.id = rst.recurring_stream_id
   where rs.identity_key = 'example-subscription|outflow|monthly'),
  2,
  'candidate joins are replaced with the prepared transaction set'
);

select is(
  (public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', jsonb_build_array(jsonb_build_object(
        'identity_key', 'example-subscription|outflow|monthly',
        'stream_id', 'inferred-example-subscription',
        'stream_type', 'outflow',
        'description', 'Example Subscription',
        'merchant_name', 'Example Subscription',
        'expected_amount', 12.34,
        'last_amount', 12.34,
        'frequency', 'MONTHLY',
        'category', 'STREAMING',
        'account_id', '00000000-0000-0000-0000-000000002301',
        'first_date', '2026-06-01',
        'last_date', '2026-08-01',
        'predicted_next_date', '2026-09-01',
        'detection_version', 1,
        'transaction_ids', jsonb_build_array(
          '00000000-0000-0000-0000-000000003301',
          '00000000-0000-0000-0000-000000003302'))),
      'deduplications', '[]'::jsonb)))->>'added',
  '0',
  'an identical candidate reloads the partial-index winner without adding it'
);

select is(
  (public.reconcile_inferred_recurring(
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_object(
      'candidates', jsonb_build_array(jsonb_build_object(
        'identity_key', 'example-subscription|outflow|monthly',
        'stream_id', 'inferred-example-subscription',
        'stream_type', 'outflow',
        'description', 'Example Subscription',
        'merchant_name', 'Example Subscription',
        'expected_amount', 12.34,
        'last_amount', 12.34,
        'frequency', 'MONTHLY',
        'category', 'STREAMING',
        'account_id', '00000000-0000-0000-0000-000000002301',
        'first_date', '2026-06-01',
        'last_date', '2026-08-01',
        'predicted_next_date', '2026-09-01',
        'detection_version', 1,
        'transaction_ids', jsonb_build_array(
          '00000000-0000-0000-0000-000000003302',
          '00000000-0000-0000-0000-000000003303'))),
      'deduplications', '[]'::jsonb)))->>'added',
  '0',
  'an existing identity winner is reused without inflating added'
);

select is(
  (select count(*)::integer from public.recurring_stream_transactions rst
   join public.recurring_streams rs on rs.id = rst.recurring_stream_id
   where rs.identity_key = 'example-subscription|outflow|monthly'
     and rst.transaction_id = '00000000-0000-0000-0000-000000003301'),
  0,
  'the previous join set is removed atomically'
);

select is(
  (select count(*)::integer from public.recurring_stream_transactions rst
   join public.recurring_streams rs on rs.id = rst.recurring_stream_id
   where rs.identity_key = 'example-subscription|outflow|monthly'
     and rst.transaction_id = '00000000-0000-0000-0000-000000003303'),
  1,
  'the replacement join set is complete'
);

insert into public.recurring_streams (
  id, user_id, plaid_item_id, stream_id, stream_type, source, identity_key,
  is_active, reviewed_at, dismissed_at, user_amount, account_id
)
values (
  '00000000-0000-0000-0000-000000004305', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000001301', 'inferred-plaid-example', 'outflow', 'inferred', 'inferred-plaid-example', true, '2026-01-01T00:00:00Z', null, 1.11, '00000000-0000-0000-0000-000000002301'
);

insert into public.recurring_streams (
  id, user_id, plaid_item_id, stream_id, stream_type, source, identity_key,
  is_active, account_id
)
values (
  '00000000-0000-0000-0000-000000004306', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000001301', 'stale-owner-after-candidate', 'outflow', 'inferred', 'stale-owner-after-candidate', true, '00000000-0000-0000-0000-000000002301'
);

select is((public.reconcile_inferred_recurring(
  '00000000-0000-0000-0000-000000000301'::uuid,
  '00000000-0000-0000-0000-000000001301'::uuid,
  jsonb_build_object(
    'candidates', '[]'::jsonb,
    'deduplications', jsonb_build_array(jsonb_build_object(
      'plaid_id', '00000000-0000-0000-0000-000000004304',
      'inferred_id', '00000000-0000-0000-0000-000000004305')))))->>'deduplicated',
  '1',
  'deduplication reports one processed pair');

select is((select reviewed_at from public.recurring_streams where id = '00000000-0000-0000-0000-000000004304'), '2026-08-20T12:00:00Z'::timestamptz, 'non-null Plaid reviewed_at wins');
select is((select dismissed_at from public.recurring_streams where id = '00000000-0000-0000-0000-000000004304'), '2026-08-21T12:00:00Z'::timestamptz, 'non-null Plaid dismissed_at wins');
select is((select user_amount from public.recurring_streams where id = '00000000-0000-0000-0000-000000004304'), 99.99::numeric, 'non-null Plaid user_amount wins');
select is((select is_active from public.recurring_streams where id = '00000000-0000-0000-0000-000000004305'), false, 'deduplicated inferred stream is deactivated');

select is((select is_active from public.recurring_streams where id = '00000000-0000-0000-0000-000000004306'), false, 'stale inferred streams are swept only in the requested item');
select is((select is_active from public.recurring_streams where id = '00000000-0000-0000-0000-000000004302'), true, 'a different item is not swept');
select is((select is_active from public.recurring_streams where id = '00000000-0000-0000-0000-000000004303'), true, 'a different user is not swept');

select * from finish();

rollback;
