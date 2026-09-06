-- ---------------------------------------------------------------------------
-- 20260906140000_gate_public_role_policies (FF-02, S-1 completion)
--
-- 20260905100000 checked 'authenticated' = any(roles) when iterating pg_policies.
-- Postgres defaults `create policy` without a `to` clause to the `public` role
-- (which implicitly applies to all roles, including authenticated). As a result,
-- 35 public-role policies across secondary user tables (such as api_tokens,
-- calendar_tokens, etc.) were left ungated by mfa_satisfied and session_not_revoked.
--
-- This migration re-runs the policy rewrite for any policy whose roles overlap
-- with public or authenticated (roles && array['public', 'authenticated']::name[]).
-- It skips policies that already mention mfa_satisfied or session_not_revoked.
--
-- Excluded bootstrap tables:
--   * public.profiles
--   * public.user_session_records
--   * public.mfa_backup_codes
-- ---------------------------------------------------------------------------

do $$
declare
  gated_tables constant text[] := array[
    'account_reconciliations',
    'advice_progress',
    'ai_insights',
    'ai_settings',
    'alert_preferences',
    'api_tokens',
    'audit_logs',
    'budget_periods',
    'budget_templates',
    'calendar_tokens',
    'cancelled_subscriptions',
    'category_overrides',
    'credit_card_bills',
    'data_exports',
    'goal_accounts',
    'goal_progress_events',
    'household_invites',
    'household_members',
    'households',
    'import_review_batches',
    'import_review_rows',
    'import_source_account_mappings',
    'life_events',
    'manual_recurring_items',
    'merchant_rules',
    'milestones',
    'net_worth_snapshots',
    'notifications',
    'plaid_link_tokens',
    'push_subscriptions',
    'saved_reports',
    'saved_views',
    'shared_expenses',
    'sinking_funds',
    'sync_jobs',
    'user_tags',
    'weekly_report_deliveries'
  ];
  gate constant text := '(select private.session_not_revoked()) and (select private.mfa_satisfied())';
  target text;
  pol record;
  clauses text;
begin
  foreach target in array gated_tables loop
    if to_regclass('public.' || quote_ident(target)) is null then
      raise notice 'skipping %: table not present', target;
      continue;
    end if;

    for pol in
      select policyname, qual, with_check
        from pg_policies
       where schemaname = 'public'
         and tablename = target
         and roles && array['public', 'authenticated']::name[]
    loop
      if coalesce(pol.qual, '') like '%mfa_satisfied%'
        or coalesce(pol.with_check, '') like '%mfa_satisfied%' then
        continue;
      end if;

      clauses := '';
      if pol.qual is not null then
        clauses := clauses || format(' using ((%s) and %s)', pol.qual, gate);
      end if;
      if pol.with_check is not null then
        clauses := clauses || format(' with check ((%s) and %s)', pol.with_check, gate);
      end if;
      if clauses = '' then
        continue;
      end if;

      execute format(
        'alter policy %I on public.%I%s',
        pol.policyname,
        target,
        clauses
      );
    end loop;
  end loop;
end;
$$;
