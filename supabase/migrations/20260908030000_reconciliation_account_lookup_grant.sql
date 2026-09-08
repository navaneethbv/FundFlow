-- The legacy insert policy looks up account ownership as the caller.
-- Explicit column grants also support fresh databases without dashboard defaults.
-- Existing account RLS continues to require ownership, MFA, and an active session.
grant select (id, user_id) on public.accounts to authenticated;
