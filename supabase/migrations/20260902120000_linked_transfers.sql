-- Inter-account transfer linking (features.md #3): pair the outflow from one
-- own account with the matching inflow on another so both sides net out of
-- spend/income/cash-flow aggregation exactly once, while staying in the
-- ledger. Dismissed suggestions persist in transaction_review_decisions under
-- kind 'transfer', so a re-sync never resurfaces them.

create table public.linked_transfers (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  out_transaction_id  uuid not null references public.transactions (id) on delete cascade,
  in_transaction_id   uuid not null references public.transactions (id) on delete cascade,
  amount              numeric(14, 2) not null check (amount > 0),
  created_at          timestamptz not null default now(),
  unique (user_id, out_transaction_id, in_transaction_id)
);

create index linked_transfers_user_idx on public.linked_transfers (user_id);
create index linked_transfers_out_idx on public.linked_transfers (out_transaction_id);
create index linked_transfers_in_idx on public.linked_transfers (in_transaction_id);

alter table public.linked_transfers enable row level security;

revoke all on table public.linked_transfers from anon;
grant select, insert, update, delete on table public.linked_transfers to authenticated;

create policy "linked_transfers_select_own" on public.linked_transfers
  for select to authenticated using (user_id = (select auth.uid()));
create policy "linked_transfers_insert_own" on public.linked_transfers
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "linked_transfers_update_own" on public.linked_transfers
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "linked_transfers_delete_own" on public.linked_transfers
  for delete to authenticated using (user_id = (select auth.uid()));

-- Widen the review-decision kinds to cover transfer suggestions.
alter table public.transaction_review_decisions
  drop constraint transaction_review_decisions_kind_check;
alter table public.transaction_review_decisions
  add constraint transaction_review_decisions_kind_check
    check (kind in ('duplicate', 'refund', 'transfer'));
