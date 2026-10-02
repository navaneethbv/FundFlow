-- Additive metadata only; existing batches retain unknown history values.
alter table public.import_review_batches
  add column history_profile_name text,
  add column history_summary jsonb;
alter table public.import_review_rows
  add column review_flags text[],
  add column committed_target jsonb;

-- Import records are service-authored, not client configuration.
-- Existing preview/commit routes already use the service client for all writes.
revoke insert, update, delete on public.import_review_batches, public.import_review_rows from authenticated, anon;

-- Finalize review state and its history together after ledger writes succeed.
-- Service-only: callers must authenticate and validate account ownership first.
create or replace function public.finish_import_with_history(p_user_id uuid, p_batch_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_targets jsonb;
  v_summary jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>20000 then
    raise exception 'Invalid import history rows';
  end if;
  perform 1 from public.import_review_batches where id=p_batch_id and user_id=p_user_id for update;
  if not found then raise exception 'Import batch not found'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(id uuid, account_id uuid, manual_account_id uuid)
    where (x.account_id is null) = (x.manual_account_id is null)
      or not exists (select 1 from public.import_review_rows r where r.id=x.id and r.batch_id=p_batch_id and r.user_id=p_user_id)
      or (x.account_id is not null and not exists (select 1 from public.accounts a where a.id=x.account_id and a.user_id=p_user_id))
      or (x.manual_account_id is not null and not exists (select 1 from public.manual_accounts a where a.id=x.manual_account_id and a.user_id=p_user_id))
  ) then raise exception 'Invalid import history target'; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_rows) x) <> jsonb_array_length(p_rows) then
    raise exception 'Duplicate import history row';
  end if;
  update public.import_review_rows r set status='committed', committed_target=jsonb_strip_nulls(jsonb_build_object('account_id', x.account_id, 'manual_account_id', x.manual_account_id, 'name', coalesce(
      (select a.name from public.accounts a where a.id=x.account_id and a.user_id=p_user_id),
      (select a.name from public.manual_accounts a where a.id=x.manual_account_id and a.user_id=p_user_id))))
    from jsonb_to_recordset(p_rows) as x(id uuid, account_id uuid, manual_account_id uuid)
    where r.id=x.id and r.batch_id=p_batch_id and r.user_id=p_user_id and r.status<>'committed';
  get diagnostics v_count = row_count;
  -- A replay must not change the timestamp, target, or counts of a completed run.
  if v_count=0 then return; end if;
  select coalesce(jsonb_agg(target), '[]'::jsonb) into v_targets from (
    select distinct on (coalesce(committed_target->>'account_id', committed_target->>'manual_account_id')) committed_target as target
    from public.import_review_rows where user_id=p_user_id and batch_id=p_batch_id and status='committed' and committed_target is not null
    order by coalesce(committed_target->>'account_id', committed_target->>'manual_account_id'), row_index, id
  ) targets;
  select jsonb_build_object(
    'imported', count(*) filter(where status='committed'),
    'skipped', count(*) filter(where status<>'committed'),
    'flagged', case when count(*) filter(where review_flags is null)>0 then null else count(*) filter(where cardinality(review_flags)>0) end,
    'targets', v_targets,
    'unknownTargets', count(*) filter(where status='committed' and committed_target is null),
    'committedAt', clock_timestamp(),
    'committedBy', p_user_id
  ) into v_summary from public.import_review_rows where user_id=p_user_id and batch_id=p_batch_id;
  update public.import_review_batches set status='committed', history_summary=v_summary where id=p_batch_id and user_id=p_user_id;
end $$;
revoke all on function public.finish_import_with_history(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.finish_import_with_history(uuid,uuid,jsonb) to service_role;
