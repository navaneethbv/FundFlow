-- Phase 13: profile fields, display preferences, and a real tag registry.
--
-- `user_tags` is the first source of truth for tag *names*; the strings
-- stored on `transaction_annotations.tags` remain the actual per-transaction
-- data (unchanged, for compatibility with every existing reader), but a
-- rename or merge here rewrites those arrays through `rename_user_tag` so
-- the two never drift apart. Deleting a tag from the registry does not
-- retroactively strip it from transactions — only a rename (to an empty
-- target is rejected) or an explicit merge does that.

alter table public.profiles
  add column if not exists full_name text
    check (full_name is null or char_length(full_name) between 1 and 120),
  add column if not exists display_name text
    check (display_name is null or char_length(display_name) between 1 and 80),
  add column if not exists birthday date,
  add column if not exists avatar_path text,
  add column if not exists display_prefs jsonb not null default '{}'::jsonb;

create table if not exists public.user_tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  color_slot  int not null default 0 check (color_slot between 0 and 5),
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists user_tags_user_idx on public.user_tags (user_id, name);

alter table public.user_tags enable row level security;

revoke all on table public.user_tags from anon;
grant select, insert, update, delete on table public.user_tags to authenticated;

create policy "user_tags_all_own" on public.user_tags
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Private avatar storage, user-prefixed paths — same pattern as the Phase 12
-- receipts bucket. Avatars render through short-lived signed URLs; the
-- existing `img-src 'self' data: https:` CSP directive already permits them.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create policy "avatar_objects_all_own" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- Tag rename/merge across every annotation that carries it
--
-- A plain client-side loop over transaction_annotations would need to fetch,
-- edit, and rewrite every matching row's array non-atomically; this function
-- does it in one statement and is the only way tag text changes, so a rename
-- and a concurrent annotation edit can never interleave into a lost update.
-- SECURITY DEFINER to write rows the caller does not own the table grant for
-- directly, so it re-checks ownership itself via auth.uid() rather than
-- trusting a passed-in user id.
-- ---------------------------------------------------------------------------

create or replace function public.rename_user_tag(
  p_old_name text,
  p_new_name text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_old_name is null or p_new_name is null or char_length(trim(p_new_name)) = 0 then
    raise exception 'invalid_tag_name' using errcode = '22023';
  end if;

  -- Rewrite every annotation's tag array; array_remove(array_append(...))
  -- de-duplicates in the rare case the target name already exists on a row
  -- (renaming into an existing tag is how a merge is expressed).
  update public.transaction_annotations
     set tags = (
       select array_agg(distinct tag)
       from unnest(array_replace(tags, p_old_name, p_new_name)) as tag
     )
   where user_id = v_user_id
     and p_old_name = any(tags);

  update public.user_tags
     set name = p_new_name
   where user_id = v_user_id
     and name = p_old_name
     -- If p_new_name already exists as its own registry row, drop the old
     -- one instead of violating the unique (user_id, name) constraint.
     and not exists (
       select 1 from public.user_tags where user_id = v_user_id and name = p_new_name
     );

  delete from public.user_tags
   where user_id = v_user_id
     and name = p_old_name;
end;
$$;

revoke all on function public.rename_user_tag(text, text) from public;
revoke all on function public.rename_user_tag(text, text) from anon;
grant execute on function public.rename_user_tag(text, text) to authenticated;

-- Verification (expect 0 rows):
--   select count(*) from public.user_tags ut
--     join public.profiles p on p.id = ut.user_id
--    where false; -- placeholder: user_tags has no cross-user FK to violate
--
-- Rollback:
--   drop function if exists public.rename_user_tag(text, text);
--   delete from storage.buckets where id = 'avatars';
--   drop table if exists public.user_tags;
--   alter table public.profiles
--     drop column if exists full_name,
--     drop column if exists display_name,
--     drop column if exists birthday,
--     drop column if exists avatar_path,
--     drop column if exists display_prefs;
