-- Real credit-card bill synchronization from the approved Plaid Liabilities
-- integration. A bill is modeled separately from purchase streams: statement
-- balance, minimum payment, due date, and the account used to pay it. The
-- Recurring page's credit-card bucket is populated only from this model, so
-- card-funded purchases stay Expenses and a bill payment (a transfer) is never
-- double-counted as spending.

create table public.credit_card_bills (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  account_id        uuid not null references public.accounts (id) on delete cascade,
  statement_balance numeric(14, 2),
  minimum_payment   numeric(14, 2),
  due_date          date,
  payment_account_id uuid references public.accounts (id) on delete set null,
  sync_timestamp    timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, account_id)
);

create index credit_card_bills_user_idx
  on public.credit_card_bills (user_id);

create trigger credit_card_bills_set_updated_at
  before update on public.credit_card_bills
  for each row execute function public.set_updated_at();

alter table public.credit_card_bills enable row level security;

revoke all on table public.credit_card_bills from anon;
grant select, insert, update, delete on table public.credit_card_bills to authenticated;

-- The bill belongs to the caller and its credit account must also be the
-- caller's (the M8 pattern: a child-row user_id check alone would let a
-- caller write a bill against someone else's account).
create policy "credit_card_bills_select_own" on public.credit_card_bills
  for select to authenticated using (user_id = (select auth.uid()));

create policy "credit_card_bills_insert_own" on public.credit_card_bills
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = credit_card_bills.account_id and a.user_id = (select auth.uid())
    )
  );

create policy "credit_card_bills_update_own" on public.credit_card_bills
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = credit_card_bills.account_id and a.user_id = (select auth.uid())
    )
    and (
      payment_account_id is null
      or exists (
        select 1 from public.accounts p
        where p.id = credit_card_bills.payment_account_id and p.user_id = (select auth.uid())
      )
    )
  );

create policy "credit_card_bills_delete_own" on public.credit_card_bills
  for delete to authenticated using (user_id = (select auth.uid()));
