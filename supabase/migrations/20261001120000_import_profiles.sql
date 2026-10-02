-- Saved bank layouts are owner-authored configuration, saved only after a
-- durable import. Writes use the service-only RPC; no client write grants.
create table public.import_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  layout jsonb not null check (jsonb_typeof(layout)='object'),
  created_at timestamptz not null default now(),
  unique(user_id, name)
);
alter table public.import_profiles enable row level security;
revoke all on public.import_profiles from anon, authenticated;
grant select on public.import_profiles to authenticated;
grant select, insert, update, delete on public.import_profiles to service_role;
create policy import_profiles_select_own on public.import_profiles
  for select to authenticated using (
    user_id=(select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );
alter table public.import_review_batches add column layout_profile jsonb;

create function public.save_committed_import_profile(p_user_id uuid, p_batch_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_layout jsonb; v_id uuid;
begin
  -- Serialize profile creation per owner, including the quota check.
  perform id from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Profile owner not found'; end if;
  select layout_profile into v_layout from public.import_review_batches
    where id=p_batch_id and user_id=p_user_id and status='committed' for update;
  if v_layout is null or not exists (
    select 1 from public.import_review_rows where user_id=p_user_id and batch_id=p_batch_id and status='committed'
  ) then raise exception 'A successfully committed layout is required'; end if;
  if (select count(*) from public.import_profiles where user_id=p_user_id)>=100 then
    raise exception 'Saved layout limit reached';
  end if;
  insert into public.import_profiles(user_id,name,layout)
    values(p_user_id,btrim(p_name),v_layout)
    on conflict(user_id,name) do nothing returning id into v_id;
  if v_id is null then raise exception 'A layout with that name already exists'; end if;
  return v_id;
end $$;
revoke all on function public.save_committed_import_profile(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.save_committed_import_profile(uuid,uuid,text) to service_role;
