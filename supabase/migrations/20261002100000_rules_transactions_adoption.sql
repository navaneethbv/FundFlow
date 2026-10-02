-- Group 6 reference adoption: user-authored category mappings, Bayes provenance,
-- and merchant aliases. Provider transaction rows remain immutable.

create table if not exists public.plaid_category_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pfc_detailed text not null check (char_length(pfc_detailed) between 1 and 120),
  display_category text not null check (char_length(display_category) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, pfc_detailed)
);

create index if not exists plaid_category_mappings_user_idx
  on public.plaid_category_mappings (user_id, pfc_detailed);

alter table public.plaid_category_mappings enable row level security;
revoke all on table public.plaid_category_mappings from anon;
grant select, insert, update, delete on table public.plaid_category_mappings to authenticated;

create policy "plaid_category_mappings_select_own"
  on public.plaid_category_mappings for select to authenticated
  using (user_id = (select auth.uid()) and private.session_not_revoked() and private.mfa_satisfied());
create policy "plaid_category_mappings_insert_own"
  on public.plaid_category_mappings for insert to authenticated
  with check (user_id = (select auth.uid()) and private.session_not_revoked() and private.mfa_satisfied());
create policy "plaid_category_mappings_update_own"
  on public.plaid_category_mappings for update to authenticated
  using (user_id = (select auth.uid()) and private.session_not_revoked() and private.mfa_satisfied())
  with check (user_id = (select auth.uid()) and private.session_not_revoked() and private.mfa_satisfied());
create policy "plaid_category_mappings_delete_own"
  on public.plaid_category_mappings for delete to authenticated
  using (user_id = (select auth.uid()) and private.session_not_revoked() and private.mfa_satisfied());

create trigger plaid_category_mappings_set_updated_at
  before update on public.plaid_category_mappings
  for each row execute function public.set_updated_at();

create or replace function public.replace_plaid_category_mappings(
  p_user_id uuid,
  p_mappings jsonb
) returns void
language plpgsql
set search_path = public, private
as $$
begin
  if p_user_id is null or p_user_id <> (select auth.uid()) then
    raise exception 'mapping owner mismatch' using errcode = '42501';
  end if;

  delete from public.plaid_category_mappings
    where user_id = p_user_id;

  insert into public.plaid_category_mappings (user_id, pfc_detailed, display_category)
  select p_user_id, mapping.pfc_detailed, mapping.display_category
  from jsonb_to_recordset(coalesce(p_mappings, '[]'::jsonb)) as mapping(
    pfc_detailed text,
    display_category text
  );
end;
$$;

revoke all on function public.replace_plaid_category_mappings(uuid, jsonb) from public, anon;
grant execute on function public.replace_plaid_category_mappings(uuid, jsonb) to authenticated;

alter table public.transaction_annotations
  add column if not exists classification_source text
  check (classification_source in ('user', 'rule', 'plaid_mapping', 'bayes'));

create table if not exists public.merchant_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_merchant text not null check (char_length(source_merchant) between 1 and 120),
  target_merchant text not null check (char_length(target_merchant) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (user_id, source_merchant)
);

create index if not exists merchant_aliases_user_idx
  on public.merchant_aliases (user_id, source_merchant);

alter table public.merchant_aliases enable row level security;
revoke all on table public.merchant_aliases from anon;
grant select on table public.merchant_aliases to authenticated;

create policy "merchant_aliases_select_own"
  on public.merchant_aliases for select to authenticated
  using (user_id = (select auth.uid()) and private.session_not_revoked() and private.mfa_satisfied());

create or replace function public.merge_merchants(
  p_user_id uuid,
  p_source_merchant text,
  p_target_merchant text
) returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  source_name text := btrim(p_source_merchant);
  target_name text := btrim(p_target_merchant);
begin
  if p_user_id is null or source_name = '' or target_name = ''
     or length(source_name) > 120 or length(target_name) > 120
     or lower(source_name) = lower(target_name) then
    raise exception 'invalid merchant merge' using errcode = '22023';
  end if;

  insert into public.merchant_aliases (user_id, source_merchant, target_merchant)
  values (p_user_id, source_name, target_name)
  on conflict (user_id, source_merchant) do update
    set target_merchant = excluded.target_merchant;

  update public.merchant_rules
    set pattern = target_name, display_name = target_name, updated_at = now()
    where user_id = p_user_id and lower(pattern) = lower(source_name);

  update public.transaction_annotations annotation
    set tags = array_replace(annotation.tags, source_name, target_name), updated_at = now()
    where annotation.user_id = p_user_id and source_name = any(annotation.tags);
end;
$$;

revoke all on function public.merge_merchants(uuid, text, text) from public, anon, authenticated;
grant execute on function public.merge_merchants(uuid, text, text) to service_role;
