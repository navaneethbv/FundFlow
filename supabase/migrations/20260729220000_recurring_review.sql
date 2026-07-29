-- Phase 5: Recurring Stream Reviews and Occurrences
alter table public.recurring_streams
  add column if not exists reviewed_at timestamptz,
  add column if not exists dismissed_at timestamptz,
  add column if not exists account_id uuid references public.accounts (id) on delete set null,
  add column if not exists first_date date,
  add column if not exists last_date date,
  add column if not exists predicted_next_date date,
  add column if not exists user_amount numeric(14, 2);

create table if not exists public.recurring_stream_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recurring_stream_id uuid not null references public.recurring_streams (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (recurring_stream_id, transaction_id)
);

create index if not exists recurring_stream_transactions_user_idx
  on public.recurring_stream_transactions (user_id);

alter table public.recurring_stream_transactions enable row level security;

create policy "rst_select_own" on public.recurring_stream_transactions
  for select using (user_id = (select auth.uid()));

create policy "rst_select_shared_stream" on public.recurring_stream_transactions
  for select using (
    exists (
      select 1 from public.recurring_streams rs
      where rs.id = recurring_stream_transactions.recurring_stream_id
    )
  );
