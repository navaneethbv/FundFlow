-- Conditions are additive. Existing rows remain legacy rules until explicitly edited.
create or replace function private.rule_condition_leaves(node jsonb, depth integer default 1)
returns integer language plpgsql immutable set search_path = '' as $$
declare child jsonb; total integer := 0; n integer;
begin
  if jsonb_typeof(node) <> 'object' then return -1; end if;
  if node ? 'op' then
    if depth > 3 or node->>'op' is null or node->>'op' not in ('and','or') or jsonb_typeof(node->'children') <> 'array' then return -1; end if;
    if jsonb_array_length(node->'children') not between 1 and 20 then return -1; end if;
    for child in select value from jsonb_array_elements(node->'children') loop
      n := private.rule_condition_leaves(child, depth + 1);
      if n < 0 then return -1; end if;
      total := total + n;
      if total > 20 then return -1; end if;
    end loop;
    return total;
  end if;
  if node->>'field' = 'legacy' then
    if node->>'matchType' in ('merchant','keyword','account','regex') and length(node->>'pattern') between 1 and 300 then return 1; end if;
  elsif node->>'field' = 'amount' then
    if node->>'operator' = 'any' then return 1; end if;
    if node->>'operator' in ('gt','gte','lt','lte','between') and jsonb_typeof(node->'value') = 'number'
      and (not node ? 'maxValue' or jsonb_typeof(node->'maxValue') = 'number') then return 1; end if;
  elsif node->>'field' in ('merchant','name','descriptor','account','category','tag','notes','type') then
    if node->>'operator' in ('contains','equals','regex') and jsonb_typeof(node->'value') = 'string' and length(node->>'value') between 1 and 300 then return 1; end if;
  end if;
  return -1;
end $$;
alter table public.merchant_rules
  add column conditions jsonb default null,
  add column actions jsonb default null,
  add column amount_condition jsonb default null;
alter table public.merchant_rules add constraint merchant_rules_conditions_valid check (conditions is null or private.rule_condition_leaves(conditions) between 1 and 20);
alter table public.merchant_rules add constraint merchant_rules_actions_valid check (actions is null or (jsonb_typeof(actions) = 'object' and octet_length(actions::text) <= 4096));
alter table public.merchant_rules drop constraint merchant_rules_match_type_check;
alter table public.merchant_rules add constraint merchant_rules_match_type_check check (match_type in ('merchant','keyword','account','regex','compound'));
alter table public.transaction_annotations add column rule_actions jsonb default null;

-- Server validation checks each regex before execution. Direct clients keep
-- their existing authored columns, but cannot bypass the new validation path.
do $$
declare tbl text; cols text;
begin
  foreach tbl in array array['merchant_rules','transaction_annotations'] loop
    execute format('revoke insert, update on public.%I from authenticated', tbl);
    select string_agg(quote_ident(column_name), ',') into cols
      from information_schema.columns where table_schema='public' and table_name=tbl
      and column_name not in ('conditions','actions','amount_condition','rule_actions');
    execute format('grant insert (%s), update (%s) on public.%I to authenticated', cols, cols, tbl);
  end loop;
end $$;

create table public.rule_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id uuid references public.merchant_rules(id) on delete set null,
  trigger text not null check (trigger in ('manual','sync','import')),
  matched integer not null default 0 check (matched >= 0),
  changed integer default 0 check (changed >= 0 and changed <= matched),
  status text not null default 'running' check (status in ('running','success','failed')),
  error text check (length(error) <= 160),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index rule_runs_owner_created on public.rule_runs(user_id, created_at desc);
alter table public.rule_runs enable row level security;
create policy rule_runs_select_own on public.rule_runs for select to authenticated
using (user_id = (select auth.uid()) and private.session_not_revoked() and private.mfa_satisfied());
grant select on public.rule_runs to authenticated;
grant all on public.rule_runs to service_role;
create table public.rule_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.rule_runs(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(run_id, transaction_id)
);
create index rule_changes_owner_transaction on public.rule_changes(user_id, transaction_id);
alter table public.rule_changes enable row level security;
create policy rule_changes_select_own on public.rule_changes for select to authenticated
using (user_id = (select auth.uid()) and private.session_not_revoked() and private.mfa_satisfied());
grant select on public.rule_changes to authenticated;
grant all on public.rule_changes to service_role;

-- One run applies at most 500 CAS-protected rows. Lock transactions in id order.
-- User-authored overrides and tags are preserved; effects are separate from facts.
create function public.apply_compound_rule_run(p_user_id uuid, p_run_id uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare entry jsonb; tx public.transactions; ann public.transaction_annotations; changed_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'Invalid rule batch'; end if;
  if p_run_id is not null and not exists(select 1 from public.rule_runs where id=p_run_id and user_id=p_user_id and status='running') then raise exception 'Invalid run'; end if;
  for entry in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
    select * into tx from public.transactions where id=(entry->>'id')::uuid and user_id=p_user_id for update;
    if not found or tx.pending or tx.updated_at is distinct from (entry->>'version')::timestamptz then raise exception 'Transaction changed; preview again' using errcode='40001'; end if;
    select * into ann from public.transaction_annotations where transaction_id=tx.id and user_id=p_user_id for update;
    if ann.updated_at is distinct from (entry->>'annotationVersion')::timestamptz then raise exception 'Annotation changed; preview again' using errcode='40001'; end if;
    if ann.rule_actions is not distinct from entry->'actions' then continue; end if;
    insert into public.transaction_annotations(user_id,transaction_id,rule_actions)
      values(p_user_id,tx.id,entry->'actions')
      on conflict(user_id,transaction_id) do update set rule_actions=excluded.rule_actions, updated_at=now();
    changed_count := changed_count + 1;
    if entry->'actions'->>'notify' = 'true' then
      insert into public.notifications(user_id,type,severity,title,body,subject_key)
      values(p_user_id,'rule_match','info','A transaction matched your rule','Open Rules and transaction details to inspect the change.', 'rule:' || (entry->>'ruleId') || ':' || tx.id::text)
      on conflict do nothing;
    end if;
    if p_run_id is not null then
      insert into public.rule_changes(user_id,run_id,transaction_id) values(p_user_id,p_run_id,tx.id);
    end if;
  end loop;
  if p_run_id is not null then
    update public.rule_runs set changed=changed_count,status='success',completed_at=now() where id=p_run_id and user_id=p_user_id;
  end if;
  return changed_count;
end $$;
revoke all on function public.apply_compound_rule_run(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_compound_rule_run(uuid,uuid,jsonb) to service_role;
