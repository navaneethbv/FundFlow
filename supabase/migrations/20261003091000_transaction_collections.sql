-- Reference adoption 6.8: optional budgets for tag-based collections. This is
-- user-authored configuration, so owners write it directly under RLS.
create table public.transaction_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  budget numeric(14, 2) not null check (budget >= 0 and budget < 1000000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Names are stored trimmed; tags match them case-insensitively when read.
  unique (user_id, name),
  check (name = btrim(name))
);

create trigger transaction_collections_set_updated_at
  before update on public.transaction_collections
  for each row execute function public.set_updated_at();

alter table public.transaction_collections enable row level security;
revoke all on public.transaction_collections from anon;
grant select, insert, update, delete on public.transaction_collections to authenticated;
grant all on public.transaction_collections to service_role;

create policy transaction_collections_select_own on public.transaction_collections
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()));
create policy transaction_collections_insert_own on public.transaction_collections
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()));
create policy transaction_collections_update_own on public.transaction_collections
  for update to authenticated
  using (user_id = (select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()))
  with check (user_id = (select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()));
create policy transaction_collections_delete_own on public.transaction_collections
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()));
