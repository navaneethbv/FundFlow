-- Phase 7: Goals Revamp and Account Allocations
alter table public.goals
  add column if not exists goal_type text not null default 'save_up'
    check (goal_type in ('save_up', 'pay_down')),
  add column if not exists image_slug text,
  add column if not exists monthly_contribution numeric(14, 2) check (monthly_contribution >= 0),
  add column if not exists spending_reduces boolean not null default false,
  add column if not exists starting_balance numeric(14, 2),
  add column if not exists target_balance numeric(14, 2);

create table if not exists public.goal_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  goal_id             uuid not null references public.goals (id) on delete cascade,
  account_id          uuid not null references public.accounts (id) on delete cascade,
  allocated_amount    numeric(14, 2) check (allocated_amount >= 0),
  use_entire_balance  boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (goal_id, account_id)
);

alter table public.goal_accounts enable row level security;

create policy "goal_accounts_all_own" on public.goal_accounts
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.goal_progress_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  event_date date not null,
  amount numeric(14, 2) not null,
  event_type text not null check (
    event_type in ('manual_contribution', 'manual_adjustment', 'transaction')
  ),
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (goal_id, transaction_id)
);

create index if not exists goal_progress_events_user_date_idx
  on public.goal_progress_events (user_id, event_date);

alter table public.goal_progress_events enable row level security;

create policy "goal_progress_events_all_own" on public.goal_progress_events
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.transaction_annotations
  add column if not exists goal_id uuid references public.goals (id) on delete set null;
