-- Migration smoke-check (2.6): fails (returns rows) when any public table
-- lacks row level security. Run in CI against an ephemeral database with
-- all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-rls.sql
--
-- ADDING A USER-OWNED TABLE? This script needs no edit — it discovers every
-- public table automatically and fails when one has no RLS or no policy. The
-- three checklists that DO need attention live in the app:
--   app/api/export/takeout/route.ts   (does the user get this data back?)
--   app/api/cron/backup/route.ts      (is it worth protecting from loss?)
--   app/api/account/route.ts          (does deletion actually cascade to it?)
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(tablename, ', ') INTO missing
  FROM pg_tables
  WHERE schemaname = 'public'
    AND rowsecurity = false;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Tables without RLS: %', missing;
  END IF;
END $$;

-- Every RLS-enabled table must also have at least one policy (RLS with no
-- policies silently blocks everything — usually a migration mistake).
--
-- Exception list: tables where deny-all is the point, so no user-facing role
-- may read or write them at all and every access goes through the service key
-- or a security-definer function. Adding a policy to one of these would weaken
-- it, so they are acknowledged here instead. Add to this list only with a
-- comment saying which server-side path owns the table.
--
--   rate_limit_counters — written solely by the security-definer
--     public.rate_limit_hit() RPC and read by the service client (0002).
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t.tablename, ', ') INTO missing
  FROM pg_tables t
  LEFT JOIN pg_policies p
    ON p.schemaname = t.schemaname AND p.tablename = t.tablename
  WHERE t.schemaname = 'public'
    AND t.rowsecurity = true
    AND p.policyname IS NULL
    AND t.tablename <> ALL (ARRAY['rate_limit_counters']);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS-enabled tables with zero policies: %', missing;
  END IF;
END $$;

-- Every SELECT policy must be owner-scoped: its USING clause must reference
-- auth.uid(), a membership helper (public.is_household_member*), a
-- private.* security-definer helper, or delegate to another RLS-protected
-- public table via an EXISTS subquery (safe because every public table is
-- itself RLS-enabled, enforced above). A SELECT policy that references none
-- of these would hand rows to any role that reaches it.
--
-- This check intentionally rejects bare "user_id = some_column" patterns that
-- do not compare against the current auth.uid(), which is a permissive-
-- policy smell, and any policy whose USING was left as `true`.
DO $$
DECLARE
  suspect text;
BEGIN
  SELECT string_agg(format('%I.%I (%I)', p.schemaname, p.tablename, p.policyname), E'\n  ' ORDER BY 1)
    INTO suspect
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.cmd = 'SELECT'
    AND p.permissive = 'PERMISSIVE'
    AND NOT (
      p.qual ILIKE '%auth.uid()%'
      OR p.qual ILIKE '%is_household_member%'
      OR p.qual ILIKE '%private.%'
      OR p.qual ILIKE '%exists (%'
    );
  IF suspect IS NOT NULL THEN
    RAISE EXCEPTION 'SELECT policies with no owner scoping (check USING):%', suspect;
  END IF;
END $$;

-- SECURITY DEFINER functions are powerful: they run as their owner. One that
-- PUBLIC can still EXECUTE is a standing privilege-escalation surface even
-- when the body looks benign today, so flag every one of them. Trigger
-- functions are exempt from the requirement only in the sense that their
-- grants were locked down explicitly (see 20260810170000); the check itself
-- is unconditional.
DO $$
DECLARE
  risky text;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, p.proname), ', ' ORDER BY 1)
    INTO risky
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private')
    AND p.prosecdef
    AND (
      p.proacl IS NULL
      OR EXISTS (
        SELECT 1
        FROM unnest(p.proacl) acl
        WHERE acl LIKE '%=X/%' OR acl LIKE '%=U/%'
      )
    );
  IF risky IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER functions still executable by PUBLIC: %', risky;
  END IF;
END $$;

