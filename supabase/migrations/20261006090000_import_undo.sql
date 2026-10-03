-- Guarded undo for committed imports.
--
-- Undo is deliberately a service-only transaction.  The review rows retain
-- the exact ledger row each commit created, so a batch can never be replayed
-- by matching mutable descriptions or amounts.  The operation refuses when
-- any later annotation, split, link, reconciliation, receipt, goal, recurring
-- or rule record depends on one of those rows.

alter table public.import_review_rows
  add column if not exists committed_transaction_id uuid
    references public.transactions(id) on delete set null;

create index if not exists import_review_rows_committed_transaction_idx
  on public.import_review_rows(user_id, committed_transaction_id);

create or replace function public.record_import_commit_transactions(
  p_user_id uuid,
  p_batch_id uuid,
  p_rows jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_entry jsonb;
  v_id uuid;
  v_txn uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_user_id is null or p_batch_id is null
    or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) > 20000 then
    raise exception 'Invalid import commit rows' using errcode = '22023';
  end if;
  perform 1 from public.import_review_batches
    where id = p_batch_id and user_id = p_user_id for update;
  if not found then raise exception 'Import batch not found' using errcode = '22023'; end if;

  for v_entry in select value from jsonb_array_elements(p_rows) loop
    begin
      v_id := (v_entry->>'row_id')::uuid;
      v_txn := (v_entry->>'transaction_id')::uuid;
    exception when others then
      raise exception 'Invalid import commit row' using errcode = '22023';
    end;
    if not exists (
      select 1 from public.import_review_rows r
      where r.id = v_id and r.batch_id = p_batch_id and r.user_id = p_user_id
        and r.status = 'committed'
    ) then
      raise exception 'Invalid import commit row' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.transactions t
      where t.id = v_txn and t.user_id = p_user_id
        and t.source = 'import' and t.plaid_transaction_id like 'import-%'
    ) then
      raise exception 'Invalid import transaction' using errcode = '22023';
    end if;
    update public.import_review_rows
      set committed_transaction_id = v_txn
      where id = v_id and batch_id = p_batch_id and user_id = p_user_id;
  end loop;
end $$;

revoke all on function public.record_import_commit_transactions(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_import_commit_transactions(uuid, uuid, jsonb)
  to service_role;

create or replace function public.undo_import_batch(
  p_user_id uuid,
  p_batch_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.import_review_batches%rowtype;
  v_ids uuid[];
  v_commit_at timestamptz;
  v_reason text;
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_user_id is null or p_batch_id is null then
    raise exception 'Invalid import batch' using errcode = '22023';
  end if;
  select * into v_batch from public.import_review_batches
    where id = p_batch_id and user_id = p_user_id for update;
  if not found then raise exception 'Import batch not found' using errcode = 'P0002'; end if;
  if v_batch.status = 'discarded' then
    return jsonb_build_object('status','already_undone','deleted',0);
  end if;
  if v_batch.status <> 'committed' then
    return jsonb_build_object('status','refused','reason','Only a committed batch can be undone.');
  end if;

  v_commit_at := v_batch.updated_at;
  select coalesce(array_agg(distinct committed_transaction_id), '{}'::uuid[])
    into v_ids
    from public.import_review_rows
    where batch_id = p_batch_id and user_id = p_user_id and status = 'committed';
  if coalesce(cardinality(v_ids), 0) = 0
    or exists (
      select 1 from public.import_review_rows
      where batch_id = p_batch_id and user_id = p_user_id
        and status = 'committed' and committed_transaction_id is null
    ) then
    return jsonb_build_object(
      'status','refused',
      'reason','This import predates guarded undo tracking and cannot be removed safely.'
    );
  end if;

  -- Lock all target rows before checking dependencies.  This serializes undo
  -- against an in-flight annotation, link, reconciliation, or provider write.
  perform 1 from public.transactions
    where user_id = p_user_id and id = any(v_ids) order by id for update;
  if (select count(*) from public.transactions where user_id = p_user_id and id = any(v_ids)) <> cardinality(v_ids) then
    return jsonb_build_object('status','refused','reason','One or more imported transactions no longer exists.');
  end if;

  if exists (select 1 from public.transactions where user_id = p_user_id and id = any(v_ids)
    and (source <> 'import' or plaid_transaction_id not like 'import-%')) then
    v_reason := 'A provider record now owns one of the imported rows.';
  elsif exists (select 1 from public.transactions where user_id = p_user_id and id = any(v_ids)
    and updated_at > v_commit_at) then
    v_reason := 'A later provider or ledger edit changed one of the imported rows.';
  elsif exists (select 1 from public.transaction_annotations where user_id = p_user_id and transaction_id = any(v_ids)
    and updated_at > v_commit_at) then
    v_reason := 'A later transaction annotation depends on this import.';
  elsif exists (select 1 from public.transaction_splits where user_id = p_user_id and transaction_id = any(v_ids)) then
    v_reason := 'A transaction split depends on this import.';
  elsif exists (select 1 from public.linked_refunds where user_id = p_user_id and (charge_transaction_id = any(v_ids) or refund_transaction_id = any(v_ids))) then
    v_reason := 'A refund link depends on this import.';
  elsif exists (select 1 from public.linked_transfers where user_id = p_user_id and (out_transaction_id = any(v_ids) or in_transaction_id = any(v_ids))) then
    v_reason := 'A transfer link depends on this import.';
  elsif exists (select 1 from public.linked_duplicates where user_id = p_user_id and (kept_transaction_id = any(v_ids) or excluded_transaction_id = any(v_ids))) then
    v_reason := 'A duplicate decision depends on this import.';
  elsif exists (select 1 from public.receipts where user_id = p_user_id and transaction_id = any(v_ids)) then
    v_reason := 'A receipt depends on this import.';
  elsif exists (select 1 from public.goal_progress_events where user_id = p_user_id and transaction_id = any(v_ids)) then
    v_reason := 'A goal progress event depends on this import.';
  elsif exists (select 1 from public.recurring_stream_transactions where user_id = p_user_id and transaction_id = any(v_ids)) then
    v_reason := 'A recurring stream match depends on this import.';
  elsif exists (select 1 from public.rule_changes where user_id = p_user_id and transaction_id = any(v_ids)) then
    v_reason := 'A rule run depends on this import.';
  elsif exists (
    select 1 from public.account_reconciliations r
    join public.transactions t on t.user_id = p_user_id and t.id = any(v_ids)
    where r.user_id = p_user_id and r.created_at > v_commit_at
      and ((r.account_id is not null and r.account_id = t.account_id)
        or (r.manual_account_id is not null and r.manual_account_id = t.manual_account_id))
  ) then
    v_reason := 'A later account reconciliation depends on this import.';
  end if;
  if v_reason is not null then
    return jsonb_build_object('status','refused','reason',v_reason,'transactionCount',cardinality(v_ids));
  end if;

  delete from public.transactions where user_id = p_user_id and id = any(v_ids);
  get diagnostics v_count = row_count;
  update public.import_review_rows
    set status = 'rejected', committed_transaction_id = null
    where batch_id = p_batch_id and user_id = p_user_id and status = 'committed';
  update public.import_review_batches set status = 'discarded' where id = p_batch_id and user_id = p_user_id;
  return jsonb_build_object('status','undone','deleted',v_count);
end $$;

revoke all on function public.undo_import_batch(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.undo_import_batch(uuid, uuid) to service_role;
