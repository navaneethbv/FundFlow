/* tsqllint-disable set-quoted-identifier */

-- Enforce ownership of every account referenced by an authenticated bill
-- insert. The original insert policy checked only account_id, while the
-- update policy already enforced this invariant for payment_account_id.

drop policy if exists "credit_card_bills_insert_own" on public.credit_card_bills;

create policy "credit_card_bills_insert_own" on public.credit_card_bills
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts a
      where a.id = credit_card_bills.account_id
        and a.user_id = (select auth.uid())
    )
    and (
      payment_account_id is null
      or exists (
        select 1 from public.accounts p
        where p.id = credit_card_bills.payment_account_id
          and p.user_id = (select auth.uid())
      )
    )
  );
