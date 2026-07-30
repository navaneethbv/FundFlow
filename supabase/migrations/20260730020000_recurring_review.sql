-- Occurrence tracking for the Recurring page (Phase 5): review workflow,
-- account linkage, Plaid-provided occurrence anchors, and a join table
-- resolving each stream's Plaid transaction_ids to local transaction rows
-- so occurrence completion is read from real matches, not a heuristic.

alter table public.recurring_streams
  add column reviewed_at timestamptz,
  add column dismissed_at timestamptz,
  add column account_id uuid references public.accounts (id) on delete set null,
  add column first_date date,
  add column last_date date,
  add column predicted_next_date date,
  add column user_amount numeric(14, 2);

create index recurring_streams_account_id_idx on public.recurring_streams (account_id);

create table public.recurring_stream_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recurring_stream_id uuid not null references public.recurring_streams (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (recurring_stream_id, transaction_id)
);

create index recurring_stream_transactions_user_idx
  on public.recurring_stream_transactions (user_id);
create index recurring_stream_transactions_stream_idx
  on public.recurring_stream_transactions (recurring_stream_id);

alter table public.recurring_stream_transactions enable row level security;

create policy "rst_select_own" on public.recurring_stream_transactions
  for select using (user_id = (select auth.uid()));

-- Household visibility follows the stream's own household rule
-- (recurring_streams_select_household): the stream's plaid_item must be
-- explicitly shared AND the caller must be a member of that household.
-- A bare `exists (select 1 from recurring_streams where id = ...)` here
-- would let ANY authenticated user read ANY user's join rows — the same
-- class of bug Phase 3's shared_transaction_authorization migration fixed
-- for transactions, and the reason this table doesn't ship with that gap.
create policy "rst_select_shared_stream" on public.recurring_stream_transactions
  for select using (
    exists (
      select 1 from public.recurring_streams rs
      join public.plaid_items pi on pi.id = rs.plaid_item_id
      where rs.id = recurring_stream_transactions.recurring_stream_id
        and pi.shared_household_id is not null
        and public.is_household_member(pi.shared_household_id)
    )
  );

-- Plaid-synced data: only the service client writes (during a recurring
-- refresh), same trust level as recurring_streams itself. No insert/update/
-- delete policy exists, so the cookie client cannot write history even with
-- a grant.
grant select on public.recurring_stream_transactions to authenticated;
