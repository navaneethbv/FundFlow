-- Owner-scoped completion state for the five-step weekly review ritual.
create table public.weekly_review_streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_completed_week date,
  current_streak integer not null default 0 check (current_streak >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger weekly_review_streaks_set_updated_at
  before update on public.weekly_review_streaks
  for each row execute function public.set_updated_at();

alter table public.weekly_review_streaks enable row level security;
revoke all on public.weekly_review_streaks from anon;
grant select on public.weekly_review_streaks to authenticated;
create policy weekly_review_streaks_select_own on public.weekly_review_streaks
  for select to authenticated using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

create or replace function public.complete_weekly_review(
  p_user_id uuid,
  p_week_start date
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_previous public.weekly_review_streaks%rowtype;
  v_streak integer;
begin
  if auth.role() <> 'service_role' or p_user_id is null or p_week_start is null
    or extract(isodow from p_week_start) <> 1 then
    raise exception 'Invalid weekly review completion' using errcode = '22023';
  end if;
  select * into v_previous from public.weekly_review_streaks
    where user_id = p_user_id for update;
  if found and v_previous.last_completed_week = p_week_start then
    return jsonb_build_object('weekStart', p_week_start, 'streak', v_previous.current_streak, 'alreadyComplete', true);
  end if;
  v_streak := case
    when found and v_previous.last_completed_week = p_week_start - 7 then v_previous.current_streak + 1
    else 1
  end;
  insert into public.weekly_review_streaks(user_id,last_completed_week,current_streak)
    values(p_user_id,p_week_start,v_streak)
    on conflict(user_id) do update set
      last_completed_week = excluded.last_completed_week,
      current_streak = excluded.current_streak,
      updated_at = now();
  return jsonb_build_object('weekStart', p_week_start, 'streak', v_streak, 'alreadyComplete', false);
end $$;

revoke all on function public.complete_weekly_review(uuid, date) from public, anon, authenticated;
grant execute on function public.complete_weekly_review(uuid, date) to service_role;
