-- rls_auto_enable() is a Supabase-platform-managed event-trigger function
-- (created by the platform, not by this repository). Its body auto-enables RLS
-- on newly created tables. As a trigger function it fires internally when DDL
-- events occur, so the invoking user never needs EXECUTE, yet it currently
-- carries the Postgres default PUBLIC EXECUTE grant (plus anon/authenticated),
-- which is pure attack surface on a SECURITY DEFINER-style body. This follows
-- the L13 pattern from 20260810170000_harden_function_grants.sql.
--
-- Unlike that migration, this one is GUARDED on the function's existence:
-- rls_auto_enable() is not created by this repository, so it is absent from
-- the self-hosted docker-compose deployment and any fresh dev project. The
-- guard makes this a safe no-op there, while still locking down the live
-- project that does have the function.
--
-- Replacement grant: service_role only. Nothing in the app calls this function
-- directly (it is platform-owned), but service_role mirrors the trigger-function
-- precedent so any privileged path that legitimately needs it still works.
--
-- OPEN QUESTION: whether the Supabase platform re-grants PUBLIC on its own
-- reconcile. If it does, the durable fix is a platform-side setting rather than
-- this migration; revisit if scripts/check-rls.sql or the security advisor flags
-- it again after applying.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'rls_auto_enable'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role';
  END IF;
END $$;
