-- Migration smoke-check (2.6): fails (returns rows) when any public table
-- lacks row level security. Run in CI against an ephemeral database with
-- all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-rls.sql
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
