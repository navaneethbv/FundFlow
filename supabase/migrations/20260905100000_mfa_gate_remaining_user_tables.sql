-- ---------------------------------------------------------------------------
-- 20260905100000_mfa_gate_remaining_user_tables (FF-02, completion)
--
-- 20260904120000 extended private.session_not_revoked() and
-- private.mfa_satisfied() across the core financial tables but left the
-- secondary user-data tables on owner-only policies. A revoked or AAL1 token
-- could still read and write them through a direct PostgREST call, which is
-- the same hole the earlier migration closed for transactions and accounts.
--
-- Rather than restate ~120 policy bodies by hand (and risk dropping a
-- predicate in transcription), this rewrites each existing policy in place:
-- the recorded qual / with_check expression is preserved verbatim and the two
-- gates are ANDed onto it. Re-running is a no-op because a policy that already
-- mentions mfa_satisfied is skipped.
--
-- Deliberately NOT gated, because each is read or written *before* a session
-- can reach AAL2 and gating them would lock an MFA-enrolled user out of their
-- own step-up:
--   * public.profiles              - read during the auth/proxy bootstrap
--   * public.user_session_records  - the revocation ledger itself; the gate
--                                    would depend on the table it guards
--   * public.mfa_backup_codes      - redeemed to satisfy MFA in the first place
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
         -- `roles` is name[]; comparing with an untyped literal lets Postgres
         -- coerce it, where an explicit text[] would find no operator.
         and 'authenticated' = any(roles)
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
