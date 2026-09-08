-- Persistent transaction review state and workflow
-- Supports two persisted states: 'needs_review' and 'reviewed'.
-- Automatically backfills all existing transactions into needs_review.
-- Keeps state updated or reopened atomically on source changes.

-- Bound the wait for the ACCESS EXCLUSIVE lock that CREATE TRIGGER below takes
-- on public.transactions. If a long-running writer holds the table, abort and
-- let the deployment be retried rather than blocking ingestion indefinitely or
-- initializing between the backfill and trigger activation.
set local lock_timeout = '15s';

-- 1. Ensure composite unique constraint on transactions(user_id, id) for composite FK
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_user_id_id_key' and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions add constraint transactions_user_id_id_key unique (user_id, id);
  end if;
end $$;

-- 2. Create public.transaction_review_states table
create table if not exists public.transaction_review_states (
  transaction_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('needs_review', 'reviewed')),
  version bigint not null default 1 check (version > 0),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transaction_review_states_tx_fk foreign key (user_id, transaction_id)
    references public.transactions (user_id, id) on delete cascade,
  constraint transaction_review_states_status_reviewed_at_check check (
    (status = 'reviewed' and reviewed_at is not null) or
    (status = 'needs_review' and reviewed_at is null)
  )
);

create index if not exists transaction_review_states_user_status_idx
  on public.transaction_review_states (user_id, status, transaction_id);

-- RLS
alter table public.transaction_review_states enable row level security;
revoke all on public.transaction_review_states from anon;
revoke insert, update, delete on public.transaction_review_states from authenticated;
grant select on public.transaction_review_states to authenticated;

drop policy if exists transaction_review_states_select_own on public.transaction_review_states;
create policy transaction_review_states_select_own on public.transaction_review_states
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

-- 3. Trigger functions for automatic initialization and reopening
create or replace function private.handle_transaction_review_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.transaction_review_states (
    transaction_id,
    user_id,
    status,
    version,
    reviewed_at,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.user_id,
    'needs_review',
    1,
    null,
    now(),
    now()
  )
  on conflict (transaction_id) do nothing;
  return new;
end;
$$;

create or replace function private.handle_transaction_review_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_material_changed boolean;
  v_rows integer;
begin
  v_material_changed := (
    new.amount is distinct from old.amount or
    new.date is distinct from old.date or
    new.account_id is distinct from old.account_id or
    new.manual_account_id is distinct from old.manual_account_id or
    new.iso_currency_code is distinct from old.iso_currency_code or
    new.merchant_name is distinct from old.merchant_name or
    new.name is distinct from old.name or
    new.pfc_primary is distinct from old.pfc_primary or
    new.pfc_detailed is distinct from old.pfc_detailed or
    new.pending is distinct from old.pending or
    new.source is distinct from old.source
  );

  if v_material_changed then
    update public.transaction_review_states
    set
      status = 'needs_review',
      reviewed_at = null,
      version = version + 1,
      updated_at = now()
    where transaction_id = new.id;

    -- Reopening must happen in the same transaction as the fact change. If the
    -- review row is missing, fail the source write rather than let a changed
    -- bank amount stay silently approved (or unreviewable).
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'transaction % changed materially but has no review state row', new.id;
    end if;
  end if;

  return new;
end;
$$;

-- Trigger firing is internal: the invoking role never needs EXECUTE on these
-- functions, and PUBLIC execute on a SECURITY DEFINER function is pure attack
-- surface. scripts/check-rls.sql rejects any that keep the default grant.
revoke all on function private.handle_transaction_review_insert() from public, anon, authenticated;
revoke all on function private.handle_transaction_review_update() from public, anon, authenticated;

drop trigger if exists trg_transactions_review_insert on public.transactions;
create trigger trg_transactions_review_insert
  after insert on public.transactions
  for each row execute function private.handle_transaction_review_insert();

drop trigger if exists trg_transactions_review_update on public.transactions;
create trigger trg_transactions_review_update
  after update on public.transactions
  for each row execute function private.handle_transaction_review_update();

-- 4. Backfill existing transactions
insert into public.transaction_review_states (
  transaction_id,
  user_id,
  status,
  version,
  reviewed_at,
  created_at,
  updated_at
)
select
  t.id,
  t.user_id,
  'needs_review',
  1,
  null,
  now(),
  now()
from public.transactions t
where not exists (
  select 1 from public.transaction_review_states r where r.transaction_id = t.id
);

-- Fail the migration rather than commit a partial backfill: every transaction
-- must have exactly one owner-matching review row before the transaction lock
-- is released.
do $$
declare
  v_unbacked bigint;
begin
  select count(*) into v_unbacked
  from public.transactions t
  where not exists (
    select 1 from public.transaction_review_states r
    where r.transaction_id = t.id and r.user_id = t.user_id
  );
  if v_unbacked <> 0 then
    raise exception 'transaction_review_states backfill incomplete: % transaction(s) without an owner-matching review row', v_unbacked;
  end if;
end $$;

-- 5. Read view: public.transaction_review_ledger
-- security_invoker = true evaluates underlying RLS policies as calling user
create or replace view public.transaction_review_ledger
with (security_invoker = true)
as
select
  t.id,
  t.user_id,
  t.account_id,
  t.manual_account_id,
  t.plaid_transaction_id,
  t.amount,
  t.iso_currency_code,
  t.date,
  t.authorized_date,
  t.name,
  t.merchant_name,
  t.pfc_primary,
  t.pfc_detailed,
  t.payment_channel,
  t.pending,
  t.source,
  t.created_at,
  t.updated_at,
  r.status as review_status,
  r.version as review_version,
  r.reviewed_at,
  (
    not t.pending
    and not exists (
      select 1 from public.linked_duplicates d
      where d.user_id = t.user_id and d.excluded_transaction_id = t.id
    )
    and r.transaction_id is not null
  ) as review_eligible,
  (r.transaction_id is null) as review_state_missing
from public.transactions t
left join public.transaction_review_states r
  on r.transaction_id = t.id and r.user_id = t.user_id;

revoke all on public.transaction_review_ledger from anon;
grant select on public.transaction_review_ledger to authenticated;

-- `security_invoker = true` evaluates the underlying-table privileges as the
-- calling role, so the authenticated role needs an explicit SELECT on the
-- source tables. `transaction_review_states` (above) and `linked_duplicates`
-- (20260809194242) are already granted; `public.transactions` relied on the
-- project-level default privilege, which is not reproduced on a clean local
-- stack (the same divergence PR #165 hit). Grant it explicitly. RLS on
-- `public.transactions` is unchanged and still filters every row.
grant select on public.transactions to authenticated;

-- 6. Atomic mutation RPC: public.set_transaction_review_state_atomic
create or replace function public.set_transaction_review_state_atomic(
  p_user_id uuid,
  p_status text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_item_count integer;
  v_tx_id uuid;
  v_expected_ver bigint;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_result_items jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_tx record;
  v_review record;
begin
  if p_user_id is null or p_status is null or p_status not in ('needs_review', 'reviewed') then
    raise exception 'Invalid review status or user' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Items must be a JSON array' using errcode = '22023';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count = 0 or v_item_count > 100 then
    raise exception 'Batch size must be between 1 and 100 items' using errcode = '22023';
  end if;

  -- Verify array elements and unique transaction IDs
  for v_item in select * from jsonb_to_recordset(p_items) as x(transaction_id text, expected_version text)
  loop
    if v_item.transaction_id is null or v_item.transaction_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid transaction_id format' using errcode = '22023';
    end if;
    if v_item.expected_version is null or v_item.expected_version !~ '^[1-9][0-9]*$' then
      raise exception 'Invalid expected_version format' using errcode = '22023';
    end if;
  end loop;

  -- Check duplicates in batch
  if (
    select count(distinct x.transaction_id)
    from jsonb_to_recordset(p_items) as x(transaction_id text)
  ) <> v_item_count then
    raise exception 'Duplicate transaction_id in batch' using errcode = '22023';
  end if;

  -- Lock parent transactions in ascending UUID order with explicit user filter
  -- Any missing transaction, foreign transaction, pending transaction, or excluded duplicate causes an immediate abort
  for v_tx in
    select t.id, t.pending
    from public.transactions t
    join (
      select (x.transaction_id)::uuid as id
      from jsonb_to_recordset(p_items) as x(transaction_id text)
    ) req on req.id = t.id
    where t.user_id = p_user_id
    order by t.id asc
    for update of t
  loop
    null;
  end loop;

  -- Ensure all requested IDs exist and belong to user
  if (
    select count(*)
    from public.transactions t
    join (
      select (x.transaction_id)::uuid as id
      from jsonb_to_recordset(p_items) as x(transaction_id text)
    ) req on req.id = t.id
    where t.user_id = p_user_id
  ) <> v_item_count then
    -- Do not disclose which IDs are missing or foreign; raise 404-equivalent
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;

  -- Check if any transaction is pending
  if exists (
    select 1
    from public.transactions t
    join (
      select (x.transaction_id)::uuid as id
      from jsonb_to_recordset(p_items) as x(transaction_id text)
    ) req on req.id = t.id
    where t.user_id = p_user_id and t.pending = true
  ) then
    raise exception 'REVIEW_STATE_CHANGED' using errcode = '40001';
  end if;

  -- Check if any transaction is an excluded duplicate
  if exists (
    select 1
    from public.linked_duplicates d
    join (
      select (x.transaction_id)::uuid as id
      from jsonb_to_recordset(p_items) as x(transaction_id text)
    ) req on req.id = d.excluded_transaction_id
    where d.user_id = p_user_id
  ) then
    raise exception 'REVIEW_STATE_CHANGED' using errcode = '40001';
  end if;

  -- Lock review rows in ascending UUID order
  for v_review in
    select r.transaction_id, r.status, r.version, r.reviewed_at
    from public.transaction_review_states r
    join (
      select (x.transaction_id)::uuid as id
      from jsonb_to_recordset(p_items) as x(transaction_id text)
    ) req on req.id = r.transaction_id
    where r.user_id = p_user_id
    order by r.transaction_id asc
    for update of r
  loop
    null;
  end loop;

  -- Ensure all requested review states exist
  if (
    select count(*)
    from public.transaction_review_states r
    join (
      select (x.transaction_id)::uuid as id
      from jsonb_to_recordset(p_items) as x(transaction_id text)
    ) req on req.id = r.transaction_id
    where r.user_id = p_user_id
  ) <> v_item_count then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;

  -- Check versions against expected versions
  if exists (
    select 1
    from public.transaction_review_states r
    join (
      select (x.transaction_id)::uuid as id, (x.expected_version)::bigint as expected_ver
      from jsonb_to_recordset(p_items) as x(transaction_id text, expected_version text)
    ) req on req.id = r.transaction_id
    where r.user_id = p_user_id and r.version <> req.expected_ver
  ) then
    raise exception 'REVIEW_STATE_CHANGED' using errcode = '40001';
  end if;

  -- Perform compare-and-set updates
  for v_item in
    select (x.transaction_id)::uuid as id, (x.expected_version)::bigint as expected_ver
    from jsonb_to_recordset(p_items) as x(transaction_id text, expected_version text)
    order by (x.transaction_id)::uuid asc
  loop
    select status, version, reviewed_at into v_review
    from public.transaction_review_states
    where transaction_id = v_item.id and user_id = p_user_id;

    if v_review.status = p_status then
      -- Unchanged no-op
      v_unchanged := v_unchanged + 1;
      v_result_items := v_result_items || jsonb_build_object(
        'transaction_id', v_item.id,
        'status', v_review.status,
        'version', v_review.version::text,
        'reviewed_at', v_review.reviewed_at
      );
    else
      -- Updated: increment version, update status and reviewed_at
      update public.transaction_review_states
      set
        status = p_status,
        version = version + 1,
        reviewed_at = case when p_status = 'reviewed' then v_now else null end,
        updated_at = v_now
      where transaction_id = v_item.id and user_id = p_user_id
      returning status, version, reviewed_at into v_review;

      v_updated := v_updated + 1;
      v_result_items := v_result_items || jsonb_build_object(
        'transaction_id', v_item.id,
        'status', v_review.status,
        'version', v_review.version::text,
        'reviewed_at', v_review.reviewed_at
      );
    end if;
  end loop;

  return jsonb_build_object(
    'updated', v_updated,
    'unchanged', v_unchanged,
    'items', v_result_items
  );
end;
$$;

revoke all on function public.set_transaction_review_state_atomic(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_transaction_review_state_atomic(uuid, text, jsonb) to service_role;
