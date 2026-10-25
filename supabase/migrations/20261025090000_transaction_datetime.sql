-- Keep Plaid's optional time of day next to the existing calendar dates so a
-- bill lookup can say when a charge happened, not just on which day.
-- Plaid only reports these for some institutions; existing rows stay null
-- until an ordinary sync supplies them. No grants change; the transaction
-- owner, session and MFA policies still apply.
alter table public.transactions
  add column if not exists datetime timestamptz,
  add column if not exists authorized_datetime timestamptz;
comment on column public.transactions.datetime is
  'Plaid transaction datetime when the institution reports one.';
comment on column public.transactions.authorized_datetime is
  'Plaid authorized_datetime when the institution reports one.';
