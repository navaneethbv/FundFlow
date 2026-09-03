-- Account reconciliation (features.md #2): a per-account statement workflow.
--
-- 1. `cleared_at` on transaction_annotations: a reconcile flag that lives
--    beside the synced row (annotations are the user-owned layer; synced
--    transactions are never mutated). A NULL cleared_at means outstanding.
-- 2. `account_reconciliations`: each completed reconcile records the
--    statement's date and ending balance, so the workflow is repeatable per
--    statement period.

alter table public.transaction_annotations
  add column if not exists cleared_at timestamptz;

create table public.account_reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  account_id         uuid references public.accounts (id) on delete cascade,
  manual_account_id  uuid references public.manual_accounts (id) on delete cascade,
  statement_date     date not null,
  statement_balance  numeric(14, 2) not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint account_reconciliations_account_exactly_one
    check ((account_id is not null)::int + (manual_account_id is not null)::int = 1)
);

create index account_reconciliations_user_idx on public.account_reconciliations (user_id);
create index account_reconciliations_account_idx on public.account_reconciliations (account_id, manual_account_id, statement_date);

create trigger account_reconciliations_set_updated_at
  before update on public.account_reconciliations
  for each row execute function public.set_updated_at();

alter table public.account_reconciliations enable row level security;

revoke all on table public.account_reconciliations from anon;
grant select, insert, update, delete on table public.account_reconciliations to authenticated;

create policy "account_reconciliations_select_own" on public.account_reconciliations
  for select to authenticated using (user_id = (select auth.uid()));
create policy "account_reconciliations_insert_own" on public.account_reconciliations
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "account_reconciliations_update_own" on public.account_reconciliations
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "account_reconciliations_delete_own" on public.account_reconciliations
  for delete to authenticated using (user_id = (select auth.uid()));
