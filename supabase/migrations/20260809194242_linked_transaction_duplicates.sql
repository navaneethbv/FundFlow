create table public.linked_duplicates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id text not null,
  kept_transaction_id uuid not null references public.transactions (id) on delete cascade,
  excluded_transaction_id uuid not null references public.transactions (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kept_transaction_id <> excluded_transaction_id),
  unique (user_id, subject_id),
  unique (user_id, kept_transaction_id),
  unique (user_id, excluded_transaction_id)
);

create index linked_duplicates_user_idx
  on public.linked_duplicates (user_id, created_at desc);

create trigger linked_duplicates_set_updated_at
  before update on public.linked_duplicates
  for each row execute function public.set_updated_at();

alter table public.linked_duplicates enable row level security;
revoke all on public.linked_duplicates from anon;
revoke insert, update, delete on public.linked_duplicates from authenticated;
grant select on public.linked_duplicates to authenticated;

create policy "linked_duplicates_select_own" on public.linked_duplicates
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.confirm_transaction_duplicate(
  p_user_id uuid,
  p_subject_id text,
  p_kept_transaction_id uuid,
  p_excluded_transaction_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kept_transaction_id = p_excluded_transaction_id then
    raise exception 'duplicate_ids_equal' using errcode = '22023';
  end if;
  if p_subject_id <> least(p_kept_transaction_id::text, p_excluded_transaction_id::text)
    || ':' || greatest(p_kept_transaction_id::text, p_excluded_transaction_id::text) then
    raise exception 'duplicate_subject_mismatch' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.transactions
    where user_id = p_user_id
      and id in (p_kept_transaction_id, p_excluded_transaction_id)
  ) <> 2 then
    raise exception 'duplicate_transactions_not_owned' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.linked_duplicates
    where user_id = p_user_id
      and (
        kept_transaction_id in (p_kept_transaction_id, p_excluded_transaction_id)
        or excluded_transaction_id in (p_kept_transaction_id, p_excluded_transaction_id)
      )
  ) then
    raise exception 'duplicate_link_conflict' using errcode = '23505';
  end if;

  insert into public.linked_duplicates (
    user_id,
    subject_id,
    kept_transaction_id,
    excluded_transaction_id
  ) values (
    p_user_id,
    p_subject_id,
    p_kept_transaction_id,
    p_excluded_transaction_id
  );

  insert into public.transaction_review_decisions (
    user_id,
    kind,
    subject_id,
    decision
  ) values (
    p_user_id,
    'duplicate',
    p_subject_id,
    'confirmed'
  )
  on conflict (user_id, kind, subject_id)
  do update set decision = 'confirmed', updated_at = now();
end;
$$;

create or replace function private.undo_transaction_duplicate(
  p_user_id uuid,
  p_subject_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.linked_duplicates
  where user_id = p_user_id
    and subject_id = p_subject_id;
  get diagnostics deleted_count = row_count;
  if deleted_count = 0 then
    raise exception 'duplicate_link_not_found' using errcode = 'P0002';
  end if;
  delete from public.transaction_review_decisions
  where user_id = p_user_id
    and kind = 'duplicate'
    and subject_id = p_subject_id;
end;
$$;

revoke all on function private.confirm_transaction_duplicate(uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.undo_transaction_duplicate(uuid, text)
  from public, anon, authenticated;
grant execute on function private.confirm_transaction_duplicate(uuid, text, uuid, uuid) to service_role;
grant execute on function private.undo_transaction_duplicate(uuid, text) to service_role;

create or replace function public.confirm_transaction_duplicate(
  p_user_id uuid,
  p_subject_id text,
  p_kept_transaction_id uuid,
  p_excluded_transaction_id uuid
) returns void
language sql
security definer
set search_path = ''
as $$
  select private.confirm_transaction_duplicate(
    p_user_id,
    p_subject_id,
    p_kept_transaction_id,
    p_excluded_transaction_id
  );
$$;

create or replace function public.undo_transaction_duplicate(
  p_user_id uuid,
  p_subject_id text
) returns void
language sql
security definer
set search_path = ''
as $$
  select private.undo_transaction_duplicate(p_user_id, p_subject_id);
$$;

revoke all on function public.confirm_transaction_duplicate(uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.undo_transaction_duplicate(uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirm_transaction_duplicate(uuid, text, uuid, uuid) to service_role;
grant execute on function public.undo_transaction_duplicate(uuid, text) to service_role;
