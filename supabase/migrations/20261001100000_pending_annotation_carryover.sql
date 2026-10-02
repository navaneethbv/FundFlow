-- Provider removals can precede replacements on later pages, including across
-- bounded repair runs. This server-owned queue is reset on a cursor replay.
-- No existing financial rows are rewritten by this migration.
alter table public.plaid_items
  add column transaction_removal_ids text[] not null default '{}';

create or replace function public.finish_transaction_sync_page(
  p_user_id uuid,
  p_item_id uuid,
  p_removed_ids text[],
  p_complete boolean,
  p_restart boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed text[];
  v_pending public.transactions%rowtype;
  v_posted public.transactions%rowtype;
  v_matches integer;
  v_has_edits boolean;
begin
  if p_user_id is null or p_item_id is null or p_complete is null or p_restart is null
    or p_removed_ids is null or cardinality(p_removed_ids) > 100000 then
    raise exception 'Invalid transaction sync page';
  end if;
  select case when p_restart then '{}'::text[] else i.transaction_removal_ids end
    into v_removed from public.plaid_items i
    where i.id=p_item_id and i.user_id=p_user_id for update;
  if not found then raise exception 'Sync item not found for owner'; end if;
  select coalesce(array_agg(distinct id), '{}') into v_removed
    from unnest(v_removed || p_removed_ids) as ids(id) where id is not null;
  if cardinality(v_removed)>100000 then raise exception 'Transaction removal limit exceeded'; end if;
  update public.plaid_items set transaction_removal_ids=v_removed
    where id=p_item_id and user_id=p_user_id;
  if not p_complete then return; end if;

  -- Lock in deterministic order, including posted rows, before moving children.
  perform t.id from public.transactions t
    join public.accounts a on a.id=t.account_id and a.user_id=p_user_id
    where t.user_id=p_user_id and a.plaid_item_id=p_item_id
      and (t.plaid_transaction_id=any(v_removed) or t.pending_transaction_id=any(v_removed))
    order by t.id for update of t;
  for v_pending in
    select t.* from public.transactions t
      join public.accounts a on a.id=t.account_id and a.user_id=p_user_id
      where t.user_id=p_user_id and a.plaid_item_id=p_item_id
        and t.plaid_transaction_id=any(v_removed) and t.pending
      order by t.id
  loop
    select count(*) into v_matches from public.transactions t
      where t.user_id=p_user_id and t.account_id=v_pending.account_id and not t.pending
        and t.pending_transaction_id=v_pending.plaid_transaction_id;
    -- A conflict below skips carryover for this row only: the pending row is
    -- then removed as it was before carryover existed. Raising instead would
    -- fail every later sync for the item and stop all new transactions.
    if v_matches<>1 then continue; end if;
    select t.* into strict v_posted from public.transactions t
      where t.user_id=p_user_id and t.account_id=v_pending.account_id and not t.pending
        and t.pending_transaction_id=v_pending.plaid_transaction_id;

    -- Do not silently overwrite a separate edit made on the posted row.
    if exists(select 1 from public.transaction_annotations where user_id=p_user_id and transaction_id=v_pending.id)
      and exists(select 1 from public.transaction_annotations where user_id=p_user_id and transaction_id=v_posted.id)
    then continue; end if;
    if exists(select 1 from public.transaction_splits where user_id=p_user_id and transaction_id=v_pending.id) then
      if v_posted.amount is distinct from v_pending.amount
        or exists(select 1 from public.transaction_splits where user_id=p_user_id and transaction_id=v_posted.id)
      then continue; end if;
    end if;
    -- Confirmed financial relationships cannot be reinterpreted automatically.
    if exists(select 1 from public.linked_refunds where user_id=p_user_id and (charge_transaction_id=v_pending.id or refund_transaction_id=v_pending.id))
      or exists(select 1 from public.linked_transfers where user_id=p_user_id and (out_transaction_id=v_pending.id or in_transaction_id=v_pending.id))
      or exists(select 1 from public.linked_duplicates where user_id=p_user_id and (kept_transaction_id=v_pending.id or excluded_transaction_id=v_pending.id))
    then continue; end if;

    select exists(select 1 from public.transaction_annotations where user_id=p_user_id and transaction_id=v_pending.id)
      or exists(select 1 from public.transaction_splits where user_id=p_user_id and transaction_id=v_pending.id)
      into v_has_edits;
    update public.transaction_annotations set transaction_id=v_posted.id where user_id=p_user_id and transaction_id=v_pending.id;
    update public.transaction_splits set transaction_id=v_posted.id where user_id=p_user_id and transaction_id=v_pending.id;
    update public.receipts set transaction_id=v_posted.id where user_id=p_user_id and transaction_id=v_pending.id;
    -- The posted row may already carry the same goal or stream link; keep that
    -- one so the moves below cannot violate either unique constraint.
    delete from public.goal_progress_events p where p.user_id=p_user_id and p.transaction_id=v_pending.id
      and exists(select 1 from public.goal_progress_events q
        where q.user_id=p_user_id and q.goal_id=p.goal_id and q.transaction_id=v_posted.id);
    delete from public.recurring_stream_transactions p where p.user_id=p_user_id and p.transaction_id=v_pending.id
      and exists(select 1 from public.recurring_stream_transactions q
        where q.user_id=p_user_id and q.recurring_stream_id=p.recurring_stream_id and q.transaction_id=v_posted.id);
    update public.goal_progress_events set transaction_id=v_posted.id where user_id=p_user_id and transaction_id=v_pending.id;
    update public.recurring_stream_transactions set transaction_id=v_posted.id where user_id=p_user_id and transaction_id=v_pending.id;
    -- Pending rows are not review-eligible. Preserve their history/version and
    -- reopen on posting, consistent with the existing source-change trigger.
    update public.transaction_review_states r set
      status='needs_review', reviewed_at=null,
      version=greatest(r.version, old.version)+1,
      created_at=least(r.created_at, old.created_at), updated_at=now()
      from public.transaction_review_states old
      where r.user_id=p_user_id and r.transaction_id=v_posted.id
        and old.user_id=p_user_id and old.transaction_id=v_pending.id
        and (v_has_edits or old.version>1);
    if not exists(select 1 from public.transaction_review_states where user_id=p_user_id and transaction_id=v_posted.id) then
      raise exception 'Missing transaction review state';
    end if;
  end loop;
  delete from public.transactions t using public.accounts a
    where t.user_id=p_user_id and t.account_id=a.id and a.user_id=p_user_id
      and a.plaid_item_id=p_item_id and t.plaid_transaction_id=any(v_removed);
  update public.plaid_items set transaction_removal_ids='{}'
    where id=p_item_id and user_id=p_user_id;
end;
$$;
revoke all on function public.finish_transaction_sync_page(uuid,uuid,text[],boolean,boolean) from public, anon, authenticated;
grant execute on function public.finish_transaction_sync_page(uuid,uuid,text[],boolean,boolean) to service_role;
