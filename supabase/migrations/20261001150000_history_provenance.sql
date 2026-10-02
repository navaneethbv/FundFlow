-- No historical rows are rewritten. NULL is a legacy observation whose source
-- is inferred from its account linkage; new flagged writers record it explicitly.
alter table public.account_balance_snapshots add column provenance text
  check (provenance in ('observed','estimated','manual'));
comment on column public.account_balance_snapshots.provenance is
 'Legacy NULL derives from account source. Estimates never replace observations or manual entries.';

create function private.protect_observed_account_history()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.provenance='estimated' and coalesce(old.provenance,case when old.manual_account_id is null then 'observed' else 'manual' end)<>'estimated' then
    raise exception 'An estimate cannot replace an observed or manual balance' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.protect_observed_account_history() from public,anon,authenticated;
create trigger protect_observed_account_history before update on public.account_balance_snapshots
  for each row execute function private.protect_observed_account_history();

-- Future asset work uses this writer for explicit estimates only. It never
-- changes current account balances, and owner/source validation is atomic.
create function public.record_estimated_account_history(
 p_user_id uuid,p_account_id uuid,p_manual_account_id uuid,p_date date,p_balance numeric,p_currency text
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_written integer;
begin
 if (p_account_id is null)=(p_manual_account_id is null) or p_date is null or p_balance is null
   or p_balance='NaN'::numeric or abs(p_balance)>=1000000000000 or p_currency is null or p_currency !~ '^[A-Z]{3}$' then
   raise exception 'Invalid estimated balance' using errcode='22023';
 end if;
 if p_account_id is not null then
   if not exists(select 1 from public.accounts where id=p_account_id and user_id=p_user_id and coalesce(iso_currency_code,'USD')=p_currency) then
     raise exception 'Account not found' using errcode='P0002';
   end if;
 else
   if p_currency<>'USD' or not exists(select 1 from public.manual_accounts where id=p_manual_account_id and user_id=p_user_id) then
     raise exception 'Manual account not found' using errcode='P0002';
   end if;
 end if;
 insert into public.account_balance_snapshots(user_id,account_id,manual_account_id,snapshot_date,current_balance,iso_currency_code,captured_at,provenance)
 values(p_user_id,p_account_id,p_manual_account_id,p_date,p_balance,p_currency,clock_timestamp(),'estimated')
 on conflict(account_id,manual_account_id,snapshot_date) do update
 set current_balance=excluded.current_balance,iso_currency_code=excluded.iso_currency_code,captured_at=excluded.captured_at,provenance='estimated'
 where account_balance_snapshots.user_id=p_user_id and account_balance_snapshots.provenance='estimated';
 get diagnostics v_written=row_count;
 return v_written=1;
end $$;
revoke all on function public.record_estimated_account_history(uuid,uuid,uuid,date,numeric,text) from public,anon,authenticated;
grant execute on function public.record_estimated_account_history(uuid,uuid,uuid,date,numeric,text) to service_role;
