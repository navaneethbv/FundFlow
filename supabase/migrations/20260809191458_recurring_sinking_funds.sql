alter table public.sinking_funds
  add column cadence text not null default 'one_time'
    check (cadence in ('one_time', 'annual', 'semiannual', 'quarterly', 'custom')),
  add column custom_interval_months integer,
  add column cycle_anchor_date date;

update public.sinking_funds
set cycle_anchor_date = due_date
where cycle_anchor_date is null;

alter table public.sinking_funds
  alter column cycle_anchor_date set not null,
  add constraint sinking_funds_custom_interval_check
    check (
      (cadence = 'custom' and custom_interval_months between 1 and 120)
      or (cadence <> 'custom' and custom_interval_months is null)
    );

drop policy if exists "sinking_funds_insert_own" on public.sinking_funds;
drop policy if exists "sinking_funds_update_own" on public.sinking_funds;
drop policy if exists "sinking_funds_delete_own" on public.sinking_funds;

revoke insert, update, delete on public.sinking_funds from authenticated;
grant select on public.sinking_funds to authenticated;
