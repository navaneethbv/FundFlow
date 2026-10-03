-- Disposable local Supabase only. Migration CI rolls back every fixture.
begin;
insert into auth.users (id, email, encrypted_password) values
  ('19000000-0000-0000-0000-000000000001', 'review-owner@example.com', 'initial-test-hash'),
  ('19000000-0000-0000-0000-000000000002', 'review-other@example.com', 'other-test-hash');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('29000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', now(), now()),
  ('29000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000001', now(), now());
insert into public.api_tokens (user_id, name, token_hash) values
  ('19000000-0000-0000-0000-000000000001', 'owner', 'review-owner-token'),
  ('19000000-0000-0000-0000-000000000002', 'other', 'review-other-token');
insert into public.calendar_tokens (user_id, token_hash) values
  ('19000000-0000-0000-0000-000000000001', 'review-calendar-token'),
  ('19000000-0000-0000-0000-000000000002', 'review-other-calendar-token');

do $$ begin
  assert not has_table_privilege('authenticated', 'public.api_tokens', 'INSERT'), 'Mint bypasses step-up';
  assert not has_column_privilege('authenticated', 'public.api_tokens', 'expires_at', 'UPDATE'), 'Client can extend expiry';
  assert has_column_privilege('authenticated', 'public.api_tokens', 'revoked_at', 'UPDATE'), 'Client cannot revoke';
  assert to_regprocedure('public.is_household_member_for(uuid,uuid)') is null, 'Membership RPC remains public';
  assert to_regprocedure('private.is_household_member_for(uuid,uuid)') is not null, 'Policy helper missing';
  assert (select expires_at = now() + interval '90 days' from public.api_tokens where token_hash = 'review-owner-token'), 'Wrong expiry default';
end $$;

-- Logging out one device preserves both integrations while another session exists.
delete from auth.sessions where id = '29000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select revoked_at is null from public.api_tokens where token_hash = 'review-owner-token'), 'Single-device logout revoked API token';
  assert (select revoked_at is null from public.calendar_tokens where token_hash = 'review-calendar-token'), 'Single-device logout revoked calendar token';
end $$;

-- Ordinary Logout defaults to global scope; final-session cleanup must also be harmless.
-- There is only one session left, covering logout on a user's sole device.
delete from auth.sessions where user_id = '19000000-0000-0000-0000-000000000001';
do $$ begin
  assert not exists (select 1 from auth.sessions where user_id = '19000000-0000-0000-0000-000000000001'), 'Logout left a session';
  assert (select revoked_at is null from public.api_tokens where token_hash = 'review-owner-token'), 'Final-session logout revoked API token';
  assert (select revoked_at is null from public.calendar_tokens where token_hash = 'review-calendar-token'), 'Final-session logout revoked calendar token';
end $$;

-- Deleting multiple sessions in one statement also preserves both integrations.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('29000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', now(), now()),
  ('29000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000001', now(), now());
delete from auth.sessions where user_id = '19000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select revoked_at is null from public.api_tokens where token_hash = 'review-owner-token'), 'All-session logout revoked API token';
  assert (select revoked_at is null from public.calendar_tokens where token_hash = 'review-calendar-token'), 'All-session logout revoked calendar token';
end $$;

-- Credential changes revoke both kinds of capability without touching other users.
update auth.users set encrypted_password = 'changed-test-hash' where id = '19000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select revoked_at is not null from public.api_tokens where token_hash = 'review-owner-token'), 'Password change retained API token';
  assert (select revoked_at is not null from public.calendar_tokens where token_hash = 'review-calendar-token'), 'Password change retained calendar token';
  assert (select revoked_at is null from public.api_tokens where token_hash = 'review-other-token'), 'Revoked another user API token';
  assert (select revoked_at is null from public.calendar_tokens where token_hash = 'review-other-calendar-token'), 'Revoked another user calendar token';
  begin
    update public.api_tokens set revoked_at = null where token_hash = 'review-owner-token';
    raise exception 'Revoked token was reactivated';
  exception when raise_exception then
    if SQLERRM <> 'Revoked tokens cannot be reactivated' then raise; end if;
  end;
end $$;

insert into public.api_tokens (user_id, name, token_hash) values
 ('19000000-0000-0000-0000-000000000001', 'mfa-reset', 'review-mfa-token');
insert into public.calendar_tokens (user_id, token_hash) values
 ('19000000-0000-0000-0000-000000000001', 'review-mfa-calendar-token');
insert into auth.mfa_factors (id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret) values
 ('39000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','Fixture','totp','verified',now(),now(),'fixture');
delete from auth.mfa_factors where id = '39000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select revoked_at is not null from public.api_tokens where token_hash = 'review-mfa-token'), 'MFA reset retained API token';
  assert (select revoked_at is not null from public.calendar_tokens where token_hash = 'review-mfa-calendar-token'), 'MFA reset retained calendar token';
  assert (select revoked_at is null from public.api_tokens where token_hash = 'review-other-token'), 'MFA reset revoked another user API token';
  assert (select revoked_at is null from public.calendar_tokens where token_hash = 'review-other-calendar-token'), 'MFA reset revoked another user calendar token';
end $$;

-- PostgREST can infer the full unique index and retries do not replace content.
insert into public.notifications (user_id,type,severity,title,body,subject_key) values
 ('19000000-0000-0000-0000-000000000001','large_transaction','warning','Original','Body','pending-purchase')
on conflict (user_id,type,subject_key) do nothing;
insert into public.notifications (user_id,type,severity,title,body,subject_key) values
 ('19000000-0000-0000-0000-000000000001','large_transaction','warning','Duplicate','Body','pending-purchase')
on conflict (user_id,type,subject_key) do nothing;
do $$ begin
  assert (select count(*) = 1 from public.notifications where user_id = '19000000-0000-0000-0000-000000000001' and subject_key = 'pending-purchase'), 'Duplicate purchase alert';
end $$;

-- A private loan payment can never repay more than is owed: a settled loan
-- refuses further payments, and a back-dated payment cannot skip later ones.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare v_loan uuid;
begin
  v_loan := public.create_private_loan('19000000-0000-0000-0000-000000000001','lent','Fixture',100,0,'2026-01-01',null,null);
  perform public.record_private_loan_payment('19000000-0000-0000-0000-000000000001',v_loan,'2026-01-10',60,null);
  begin
    perform public.record_private_loan_payment('19000000-0000-0000-0000-000000000001',v_loan,'2026-01-05',60,null);
    raise exception 'Back-dated payment was accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.record_private_loan_payment('19000000-0000-0000-0000-000000000001',v_loan,'2026-01-20',40,null);
  assert (select status = 'settled' from public.private_loans where id = v_loan), 'Fully repaid loan not settled';
  begin
    perform public.record_private_loan_payment('19000000-0000-0000-0000-000000000001',v_loan,'2026-01-25',1,null);
    raise exception 'Settled loan accepted a payment';
  exception when invalid_parameter_value then null;
  end;
  assert (select sum(amount) = 100 from public.private_loan_payments where loan_id = v_loan), 'Loan repaid more than principal';
end $$;
rollback;
