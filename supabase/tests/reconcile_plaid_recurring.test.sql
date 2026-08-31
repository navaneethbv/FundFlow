begin;

select plan(14);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000401', 'plaid-snapshot-owner@example.test'),
  ('00000000-0000-0000-0000-000000000402', 'plaid-snapshot-other@example.test')
on conflict (id) do nothing;

insert into public.plaid_items (
  id, user_id, plaid_item_id, access_token_ciphertext,
  access_token_iv, access_token_tag, institution_name
)
values
  ('00000000-0000-0000-0000-000000001401', '00000000-0000-0000-0000-000000000401', 'snapshot-item-401', 'cipher', 'iv', 'tag', 'Snapshot Bank'),
  ('00000000-0000-0000-0000-000000001402', '00000000-0000-0000-0000-000000000402', 'snapshot-item-402', 'cipher', 'iv', 'tag', 'Other Bank');

insert into public.accounts (
  id, user_id, plaid_item_id, plaid_account_id, name, iso_currency_code
)
values
  ('00000000-0000-0000-0000-000000002401', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000001401', 'snapshot-account-401', 'Checking', 'USD'),
  ('00000000-0000-0000-0000-000000002402', '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000001402', 'snapshot-account-402', 'Other Checking', 'USD');

insert into public.transactions (
  id, user_id, account_id, plaid_transaction_id, amount, iso_currency_code,
  date, name, merchant_name, pfc_primary, pfc_detailed, payment_channel
)
values
  ('00000000-0000-0000-0000-000000003401', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000002401', 'snapshot-transaction-401', 15.00, 'USD', '2026-08-01', 'Snapshot Service', 'Snapshot Service', 'ENTERTAINMENT', 'STREAMING', 'online'),
  ('00000000-0000-0000-0000-000000003402', '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000002402', 'snapshot-transaction-402', 15.00, 'USD', '2026-08-01', 'Foreign Service', 'Foreign Service', 'ENTERTAINMENT', 'STREAMING', 'online');

insert into public.recurring_streams (
  id, user_id, plaid_item_id, stream_id, stream_type, source,
  is_active, average_amount, account_id
)
values
  ('00000000-0000-0000-0000-000000004401', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000001401', 'stale-plaid-401', 'outflow', 'plaid', true, 15.00, '00000000-0000-0000-0000-000000002401'),
  ('00000000-0000-0000-0000-000000004402', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000001401', 'keep-inferred-401', 'outflow', 'inferred', true, 15.00, '00000000-0000-0000-0000-000000002401'),
  ('00000000-0000-0000-0000-000000004403', '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000001402', 'foreign-plaid-402', 'outflow', 'plaid', true, 15.00, '00000000-0000-0000-0000-000000002402');

insert into public.recurring_stream_transactions (user_id, recurring_stream_id, transaction_id)
values
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000004401', '00000000-0000-0000-0000-000000003401'),
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000004402', '00000000-0000-0000-0000-000000003401');

set local role service_role;

select is(
  (public.reconcile_plaid_recurring(
    '00000000-0000-0000-0000-000000000401'::uuid,
    '00000000-0000-0000-0000-000000001401'::uuid,
    jsonb_build_object('streams', '[]'::jsonb, 'joins', '[]'::jsonb)))->>'plaid',
  '0',
  'an empty Plaid snapshot is accepted'
);

select is((select is_active from public.recurring_streams where id = '00000000-0000-0000-0000-000000004401'), false, 'empty snapshot sweeps stale Plaid rows');
select is((select is_active from public.recurring_streams where id = '00000000-0000-0000-0000-000000004402'), true, 'empty snapshot preserves inferred rows');
select is((select is_active from public.recurring_streams where id = '00000000-0000-0000-0000-000000004403'), true, 'empty snapshot is scoped to one owner and item');
select is((select count(*)::integer from public.recurring_stream_transactions where recurring_stream_id = '00000000-0000-0000-0000-000000004402'), 1, 'empty snapshot preserves inferred joins');

select is(
  (public.reconcile_plaid_recurring(
    '00000000-0000-0000-0000-000000000401'::uuid,
    '00000000-0000-0000-0000-000000001401'::uuid,
    jsonb_build_object(
      'streams', jsonb_build_array(jsonb_build_object(
        'stream_id', 'fresh-plaid-401', 'source', 'plaid', 'stream_type', 'outflow',
        'description', 'Fresh Service', 'merchant_name', 'Fresh Service',
        'average_amount', 15, 'last_amount', 15, 'frequency', 'MONTHLY',
        'status', 'MATURE', 'is_active', true,
        'account_id', '00000000-0000-0000-0000-000000002401')),
      'joins', jsonb_build_array(jsonb_build_object(
        'stream_id', 'fresh-plaid-401',
        'transaction_ids', jsonb_build_array('00000000-0000-0000-0000-000000003401'))))))->>'plaid',
  '1',
  'a valid provider stream is persisted'
);

select is((select count(*)::integer from public.recurring_stream_transactions rst join public.recurring_streams rs on rs.id = rst.recurring_stream_id where rs.stream_id = 'fresh-plaid-401'), 1, 'provider joins are replaced with exact local ids');

select throws_ok(
  $$select public.reconcile_plaid_recurring(
    '00000000-0000-0000-0000-000000000401'::uuid,
    '00000000-0000-0000-0000-000000001401'::uuid,
    jsonb_build_object('streams', jsonb_build_array(jsonb_build_object(
      'stream_id', 'foreign-account-stream', 'source', 'plaid', 'stream_type', 'outflow',
      'account_id', '00000000-0000-0000-0000-000000002402')),
      'joins', '[]'::jsonb))$$,
  '42501', 'recurring_plaid_account_not_owned',
  'foreign accounts are rejected before provider mutation'
);

select is((select count(*)::integer from public.recurring_streams where stream_id = 'foreign-account-stream'), 0, 'ownership rejection leaves no provider row');

select throws_ok(
  $$select public.reconcile_plaid_recurring(
    '00000000-0000-0000-0000-000000000401'::uuid,
    '00000000-0000-0000-0000-000000001401'::uuid,
    jsonb_build_object(
      'streams', jsonb_build_array(jsonb_build_object(
        'stream_id', 'rollback-stream', 'source', 'plaid', 'stream_type', 'outflow',
        'account_id', '00000000-0000-0000-0000-000000002401')),
      'joins', jsonb_build_array(jsonb_build_object(
        'stream_id', 'rollback-stream',
        'transaction_ids', jsonb_build_array('00000000-0000-0000-0000-000000003499')))))$$,
  '42501', 'recurring_plaid_transaction_not_owned',
  'an invalid later join rolls back the complete snapshot'
);

select is((select count(*)::integer from public.recurring_streams where stream_id = 'rollback-stream'), 0, 'invalid joins do not leave earlier provider writes');

select is((select proconfig @> array['search_path='] from pg_proc where oid = 'public.reconcile_plaid_recurring(uuid,uuid,jsonb)'::regprocedure), true, 'provider RPC fixes its search path');
select is(has_function_privilege('service_role', 'public.reconcile_plaid_recurring(uuid,uuid,jsonb)', 'execute'), true, 'provider RPC is granted to service role');
select is(has_function_privilege('authenticated', 'public.reconcile_plaid_recurring(uuid,uuid,jsonb)', 'execute'), false, 'provider RPC is not granted to authenticated');

select * from finish();
rollback;
