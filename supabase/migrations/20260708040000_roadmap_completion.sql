-- ---------------------------------------------------------------------------
-- roadmap_completion: transaction quality, sessions, and MFA recovery
--
-- These tables store user-authored preferences and review decisions alongside
-- Plaid data. Plaid-synced rows stay immutable; annotations and splits are
-- separate user-owned records.
-- ---------------------------------------------------------------------------

create table public.transaction_annotations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  transaction_id  uuid not null references public.transactions (id) on delete cascade,
  note            text,
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, transaction_id)
);

create table public.transaction_splits (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  transaction_id  uuid not null references public.transactions (id) on delete cascade,
  category        text not null,
  amount          numeric(14, 2) not null check (amount > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.linked_refunds (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  charge_transaction_id  uuid not null references public.transactions (id) on delete cascade,
  refund_transaction_id  uuid not null references public.transactions (id) on delete cascade,
  amount                 numeric(14, 2) not null check (amount > 0),
  created_at             timestamptz not null default now(),
  unique (user_id, charge_transaction_id, refund_transaction_id)
);

create table public.transaction_review_decisions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('duplicate', 'refund')),
  subject_id  text not null,
  decision    text not null check (decision in ('confirmed', 'dismissed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, kind, subject_id)
);

create table public.user_session_records (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  session_id    text not null,
  user_agent    text,
  ip_hash       text,
  revoked_at    timestamptz,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (user_id, session_id)
);

create table public.mfa_backup_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  code_hash   text not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, code_hash)
);

create index transaction_annotations_user_txn_idx on public.transaction_annotations (user_id, transaction_id);
create index transaction_splits_user_txn_idx on public.transaction_splits (user_id, transaction_id);
create index linked_refunds_user_idx on public.linked_refunds (user_id);
create index transaction_review_decisions_user_idx on public.transaction_review_decisions (user_id, kind);
create index user_session_records_user_seen_idx on public.user_session_records (user_id, last_seen_at desc);
create index mfa_backup_codes_user_idx on public.mfa_backup_codes (user_id);

create trigger transaction_annotations_set_updated_at
  before update on public.transaction_annotations
  for each row execute function public.set_updated_at();
create trigger transaction_splits_set_updated_at
  before update on public.transaction_splits
  for each row execute function public.set_updated_at();
create trigger transaction_review_decisions_set_updated_at
  before update on public.transaction_review_decisions
  for each row execute function public.set_updated_at();

create or replace function public.validate_transaction_split_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_transaction_id uuid;
  expected numeric(14, 2);
  actual numeric(14, 2);
begin
  target_transaction_id = coalesce(new.transaction_id, old.transaction_id);

  select abs(t.amount)::numeric(14, 2)
  into expected
  from public.transactions t
  where t.id = target_transaction_id;

  select coalesce(sum(s.amount), 0)::numeric(14, 2)
  into actual
  from public.transaction_splits s
  where s.transaction_id = target_transaction_id;

  if actual > 0 and actual <> expected then
    raise exception 'transaction split total must equal transaction amount';
  end if;

  return null;
end;
$$;

create constraint trigger transaction_splits_validate_total
  after insert or update or delete on public.transaction_splits
  deferrable initially deferred
  for each row execute function public.validate_transaction_split_total();

grant select, insert, update, delete on public.transaction_annotations to authenticated;
grant select, insert, update, delete on public.transaction_splits to authenticated;
grant select, insert, update, delete on public.linked_refunds to authenticated;
grant select, insert, update, delete on public.transaction_review_decisions to authenticated;
grant select, insert, update, delete on public.user_session_records to authenticated;
grant select, insert, update, delete on public.mfa_backup_codes to authenticated;

alter table public.transaction_annotations enable row level security;
alter table public.transaction_splits enable row level security;
alter table public.linked_refunds enable row level security;
alter table public.transaction_review_decisions enable row level security;
alter table public.user_session_records enable row level security;
alter table public.mfa_backup_codes enable row level security;

create policy "transaction_annotations_select_own" on public.transaction_annotations
  for select to authenticated using (user_id = (select auth.uid()));
create policy "transaction_annotations_insert_own" on public.transaction_annotations
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "transaction_annotations_update_own" on public.transaction_annotations
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "transaction_annotations_delete_own" on public.transaction_annotations
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "transaction_splits_select_own" on public.transaction_splits
  for select to authenticated using (user_id = (select auth.uid()));
create policy "transaction_splits_insert_own" on public.transaction_splits
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "transaction_splits_update_own" on public.transaction_splits
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "transaction_splits_delete_own" on public.transaction_splits
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "linked_refunds_select_own" on public.linked_refunds
  for select to authenticated using (user_id = (select auth.uid()));
create policy "linked_refunds_insert_own" on public.linked_refunds
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "linked_refunds_update_own" on public.linked_refunds
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "linked_refunds_delete_own" on public.linked_refunds
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "transaction_review_decisions_select_own" on public.transaction_review_decisions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "transaction_review_decisions_insert_own" on public.transaction_review_decisions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "transaction_review_decisions_update_own" on public.transaction_review_decisions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "transaction_review_decisions_delete_own" on public.transaction_review_decisions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "user_session_records_select_own" on public.user_session_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy "user_session_records_insert_own" on public.user_session_records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "user_session_records_update_own" on public.user_session_records
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "user_session_records_delete_own" on public.user_session_records
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "mfa_backup_codes_select_own" on public.mfa_backup_codes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "mfa_backup_codes_insert_own" on public.mfa_backup_codes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "mfa_backup_codes_update_own" on public.mfa_backup_codes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "mfa_backup_codes_delete_own" on public.mfa_backup_codes
  for delete to authenticated using (user_id = (select auth.uid()));
