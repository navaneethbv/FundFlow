-- L13 (check-rls.sql hardening, priority #11): the two remaining SECURITY
-- DEFINER functions that still carried PUBLIC EXECUTE (the Postgres default)
-- are trigger functions. Trigger firing is internal — the invoking user never
-- needs EXECUTE on the function — so PUBLIC execute is pure attack surface on
-- a security-definer body. Revoke it from public/anon and grant it only to the
-- roles that legitimately touch the rows the triggers guard.
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
grant execute on function public.handle_new_user() to authenticated, service_role;

revoke all on function public.validate_transaction_split_total() from public;
revoke all on function public.validate_transaction_split_total() from anon;
grant execute on function public.validate_transaction_split_total() to authenticated, service_role;
