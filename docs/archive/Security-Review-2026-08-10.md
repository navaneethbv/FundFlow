# FundFlow Supabase Security Review

Date: 2026-08-10
Status: Historical audit snapshot remediated by PR #110.

The findings below describe the database and application before the PR #110 fixes and are retained as audit evidence.
They are not an open action list.
All nine PR migrations are applied to the linked live Supabase project.
The remaining live-only `public.rls_auto_enable()` event-trigger grants are documented separately in `docs/HANDOFF.md` because that function is not created by this repository.

Overall posture: Strong. Every user-data table has RLS enabled with owner-scoped policies, no plaintext secrets are stored (Plaid tokens are AES-256-GCM; all bearer/capability tokens are SHA-256 hashes), all service-role writes I traced scope by user_id, and MFA/passkey/session-revocation logic is sound at the application layer. No CRITICAL cross-user data-leak was found. The findings below are hardening gaps and latent flaws, with the two most notable being (a) an exposed SECURITY DEFINER RPC reachable by unauthenticated users, and (b) the MFA/session-revocation guarantees living only in app code, not in the database.

1. RLS coverage and permissive policies
1.1 — MEDIUM — Transaction splits/refunds/annotations can be attached to another user's transaction
supabase/migrations/20260708040000_roadmap_completion.sql:150-160

The write policies check only user_id and never that the referenced transaction belongs to the caller (FKs bypass RLS):

create policy "transaction_splits_insert_own" on public.transaction_splits
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "linked_refunds_insert_own" on public.linked_refunds
  for insert to authenticated with check (user_id = (select auth.uid()));
This is exactly the gap the project itself closed elsewhere: goal_accounts_write_own (20260730200000_goals_v2.sql:65-79) and budget_periods_insert_owner (20260729210000_budget_groups.sql:47-58) both add exists(... user_id = auth.uid()) on the FK targets. Because transaction_splits_select_visible (20260729204345:22-33) and linked_refunds_select_visible (:40-58) make splits/refunds visible to anyone who can read the attached transaction, a household member of a shared connection can attach foreign splits to the owner's transactions, polluting the shared totals; worse, validate_transaction_split_total (20260708040000:89-118, a SECURITY DEFINER constraint trigger) will then raise on the owner's next legitimate split edit, a cross-user DoS. Recommendation: add exists (select 1 from public.transactions t where t.id = ... and t.user_id = auth.uid()) to the insert/update with-check of transaction_splits, linked_refunds, and transaction_annotations, matching the goal_accounts/budget_periods pattern.

1.2 — INFO — goal_accounts_select_shared_goal / goal_progress_events_select_shared_goal rely on nested RLS in subqueries
supabase/migrations/20260730200000_goals_v2.sql:86-95, 140-149

create policy "goal_accounts_select_shared_goal" on public.goal_accounts
  for select to authenticated
  using (
    exists (select 1 from public.goals g
            where g.id = goal_accounts.goal_id and g.household_id is not null)
  );
This is correct today: RLS is applied to the subquery, so a non-member matches nothing. But it silently depends on the goals RLS policies staying present and correct; a future migration that "simplifies" goals RLS turns this into a leak without any error. Recommendation: route the check through the same private. schema SECURITY DEFINER boolean pattern used for accounts/streams, or add a code comment warning against weakening goals RLS.

1.3 — LOW — shared_expenses insert/update do not verify owed_user_id belongs to the household
supabase/migrations/20260723150000_bucket_features.sql:69-78

create policy "shared_expenses_insert_payer" on public.shared_expenses
  for insert with check (
    paid_by = (select auth.uid()) and public.is_household_member(household_id)
  );
create policy "shared_expenses_update_parties" on public.shared_expenses
  for update using ((select auth.uid()) in (paid_by, owed_user_id))
  with check ((select auth.uid()) in (paid_by, owed_user_id));
A payer can name an arbitrary owed_user_id (any UUID, household member or not), and an update by either party can re-point owed_user_id at a non-member (the with-check only requires the caller be one of the two parties, not that either party is a member). No data is exfiltrated (read still requires membership) but debts can be minted/settled against people who can neither see nor contest them. Recommendation: add owed_user_id in (select user_id from household_members where household_id = ...) (or is_household_member for both parties) to the insert and update checks.

1.4 — LOW — budgets/goals household_id is settable to an arbitrary household on client writes
supabase/migrations/0001_init.sql:279-282, 0004_goals.sql:32-33

create policy "budgets_insert_own" on public.budgets
  for insert with check (user_id = (select auth.uid()));
Insert/update with-check only pins user_id, so a user can point their own row at any household_id they like. It is not a read leak (visibility still requires is_household_member), but it lets a user inject budget/goal rows into a household's shared view for members they know the id of, and lets the row owner flip household_id back and forth to change who sees a shared row. Recommendation: constrain household_id to households where is_household_member(household_id) is true in the with-check.

1.5 — INFO — RLS coverage itself is complete
All 54 create table statements across the migrations are followed by enable row level security, and every table has at least one policy. scripts/check-rls.sql:16-51 enforces this. No user-data table is left open. The only deny-all-by-design table is rate_limit_counters (see 2.1).

2. Service-role usage and SECURITY DEFINER functions
2.1 — MEDIUM — rate_limit_hit() is SECURITY DEFINER, in the public schema, and callable by anon
supabase/migrations/0002_rate_limit.sql:14-46

create or replace function public.rate_limit_hit(
  p_key text, p_max int, p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
  insert into public.rate_limit_counters ...
  on conflict (key) do update ...
$$
There is no revoke execute ... from public, anon anywhere in the migrations (verified by grep). Default privileges mean PUBLIC has EXECUTE, and PostgREST exposes any public-schema function with arguments as an RPC. Consequences for an unauthenticated caller:

Insert an unbounded number of rows into rate_limit_counters (each novel p_key is an insert) — a cheap, unlimited storage/CPU DoS with no auth.
Pre-warm a victim's counter to exhaust their window (keys are prefix:${user.id}, lib/rate-limit.ts, so this needs the victim's UUID, but the abuse surface for other keys is real).
Recommendation: revoke all on function public.rate_limit_hit(text,int,int) from public, anon; grant execute ... to authenticated, service_role; (and consider limiting it further, since lib/rate-limit.ts already calls it via the service client).

2.2 — LOW — is_household_member() is SECURITY DEFINER and left PUBLIC-executable
supabase/migrations/20260723150000_bucket_features.sql:10-24

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
Same gap as 2.1: no revoke, so it is an exposed RPC. It only returns a boolean about the caller's own membership (for anon, auth.uid() is null, so it always returns false), so there is no data leak — but it is an unnecessary public SECURITY DEFINER surface that also runs under elevated privilege for the authenticated role. Recommendation: move to the private schema (the pattern already used for can_read_shared_account/can_read_shared_stream), or at minimum revoke execute from public, anon.

2.3 — MEDIUM — set_goal_allocation and rename_user_tag run SECURITY DEFINER with pg_temp in search_path
supabase/migrations/20260730200000_goals_v2.sql:186 and 20260730250000_profile_and_tags.sql:77

set search_path = public, pg_temp
Including pg_temp in a SECURITY DEFINER function's search path is a known privilege-escalation anti-pattern (CVE-2018-1058 class): a caller can shadow built-ins like greatest()/array_agg()/sum() with temp-schema objects that then execute with the definer's privileges. Both functions are granted EXECUTE to authenticated (so the attack surface is real), even though the modern, safe pattern (set search_path = '') is already used by every private.* helper in this codebase. Recommendation: change both to set search_path = '' (or a locked schema) and schema-qualify every object referenced in the body.

2.4 — INFO — private.confirm/undo_transaction_duplicate trust a caller-supplied p_user_id
supabase/migrations/20260809194242_linked_transaction_duplicates.sql:31-120, 129-163

Both functions take p_user_id as an argument and are SECURITY DEFINER. They are safe today only because EXECUTE is revoked from public/anon/authenticated and granted solely to service_role (lines 122-127, 158-163), and the calling route (app/api/transactions/duplicates/route.ts:148-165) verifies transaction ownership first. This is a footgun: if anyone ever widens the grant, the p_user_id becomes attacker-controlled. Recommendation: keep the grant service-role-only, and add a comment warning that widening the grant requires dropping the parameter and deriving the user from auth.uid().

2.5 — INFO — handle_new_user and validate_transaction_split_total are SECURITY DEFINER with set search_path = public
0001_init.sql:41-56, 92-93 and 20260708040000:92-93. Both are trigger functions (not RPC-exposed) and reference schema-qualified tables, so this is benign today; validate_transaction_split_total does read transactions by id without an owner check, but as a trigger it cannot be invoked directly. Recommendation (optional): normalize to set search_path = '' for consistency and future-proofing.

3. auth schema and MFA/session enforcement depth
3.1 — MEDIUM — MFA (AAL2) is enforced only in application code, never in RLS
lib/http.ts:51-60 and proxy.ts:121-129 gate APIs and pages on auth.mfa.getAuthenticatorAssuranceLevel(), and the logic in lib/mfa.ts:10-15 is correct. But no RLS policy anywhere references auth.jwt()->>'aal' and no migration sets Supabase's project-level "Enforce MFA" setting. If that dashboard toggle is off, a user who extracts their AAL1 (password-only) access token can call the Supabase Data API directly — bypassing requireUser/proxy entirely — and read/write all their rows, because RLS only checks auth.uid(). Recommendation: enable Supabase's MFA enforcement at the project level (or add a request.jwt.claims->>'aal' = 'aal2' clause to the RLS policies of sensitive tables), so the guarantee survives direct PostgREST access.

3.2 — MEDIUM — Session revocation is app-layer only; revoked tokens/refresh tokens remain valid at the data API
lib/session-revocation.ts:11-32, proxy.ts:139-145, app/api/settings/sessions/route.ts:48-53, lib/session-token.ts:7-20

Revocation works by storing revoked_at in user_session_records and checking it on the next app request. Nothing references user_session_records from an RLS policy, proxy.ts signs out only { scope: "local" } (cookies cleared, refresh token never invalidated server-side), and Supabase's own auth.admin session deletion is never called. Consequences: a revoked access token keeps working against the Supabase Data API directly until JWT expiry (RLS does not consult revoked_at), and the session's refresh token can keep minting fresh access tokens indefinitely (the app would still block the same session_id, but only on its own routes). Recommendation: on revoke, also call supabase.auth.admin session deletion (or store revoked session ids in a table and check them in RLS / reject them in the JWT hook), and shorten access-token TTL.

3.3 — INFO — auth.users is touched only by the standard trigger, with no excessive grants
0001_init.sql:27-56 creates handle_new_user() (SECURITY DEFINER, set search_path = public) and a trigger on auth.users. No migration grants privileges on auth schema objects to authenticated/anon. This is the canonical, safe pattern.

4. API token generation, storage, and validation (lib/api-tokens.ts)
This is implemented correctly:

Generation (app/api/tokens/route.ts:24): fft_ + randomBytes(32) base64url → 256 bits of entropy, rate-limited (5/day) and audited.
Storage (lib/api-tokens.ts:25-27): only a SHA-256 hex digest is stored; the plaintext appears once at mint time and is returned to the caller exactly once.
Validation (lib/api-tokens.ts:33-56): server-side hash lookup via the service client, scoped to revoked_at is null, with a best-effort last_used_at stamp that never blocks. The SHA-256-without-KDF choice is defensible and documented (high-entropy token, not a user password).
4.1 — INFO — Comparison is a DB = on a hash, not constant-time
lib/api-tokens.ts:44. Postgres text equality on the stored hash is not constant-time, but timing attacks against a 256-bit random token are not practical, so this is a non-issue in practice. Same reasoning applies to app/api/calendar/[token]/route.ts:34-42 and app/api/household/accept/route.ts:27-34. Recommendation: none required; a note is sufficient.

4.2 — INFO — Tokens never expire, only revoke
api_tokens has no expires_at (unlike household_invites). Revocation is manual. Acceptable given the read-only scope, but worth a product decision.

5. MFA and passkeys (lib/mfa.ts, lib/passkeys.ts)
5.1 — INFO — MFA decision logic is correct; enforcement is app-layer (see 3.1)
needsMfaStepUp (lib/mfa.ts:14) is the exact nextLevel === "aal2" && currentLevel !== "aal2" check, applied consistently in requireUser, proxy, and the login form.

5.2 — INFO — Passkey feature is a thin, correct gate; backup codes cleanly removed
lib/passkeys.ts only computes client-side availability (browser support + allowlisted hosts localhost / fund-flow-swart.vercel.app); registration/verification is delegated to Supabase Auth (lib/supabase/client.ts:12, experimental.passkey). The mfa_backup_codes table was removed in 20260809195308_remove_mfa_backup_codes.sql (policies dropped, table dropped), which is consistent. Note: tests/integration/roadmap-rls.test.ts and tests/unit/roadmap-schema-completion.test.ts still reference mfa_backup_codes and will fail against the current migration set. Recommendation: update those tests to match the dropped table.

6. Plaintext secrets and cascades
6.1 — No plaintext secrets found — PASS
Plaid access tokens: AES-256-GCM, per-field ciphertext/iv/tag, with documented key rotation (lib/crypto.ts, lib/plaid-service.ts:15-54). Plaintext never persisted or returned.
api_tokens, calendar_tokens, household_invites: SHA-256 hashes only.
push_subscriptions.p256dh/auth are stored plaintext, but they are the client's VAPID keys — that is standard and required for web-push.
No env secrets are written into any table.
6.2 — Cascades are comprehensive — PASS
Verified every FK: audit_logs.user_id → set null (intentional retention); goal_progress_events.transaction_id and receipts.transaction_id → set null; all other user-data FKs → on delete cascade. The one hardcoded-text table transaction_review_decisions.subject_id (no FK) can leave orphan decisions after transaction deletion — harmless, INFO.

6.3 — LOW — Takeout route queries nonexistent goals columns
app/api/export/takeout/route.ts:30

supabase.from("goals").select("name, target_amount, current_amount, target_date, status")...
goals has saved_amount, not current_amount, and has no status column (0004_goals.sql, 20260730200000_goals_v2.sql). PostgREST will reject this select with a 400, so the data-takeout endpoint (a GDPR-style export) is broken for every user. Recommendation: fix the column list to name, target_amount, saved_amount, target_date, goal_type.

6.4 — INFO — Storage buckets are correctly locked down
receipts (private) uses server-side signed URLs only; the client-facing storage.objects policy was intentionally dropped in 20260809192302_secure_receipts_server_writes.sql:10 and all receipt writes/reads go through the service client (app/api/receipts/route.ts:78-84, lib/receipt-data.ts:115-124). avatars keeps a correctly user-prefixed for all policy (20260730250000:48-57). No cross-user storage path found.

7. scripts/check-rls.sql coverage
7.1 — MEDIUM — The script only checks "RLS is on" and "≥1 policy exists"; it cannot catch the real failure classes
scripts/check-rls.sql validates exactly two things: every public table has rowsecurity = true (:16-23), and every RLS table has at least one policy except the hardcoded rate_limit_counters exception (:36-51). It does not detect: permissive policies that leak (policies lacking an auth.uid() predicate), table-level grants to anon, exposed SECURITY DEFINER functions, missing owner checks in with-checks (e.g. finding 1.1), the private schema, storage.objects, or functions. The exception list is also a single hardcoded table; any future deny-all table breaks CI without a deliberate edit. Recommendation: extend it (or add a companion audit query) to flag SELECT policies whose USING clause references no auth.uid()/is_household_member/private.* helper, and to enumerate functions with prosecdef that still carry PUBLIC EXECUTE.

8. Migration ordering and idempotency
8.1 — INFO — Duplicate index creation
20260730014500_budget_household_index.sql:3-4 re-creates budgets_household_id_idx that 20260729210000_budget_groups.sql:7-8 already created. Both are create index if not exists, so it is harmless — just noise.

8.2 — INFO — Re-created functions are idempotent
update_budget_period is defined twice (20260729210000:95, 20260730015000:3) via create or replace; all drop policy if exists / create policy pairs are ordered correctly. The housekeeping of mfa_backup_codes (create in 20260708040000, drop in 20260809195308) is intentional. No ordering violation was found; filename ordering (0001-0004 then timestamps) sorts correctly.

8.3 — INFO — Older tables rely on Supabase default privileges rather than explicit grants
0001_init.sql and 0004_goals.sql create tables and RLS policies but issue no grant/revoke statements (the newer migrations all do, e.g. 20260707012910:172-183, 20260729210000:30-31). This works on hosted Supabase because default privileges grant anon/authenticated on new public tables — and RLS then blocks anon. But it silently breaks on a self-hosted stack (docker-compose.selfhost.yml exists) if default privileges aren't configured, and there is no revoke all from anon on those tables to make the intent explicit. Recommendation: add explicit grant ... to authenticated + revoke all from anon on the 0001/0004 tables for parity and self-host safety.

## Original highest-priority fixes, completed by PR #110

- Completed: revoke `PUBLIC` execution of `rate_limit_hit` (2.1).
- Completed: remove anonymous access to `is_household_member` (2.2).
- Completed: add foreign-key ownership checks to transaction metadata policies and remove `pg_temp` from the two security-definer RPC search paths (1.1, 2.3).
- Completed: enforce MFA and session revocation in sensitive RLS policies and revoke sessions server-side (3.1, 3.2).
- Completed: fix the takeout goals selection and remove obsolete `mfa_backup_codes` test assumptions (6.3, 5.2).
