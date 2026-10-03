-- Confirmed recurring price changes are derived history, not a user-authored
-- provider row. The service role records them after checking linked payments.
create table if not exists public.recurring_price_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recurring_stream_id uuid not null references public.recurring_streams (id) on delete cascade,
  effective_date date not null,
  previous_amount numeric(14,2) not null check (previous_amount >= 0),
  new_amount numeric(14,2) not null check (new_amount > previous_amount),
  created_at timestamptz not null default now(),
  unique (user_id, recurring_stream_id, effective_date, new_amount)
);

create index if not exists recurring_price_changes_user_idx
  on public.recurring_price_changes (user_id, effective_date desc);

alter table public.recurring_price_changes enable row level security;
revoke all on table public.recurring_price_changes from anon;
grant select on table public.recurring_price_changes to authenticated;

drop policy if exists "recurring_price_changes_select_own" on public.recurring_price_changes;
create policy "recurring_price_changes_select_own"
  on public.recurring_price_changes
  for select to authenticated using (
    user_id = (select auth.uid())
    and private.session_not_revoked()
    and private.mfa_satisfied()
  );
