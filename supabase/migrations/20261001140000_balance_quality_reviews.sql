-- Quality decisions preserve provider values and affect history presentation only.
create table public.balance_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null references public.account_balance_snapshots(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  snapshot_date date not null,
  observed_at timestamptz not null,
  raw_balance numeric(14,2),
  currency text not null check (char_length(currency)=3),
  anchor_balance numeric(14,2),
  anchor_date date,
  reasons text[] not null check (cardinality(reasons) between 1 and 4),
  decision text not null default 'pending' check (decision in ('pending','accepted','carried')),
  version uuid not null default gen_random_uuid(),
  decided_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index balance_quality_active_snapshot_idx on public.balance_quality_reviews(snapshot_id) where superseded_at is null;
create index balance_quality_owner_date_idx on public.balance_quality_reviews(user_id,snapshot_date desc,id);
alter table public.balance_quality_reviews enable row level security;
revoke all on public.balance_quality_reviews from anon,authenticated;
grant select on public.balance_quality_reviews to authenticated;
grant all on public.balance_quality_reviews to service_role;
create policy balance_quality_reviews_select_own on public.balance_quality_reviews for select to authenticated using (
  user_id=(select auth.uid()) and (select private.session_not_revoked()) and (select private.mfa_satisfied())
);

-- Called by the snapshot writer, never directly by a browser or token client.
-- The frozen context is accepted only while its raw snapshot is still current.
create function public.record_balance_quality_review(
  p_user_id uuid, p_snapshot_id uuid, p_observed_at timestamptz,
  p_anchor_id uuid, p_reasons text[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_snapshot public.account_balance_snapshots%rowtype;
  v_anchor public.account_balance_snapshots%rowtype;
  v_active public.balance_quality_reviews%rowtype;
  v_id uuid;
begin
  if p_reasons is null or array_position(p_reasons,null) is not null or cardinality(p_reasons)>4 or not p_reasons <@ array['balance_jump','missing_balance','empty_holdings','holding_price_jump']::text[] then
    raise exception 'Invalid balance quality reasons' using errcode='22023';
  end if;
  select * into v_snapshot from public.account_balance_snapshots where id=p_snapshot_id and user_id=p_user_id and account_id is not null for update;
  if not found or v_snapshot.captured_at is distinct from p_observed_at then
    raise exception 'Snapshot changed; refresh before recording quality' using errcode='40001';
  end if;
  if p_anchor_id is not null then
    select * into v_anchor from public.account_balance_snapshots where id=p_anchor_id and user_id=p_user_id
      and account_id=v_snapshot.account_id and snapshot_date<v_snapshot.snapshot_date
      and iso_currency_code=v_snapshot.iso_currency_code and current_balance is not null
      and snapshot_date>=v_snapshot.snapshot_date-7
      and (to_jsonb(account_balance_snapshots)->>'provenance') is distinct from 'estimated'
      and not exists(select 1 from public.balance_quality_reviews r where r.user_id=p_user_id
        and r.snapshot_id=p_anchor_id and r.superseded_at is null and r.decision<>'accepted');
    if not found then raise exception 'Invalid balance quality anchor' using errcode='22023'; end if;
  end if;
  select * into v_active from public.balance_quality_reviews where user_id=p_user_id and snapshot_id=p_snapshot_id and superseded_at is null for update;
  if v_active.id is not null and cardinality(p_reasons)>0
    and v_active.raw_balance is not distinct from v_snapshot.current_balance
    and v_active.currency=v_snapshot.iso_currency_code and v_active.reasons=p_reasons then
    update public.balance_quality_reviews set observed_at=p_observed_at,version=gen_random_uuid() where id=v_active.id and user_id=p_user_id;
    return v_active.id;
  end if;
  update public.balance_quality_reviews set superseded_at=p_observed_at where user_id=p_user_id and snapshot_id=p_snapshot_id and superseded_at is null;
  if cardinality(p_reasons)=0 then return null; end if;
  insert into public.balance_quality_reviews(user_id,snapshot_id,account_id,snapshot_date,observed_at,raw_balance,currency,anchor_balance,anchor_date,reasons)
    values(p_user_id,p_snapshot_id,v_snapshot.account_id,v_snapshot.snapshot_date,p_observed_at,v_snapshot.current_balance,v_snapshot.iso_currency_code,v_anchor.current_balance,v_anchor.snapshot_date,p_reasons)
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_balance_quality_review(uuid,uuid,timestamptz,uuid,text[]) from public,anon,authenticated;
grant execute on function public.record_balance_quality_review(uuid,uuid,timestamptz,uuid,text[]) to service_role;

create function public.resolve_balance_quality_review(p_user_id uuid,p_review_id uuid,p_version uuid,p_decision text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_review public.balance_quality_reviews%rowtype;
  v_snapshot public.account_balance_snapshots%rowtype;
  v_snapshot_id uuid;
begin
  if p_decision not in ('accepted','carried') or p_decision is null then raise exception 'Invalid balance decision' using errcode='22023'; end if;
  select snapshot_id into v_snapshot_id from public.balance_quality_reviews where id=p_review_id and user_id=p_user_id;
  if not found then raise exception 'Balance review not found' using errcode='P0002'; end if;
  -- Same lock order as the recorder; a newer sync cannot race this decision.
  select * into v_snapshot from public.account_balance_snapshots where id=v_snapshot_id and user_id=p_user_id for update;
  select * into v_review from public.balance_quality_reviews where id=p_review_id and user_id=p_user_id for update;
  if v_review.superseded_at is not null or v_review.version<>p_version or p_version is null
    or v_review.observed_at is distinct from v_snapshot.captured_at
    or v_review.raw_balance is distinct from v_snapshot.current_balance
    or v_review.currency is distinct from v_snapshot.iso_currency_code then
    raise exception 'Balance review changed; refresh before deciding' using errcode='40001';
  end if;
  if v_review.decision=p_decision then return; end if;
  if v_review.decision<>'pending' then raise exception 'Balance review already resolved' using errcode='40001'; end if;
  if p_decision='carried' and v_review.anchor_balance is null then raise exception 'No reliable balance is available to carry forward' using errcode='22023'; end if;
  update public.balance_quality_reviews set decision=p_decision,decided_at=clock_timestamp() where id=p_review_id and user_id=p_user_id;
end $$;
revoke all on function public.resolve_balance_quality_review(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_balance_quality_review(uuid,uuid,uuid,text) to service_role;

-- Aggregate JSON avoids the API row limit truncating the set of daily accounts.
-- Every financial lookup is owner-scoped and holdings are compared only after
-- a successful same-item investment observation in the preceding day.
create function public.balance_quality_context(p_user_id uuid,p_date date)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'observedAt',s.captured_at,'anchorId',prior.id,
    'current',jsonb_build_object('date',s.snapshot_date,'balance',s.current_balance,'currency',s.iso_currency_code,
      'holdings',case when fresh.id is not null then coalesce(current_holdings.rows,'[]'::jsonb) else null end),
    'previous',case when prior.id is not null then jsonb_build_object('date',prior.snapshot_date,'balance',prior.current_balance,
      'currency',prior.iso_currency_code,'holdings',previous_holdings.rows) else null end
  ) order by s.account_id),'[]'::jsonb)
  from public.account_balance_snapshots s
  join public.accounts a on a.id=s.account_id and a.user_id=p_user_id
  left join lateral (
    select b.* from public.account_balance_snapshots b
    where b.user_id=p_user_id and b.account_id=s.account_id and b.snapshot_date<s.snapshot_date
      and (to_jsonb(b)->>'provenance') is distinct from 'estimated'
      and b.snapshot_date>=s.snapshot_date-7 and b.iso_currency_code=s.iso_currency_code and b.current_balance is not null
      and not exists(select 1 from public.balance_quality_reviews r where r.user_id=p_user_id and r.snapshot_id=b.id
        and r.superseded_at is null and r.decision<>'accepted')
    order by b.snapshot_date desc limit 1
  ) prior on true
  left join lateral (
    select j.id from public.sync_jobs j where j.user_id=p_user_id and j.plaid_item_id=a.plaid_item_id
      and j.job_type='investments' and j.status='done' and j.last_error is null
      and j.created_at<=s.captured_at and j.created_at>=s.captured_at-interval '24 hours'
    order by j.created_at desc limit 1
  ) fresh on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('id',h.security_id,'quantity',h.quantity,'price',h.institution_price,'value',h.institution_value)) rows
    from public.holdings h where h.user_id=p_user_id and h.account_id=s.account_id and h.source='plaid' and h.is_active
  ) current_holdings on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('id',h.security_id,'quantity',hs.quantity,'price',hs.price,'value',hs.value)) rows
    from public.holding_snapshots hs join public.holdings h on h.id=hs.holding_id and h.user_id=p_user_id and h.source='plaid'
    where hs.user_id=p_user_id and h.account_id=s.account_id and hs.snapshot_date=(
      select max(old.snapshot_date) from public.holding_snapshots old
      join public.holdings oh on oh.id=old.holding_id and oh.user_id=p_user_id and oh.source='plaid'
      where old.user_id=p_user_id and oh.account_id=s.account_id and old.snapshot_date<=prior.snapshot_date
        and old.snapshot_date>=s.snapshot_date-7
    )
  ) previous_holdings on true
  where s.user_id=p_user_id and s.snapshot_date=p_date and (to_jsonb(s)->>'provenance') is distinct from 'estimated';
$$;
revoke all on function public.balance_quality_context(uuid,date) from public,anon,authenticated;
grant execute on function public.balance_quality_context(uuid,date) to service_role;
