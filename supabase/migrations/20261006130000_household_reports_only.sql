-- Aggregate-only household access.
--
-- Written allowlist: month, category, signed total, positive outflow total,
-- positive inflow total, and transaction count. Filters are a household id,
-- an inclusive date range, and one category. Date ranges are capped at two
-- years and each month/category group requires at least three posted rows.
-- No transaction, merchant, account, annotation, receipt, or member id is
-- returned by the RPC.

alter table public.household_members
  drop constraint if exists household_members_role_check;
alter table public.household_members
  add constraint household_members_role_check
  check (role in ('owner', 'member', 'read_only', 'reports_only'));

alter table public.household_invites
  add column if not exists role text not null default 'member';
alter table public.household_invites
  drop constraint if exists household_invites_role_check;
alter table public.household_invites
  add constraint household_invites_role_check
  check (role in ('member', 'reports_only'));

create or replace function private.is_reports_only()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.user_id = (select auth.uid())
      and hm.role = 'reports_only'
      and hm.status = 'active'
  );
$$;

revoke all on function private.is_reports_only() from public, anon;
grant execute on function private.is_reports_only() to authenticated, service_role;

create or replace function public.household_report_aggregates(
  p_household_id uuid,
  p_start date,
  p_end date,
  p_category text default null
)
returns table (
  month date,
  category text,
  total_amount numeric,
  outflow_total numeric,
  inflow_total numeric,
  transaction_count bigint
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_household_id is null or p_start is null or p_end is null then
    raise exception 'aggregate_filters_required' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'aggregate_date_order' using errcode = '22023';
  end if;
  if p_end - p_start > 730 then
    raise exception 'aggregate_date_range_too_large' using errcode = '22023';
  end if;
  if p_category is not null and char_length(btrim(p_category)) > 80 then
    raise exception 'aggregate_category_too_large' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.households h
    left join public.household_members hm
      on hm.household_id = h.id
     and hm.user_id = caller_id
     and hm.status = 'active'
    where h.id = p_household_id
      and (
        h.owner_user_id = caller_id
        or hm.role in ('member', 'read_only', 'reports_only')
      )
  ) then
    raise exception 'household_not_found' using errcode = '42501';
  end if;

  return query
  select
    date_trunc('month', t.date::timestamp)::date as month,
    coalesce(nullif(btrim(t.pfc_primary), ''), 'UNCATEGORIZED') as category,
    round(sum(t.amount), 2) as total_amount,
    round(sum(case when t.amount > 0 then t.amount else 0 end), 2) as outflow_total,
    round(sum(case when t.amount < 0 then -t.amount else 0 end), 2) as inflow_total,
    count(*) as transaction_count
  from public.transactions t
  join public.accounts a on a.id = t.account_id and a.user_id = t.user_id
  join public.plaid_items pi on pi.id = a.plaid_item_id
  where pi.shared_household_id = p_household_id
    and t.date between p_start and p_end
    and t.pending = false
    and upper(coalesce(t.pfc_primary, '')) not in (
      'TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS',
      'LOAN_DISBURSEMENTS', 'RECONCILE_ADJUSTMENT'
    )
    and (
      p_category is null
      or upper(coalesce(nullif(btrim(t.pfc_primary), ''), 'UNCATEGORIZED')) = upper(btrim(p_category))
    )
  group by 1, 2
  having count(*) >= 3
  order by 1, 2;
end;
$$;

revoke all on function public.household_report_aggregates(uuid, date, date, text) from public, anon;
grant execute on function public.household_report_aggregates(uuid, date, date, text)
  to authenticated, service_role;

-- A reports-only user must not receive any row from a direct PostgREST/SQL
-- table read. Restrictive policies AND with every existing owner/household
-- policy, while the bootstrap tables remain available for authentication and
-- MFA setup. The aggregate function above is the only new read path.
do $$
declare
  target text;
begin
  for target in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and rowsecurity
      and tablename not in ('profiles', 'user_session_records', 'mfa_backup_codes')
  loop
    execute format('drop policy if exists reports_only_access on public.%I', target);
    execute format($policy$
      create policy reports_only_access
        on public.%I as restrictive
        for all to authenticated
        using (
          (select private.session_not_revoked())
          and (select private.mfa_satisfied())
          and not (select private.is_reports_only())
        )
        with check (
          (select private.session_not_revoked())
          and (select private.mfa_satisfied())
          and not (select private.is_reports_only())
        )
    $policy$, target);
  end loop;
end;
$$;
