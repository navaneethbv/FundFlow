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
    AND p.policyname IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS-enabled tables with zero policies: %', missing;
  END IF;
END $$;
