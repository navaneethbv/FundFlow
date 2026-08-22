-- Preserve the source account and row position for staged migration imports.
-- A row hash is a duplicate signal, not a global uniqueness key: the same
-- statement may be previewed again, and a file may contain identical rows.
alter table public.import_review_rows
  add column if not exists source_account text,
  add column if not exists row_index integer;

with ranked as (
  select
    id,
    row_number() over (partition by batch_id order by created_at, id) - 1 as position
  from public.import_review_rows
)
update public.import_review_rows rows
set row_index = ranked.position
from ranked
where rows.id = ranked.id
  and rows.row_index is null;

alter table public.import_review_rows
  alter column row_index set not null;

alter table public.import_review_rows
  drop constraint if exists import_review_rows_user_id_row_hash_key;

create unique index if not exists import_review_rows_batch_position_idx
  on public.import_review_rows (batch_id, row_index);

create table if not exists public.import_source_account_mappings (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  source_account      text not null check (char_length(source_account) between 1 and 240),
  account_id          uuid references public.accounts (id) on delete cascade,
  manual_account_id   uuid references public.manual_accounts (id) on delete cascade,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, source_account),
  check ((account_id is null) <> (manual_account_id is null))
);

create index if not exists import_source_account_mappings_user_idx
  on public.import_source_account_mappings (user_id);

create trigger import_source_account_mappings_set_updated_at
  before update on public.import_source_account_mappings
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.import_source_account_mappings to authenticated;

alter table public.import_source_account_mappings enable row level security;

create policy "import_source_account_mappings_select_own"
  on public.import_source_account_mappings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "import_source_account_mappings_insert_own"
  on public.import_source_account_mappings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "import_source_account_mappings_update_own"
  on public.import_source_account_mappings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "import_source_account_mappings_delete_own"
  on public.import_source_account_mappings
  for delete to authenticated using (user_id = (select auth.uid()));
