-- One-off scheduled (future-dated) transactions: "rent due on the 25th",
-- "transfer $500 to savings on the 1st". Rows live here until their date
-- arrives; the daily sync cron promotes due rows into `transactions` with a
-- deterministic `scheduled-<id>` plaid_transaction_id (idempotent upsert),
-- then marks them promoted. Exactly one of account_id / manual_account_id is
-- required — a scheduled entry is always against a concrete account, and the
-- ON DELETE CASCADE clears orphaned schedules when that account goes away.

create table public.scheduled_transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('debit', 'credit')),
  amount            numeric(14, 2) not null check (amount > 0),
  merchant          text not null check (char_length(merchant) between 1 and 120),
  scheduled_date    date not null,
  category          text check (category is null or char_length(category) between 1 and 120),
  notes             text check (notes is null or char_length(notes) between 1 and 500),
  account_id        uuid references public.accounts (id) on delete cascade,
  manual_account_id uuid references public.manual_accounts (id) on delete cascade,
  status            text not null default 'scheduled' check (status in ('scheduled', 'promoted', 'cancelled')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint scheduled_transactions_account_exactly_one
    check ((account_id is not null)::int + (manual_account_id is not null)::int = 1)
);

create index scheduled_transactions_user_idx on public.scheduled_transactions (user_id);
-- The daily cron promotion scans for due rows across all users.
create index scheduled_transactions_due_idx on public.scheduled_transactions (status, scheduled_date);

create trigger scheduled_transactions_set_updated_at
  before update on public.scheduled_transactions
  for each row execute function public.set_updated_at();

alter table public.scheduled_transactions enable row level security;

revoke all on table public.scheduled_transactions from anon;
grant select, insert, update, delete on table public.scheduled_transactions to authenticated;

create policy "scheduled_transactions_select_own" on public.scheduled_transactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "scheduled_transactions_insert_own" on public.scheduled_transactions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "scheduled_transactions_update_own" on public.scheduled_transactions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "scheduled_transactions_delete_own" on public.scheduled_transactions
  for delete to authenticated using (user_id = (select auth.uid()));
