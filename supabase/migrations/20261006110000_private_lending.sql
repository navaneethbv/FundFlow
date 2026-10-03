-- Owner-scoped private lending.  Balances are derived from the principal,
-- optional daily interest, and payments; no provider or counterparty data is
-- fetched.

create table public.private_loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('lent','borrowed')),
  counterparty text not null check (char_length(counterparty) between 1 and 120),
  principal numeric(14,2) not null check (principal > 0 and principal <= 1000000000),
  annual_interest_rate numeric(7,4) not null default 0 check (annual_interest_rate >= 0 and annual_interest_rate <= 100),
  start_date date not null,
  due_date date,
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'active' check (status in ('active','settled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or due_date >= start_date)
);

create table public.private_loan_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  loan_id uuid not null references public.private_loans(id) on delete cascade,
  payment_date date not null,
  amount numeric(14,2) not null check (amount > 0 and amount <= 1000000000),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index private_loans_user_idx on public.private_loans(user_id, start_date desc);
create index private_loan_payments_user_loan_idx on public.private_loan_payments(user_id, loan_id, payment_date);
alter table public.private_loans enable row level security;
alter table public.private_loan_payments enable row level security;
revoke all on public.private_loans, public.private_loan_payments from anon;
grant select on public.private_loans, public.private_loan_payments to authenticated;
create policy private_loans_select_own on public.private_loans for select to authenticated
  using (user_id = (select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()));
create policy private_loan_payments_select_own on public.private_loan_payments for select to authenticated
  using (user_id = (select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied()));

create trigger private_loans_set_updated_at before update on public.private_loans
  for each row execute function public.set_updated_at();

create or replace function public.create_private_loan(
  p_user_id uuid,
  p_direction text,
  p_counterparty text,
  p_principal numeric,
  p_annual_interest_rate numeric,
  p_start_date date,
  p_due_date date,
  p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' or p_user_id is null
    or p_direction not in ('lent','borrowed')
    or p_counterparty is null or char_length(trim(p_counterparty)) not between 1 and 120
    or p_principal is null or p_principal <= 0 or p_principal > 1000000000
    or p_annual_interest_rate is null or p_annual_interest_rate < 0 or p_annual_interest_rate > 100
    or p_start_date is null or (p_due_date is not null and p_due_date < p_start_date)
    or (p_notes is not null and char_length(p_notes) > 1000) then
    raise exception 'Invalid private loan' using errcode = '22023';
  end if;
  insert into public.private_loans(user_id,direction,counterparty,principal,annual_interest_rate,start_date,due_date,notes)
    values(p_user_id,p_direction,trim(p_counterparty),round(p_principal,2),round(p_annual_interest_rate,4),p_start_date,p_due_date,nullif(trim(p_notes),''))
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_private_loan(uuid,text,text,numeric,numeric,date,date,text)
  from public, anon, authenticated;
grant execute on function public.create_private_loan(uuid,text,text,numeric,numeric,date,date,text) to service_role;

create or replace function public.record_private_loan_payment(
  p_user_id uuid,
  p_loan_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_loan public.private_loans%rowtype;
  v_payment record;
  v_cursor date;
  v_principal numeric := 0;
  v_interest numeric := 0;
  v_days integer;
  v_interest_payment numeric;
  v_principal_payment numeric;
  v_remaining numeric;
  v_id uuid;
begin
  if auth.role() <> 'service_role' or p_user_id is null or p_loan_id is null
    or p_payment_date is null or p_amount is null or p_amount <= 0 or p_amount > 1000000000
    or p_note is not null and char_length(p_note) > 500 then
    raise exception 'Invalid private loan payment' using errcode = '22023';
  end if;
  select * into v_loan from public.private_loans
    where id = p_loan_id and user_id = p_user_id for update;
  if not found then raise exception 'Private loan not found' using errcode = 'P0002'; end if;
  if p_payment_date < v_loan.start_date then raise exception 'Payment predates loan' using errcode = '22023'; end if;
  if v_loan.status = 'settled' then raise exception 'Loan is already settled' using errcode = '22023'; end if;
  -- The balance check below replays only earlier payments, so a back-dated
  -- payment would ignore later ones and allow repaying more than is owed.
  if exists (select 1 from public.private_loan_payments
    where loan_id = p_loan_id and user_id = p_user_id and payment_date > p_payment_date) then
    raise exception 'Record payments in date order; a later payment already exists' using errcode = '22023';
  end if;

  v_principal := v_loan.principal;
  v_cursor := v_loan.start_date;
  for v_payment in
    select payment_date, amount from public.private_loan_payments
      where loan_id = p_loan_id and user_id = p_user_id and payment_date <= p_payment_date
      order by payment_date, id
  loop
    v_days := greatest(0, v_payment.payment_date - v_cursor);
    v_interest := v_interest + v_principal * (v_loan.annual_interest_rate / 100) * (v_days / 365.0);
    v_interest_payment := least(v_payment.amount, v_interest);
    v_interest := v_interest - v_interest_payment;
    v_principal_payment := least(greatest(0, v_payment.amount - v_interest_payment), v_principal);
    v_principal := v_principal - v_principal_payment;
    v_cursor := v_payment.payment_date;
  end loop;
  v_days := greatest(0, p_payment_date - v_cursor);
  v_interest := v_interest + v_principal * (v_loan.annual_interest_rate / 100) * (v_days / 365.0);
  v_remaining := round(v_principal + v_interest, 2);
  if round(p_amount,2) > v_remaining then raise exception 'Payment exceeds outstanding balance' using errcode = '22023'; end if;

  insert into public.private_loan_payments(user_id,loan_id,payment_date,amount,note)
    values(p_user_id,p_loan_id,p_payment_date,round(p_amount,2),nullif(trim(p_note),''))
    returning id into v_id;
  if round(v_remaining - p_amount, 2) = 0 then
    update public.private_loans set status = 'settled' where id = p_loan_id and user_id = p_user_id;
  end if;
  return jsonb_build_object('id',v_id,'amount',round(p_amount,2),'interestApplied',round(least(p_amount,v_interest),2),'principalApplied',round(greatest(0,p_amount - least(p_amount,v_interest)),2),'remaining',round(v_remaining-p_amount,2));
end $$;
revoke all on function public.record_private_loan_payment(uuid,uuid,date,numeric,text)
  from public, anon, authenticated;
grant execute on function public.record_private_loan_payment(uuid,uuid,date,numeric,text) to service_role;
