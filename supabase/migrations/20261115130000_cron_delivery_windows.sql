alter table public.profiles add column last_maintenance_at timestamptz;

create table public.cron_delivery_windows (
  delivery_key text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  sent_through timestamptz,
  claim_id uuid,
  claim_expires_at timestamptz
);

alter table public.cron_delivery_windows enable row level security;
revoke all on public.cron_delivery_windows from public, anon, authenticated;
grant select, insert, update on public.cron_delivery_windows to service_role;

create function public.claim_cron_delivery(
  p_key text, p_user_id uuid, p_claim_id uuid, p_skip_after timestamptz
) returns table (sent_through timestamptz)
language sql
set search_path = ''
as $$
  insert into public.cron_delivery_windows as delivery
    (delivery_key, user_id, claim_id, claim_expires_at)
  values (p_key, p_user_id, p_claim_id, now() + interval '10 minutes')
  on conflict (delivery_key) do update set
    claim_id = excluded.claim_id, claim_expires_at = excluded.claim_expires_at
  where delivery.user_id is not distinct from p_user_id
    and (delivery.claim_expires_at is null or delivery.claim_expires_at <= now())
    and (delivery.sent_through is null or delivery.sent_through < p_skip_after)
  returning delivery.sent_through;
$$;

revoke all on function public.claim_cron_delivery(text, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_cron_delivery(text, uuid, uuid, timestamptz) to service_role;

alter table public.plaid_items add column new_accounts_available boolean not null default false;

-- Each AI quota key carries its UTC day, so a late refund cannot credit a new window.
create function public.refund_ai_rate_limit(p_key text)
returns void
language sql
set search_path = ''
as $$
  update public.rate_limit_counters
  set count = count - 1
  where key = p_key and count > 0
    and key ~ '^ai-(ask|receipt):[^:]+:[0-9]{4}-[0-9]{2}-[0-9]{2}$';
$$;
revoke all on function public.refund_ai_rate_limit(text) from public, anon, authenticated;
grant execute on function public.refund_ai_rate_limit(text) to service_role;
grant select, update on public.rate_limit_counters to service_role;

-- Fair ordering across daily runs. Keep manual-only, alert-only and broken-bank users.
create function public.list_maintenance_users()
returns table (user_id uuid)
language sql stable
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where exists (select 1 from public.plaid_items x where x.user_id = p.id)
     or exists (select 1 from public.manual_accounts x where x.user_id = p.id)
     or exists (select 1 from public.transactions x where x.user_id = p.id)
     or exists (select 1 from public.notifications x where x.user_id = p.id)
     or exists (select 1 from public.scheduled_transactions x where x.user_id = p.id)
  order by p.last_maintenance_at asc nulls first, p.id;
$$;
revoke all on function public.list_maintenance_users() from public, anon, authenticated;
grant execute on function public.list_maintenance_users() to service_role;
