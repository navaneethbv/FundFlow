create table public.payday_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 cadence text not null check(cadence in ('weekly','biweekly','semimonthly','monthly')),
 anchor_date date not null,
 amount numeric(14,2) not null check(amount>0 and amount<=10000000 and amount<>'NaN'::numeric),
 day1 integer not null check(day1 between 1 and 31),
 day2 integer check(day2 between 1 and 31),
 confirmed_at timestamptz not null default now(),
 check((cadence='semimonthly' and day2 is not null and day2<>day1) or (cadence<>'semimonthly' and day2 is null))
);
alter table public.payday_settings enable row level security;
revoke all on public.payday_settings from anon;
grant select,insert,update,delete on public.payday_settings to authenticated;
grant all on public.payday_settings to service_role;
create policy payday_settings_own on public.payday_settings for all to authenticated
 using(user_id=(select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()))
 with check(user_id=(select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()));
