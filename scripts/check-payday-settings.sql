-- Synthetic fixtures on disposable databases only.
begin;
insert into auth.users(id,email) values
 ('87000000-0000-0000-0000-000000000001','payday-owner@example.invalid'),
 ('87000000-0000-0000-0000-000000000002','payday-other@example.invalid');
select set_config('request.jwt.claims','{"sub":"87000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
insert into public.payday_settings(user_id,cadence,anchor_date,amount,day1) values('87000000-0000-0000-0000-000000000001','monthly','2026-10-31',1000,31);
do $$ begin
 assert (select count(*)=1 from public.payday_settings), 'Own configuration unreadable';
 begin
  insert into public.payday_settings(user_id,cadence,anchor_date,amount,day1) values('87000000-0000-0000-0000-000000000002','weekly','2026-10-31',1000,31);
  raise exception 'Foreign configuration insert allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.payday_settings set cadence='semimonthly',day2=31;
  raise exception 'Duplicate semimonthly days accepted';
 exception when check_violation then null; end;
 begin
  update public.payday_settings set amount=-1;
  raise exception 'Negative payday accepted';
 exception when check_violation then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"87000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare n integer; begin
 assert not exists(select 1 from public.payday_settings), 'Foreign configuration readable';
 update public.payday_settings set amount=9999;
 get diagnostics n=row_count; assert n=0, 'Foreign configuration writable';
 delete from public.payday_settings;
 get diagnostics n=row_count; assert n=0, 'Foreign configuration deletable';
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"87000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
update public.payday_settings set cadence='semimonthly',day2=15;
do $$ begin assert (select amount=1000 and day2=15 from public.payday_settings), 'Owner update failed'; end $$;
delete from public.payday_settings;
reset role;
rollback;
