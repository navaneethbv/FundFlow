# FundFlow Code Review

Date: 2026-08-10
Scope: Full repository audit (app/, lib/, components/, supabase/migrations/, scripts/, tests/, config).
Method: Manual review of all 60 API route handlers, Plaid integration, all 36 SQL migrations, RLS policies, crypto/env handling, export/takeout/calendar/push/backup code, plus `npm audit`, `tsc --noEmit`, `eslint`, and the Vitest suite.

## Summary

| Severity | Count | Notes |
|---|---|---|
| CRITICAL | 0 | No cross-user data leak or full compromise found |
| HIGH | 5 | Webhook auth, unbounded import, account deletion, anon-accessible SECURITY DEFINER, dependency CVE |
| MEDIUM | 15 | Rate-limit gaps, token binding, concurrency, RLS with-check gaps, backup gaps, SSRF |
| LOW | 12 | Escaping, opt-out inconsistency, UID collisions, cursor races |
| INFO | 12 | Hardening notes, test issues |

Overall the codebase is in strong shape. The auth model is sound: every route goes through `requireUser()` (`lib/http.ts:41`) with MFA step-up and session revocation, the service client is almost always scoped by `user_id`, secrets are encrypted at rest (AES-256-GCM) or SHA-256 hashed, and RLS is enabled on every user-data table. No CRITICAL issue was found. The findings below are the highest-value hardening items.

---

## HIGH severity

### H1. Plaid webhook verification is fail-open in the default configuration
`app/api/plaid/webhook/route.ts:40-44`
```ts
const plaidEnv = process.env.PLAID_ENV ?? "sandbox";
if (plaidEnv === "sandbox" || process.env.NODE_ENV === "test") {
  return true;
}
```
`lib/env.server.ts:37` and `.env.example:20` default `PLAID_ENV` to `sandbox`, so any deployment that does not explicitly set `PLAID_ENV=production` skips the JWS signature check entirely and lets anyone on the internet POST to `/api/plaid/webhook`. Once past the check, an attacker who knows a Plaid `item_id` can trigger transaction syncs (burning Plaid quota) and flip any item into `error`/`disconnected`/`USER_PERMISSION_REVOKED` state (`route.ts:135-151`), a DoS against a victim's bank connection. The signature logic itself (ES256 pinned, body hash, 5-minute replay window) is correct.

Recommendation: fail closed. Skip verification only when `NODE_ENV !== "production"` AND `PLAID_ENV === "sandbox"`, and never treat an unset `PLAID_ENV` as a trust-everything mode. Confirm the production env explicitly sets `PLAID_ENV=production`.

### H2. `/api/import/preview` has no size limit, no row cap, and no rate limit
`app/api/import/preview/route.ts:14-30, 90-104`

The route reads the whole uploaded file into memory (`file.text()`), parses it with no bound, and writes an unbounded number of `import_review_rows` per call. Contrast with the sibling `/api/import/csv` which caps at 2 MB, 20k rows, and 5 requests/hour. An authenticated user can exhaust server memory and grow the database with junk batches at will.

Recommendation: apply the same 2 MB / 20k-row caps and a `checkRateLimit("import:${user.id}")` used by `/import/csv`.

### H3. `/api/account` DELETE destroys the entire account with no step-up or rate limit
`app/api/account/route.ts:21-55`

A single `DELETE /api/account` with a valid session permanently deletes the auth user and cascades every account, transaction, receipt, budget, goal, token, and Plaid connection. There is no password/MFA re-prompt, no confirmation token, and no rate limiter. A stolen session becomes permanent data loss.

Recommendation: require a fresh step-up (password or TOTP) plus a rate limit, and consider a soft-delete grace period.

### H4. `rate_limit_hit` is a PUBLIC-executable SECURITY DEFINER function
`supabase/migrations/0002_rate_limit.sql:14-46`

```sql
create or replace function public.rate_limit_hit(p_key text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public ...
```
There is no `revoke execute ... from public, anon` anywhere in the migrations. PostgREST exposes public-schema functions as RPC endpoints, so an unauthenticated caller can insert an unbounded number of rows into `rate_limit_counters` (a cheap, unlimited storage/CPU DoS) and pre-warm a victim's counter to exhaust their rate-limit window.

Recommendation: `revoke all on function public.rate_limit_hit(text,int,int) from public, anon; grant execute ... to authenticated, service_role;`.

### H5. High-severity vulnerabilities in transitive `sharp` dependency
`npm audit` reports 2 HIGH vulnerabilities (CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591) in libvips via `sharp`, which is bundled with Next.js 16.2.x. The fix requires upgrading Next.js to 16.3.0.

Recommendation: plan a Next.js 16.3.0 upgrade. Verify the pdfkit `outputFileTracingIncludes` config and the Next.js 16 breaking-change notes in `node_modules/next/dist/docs/` before upgrading (see AGENTS.md).

---

## MEDIUM severity

### Security

#### M1. Plaid exchange never verifies the public token belongs to the user
`app/api/plaid/exchange/route.ts:44-48`

The link token was created with `client_user_id: user.id` (`link-token/route.ts:37`) but no binding is persisted or verified at exchange time. Anyone holding a victim's single-use ~30-minute public token can exchange it into their own account, attaching the victim's bank data to the attacker's profile.

Recommendation: persist the link token (or a hashed binding to `client_user_id`) at creation and verify it during exchange, per Plaid's guidance.

#### M2. No Plaid access-token rotation or invalidation
The app rotates the encryption key but never calls `itemAccessTokenInvalidate`/`itemAccessTokenUpdate`. A stolen access token stays valid indefinitely. Update-mode reconnect correctly keeps the same token, but periodic rotation is missing for long-lived items.

Recommendation: add periodic access-token rotation and rotate immediately after any suspected compromise.

#### M3. Push subscribe accepts arbitrary endpoint (SSRF)
`app/api/push/subscribe/route.ts:11-27` accepts any `endpoint` string and stores it; `lib/push.ts:38-47` later POSTs to it. web-push does not require an https endpoint, so an authenticated user can point a subscription at an internal TLS-speaking host and cause the server to make outbound connections to attacker-chosen hosts when a notification fires.

Recommendation: validate `endpoint` against an allowlist (`fcm.googleapis.com`, `android.googleapis.com`, https-only) or verify ownership with a test message before persisting.

#### M4. Session revocation and MFA are enforced only at the app layer, not in the database
`lib/session-revocation.ts:11-32`, `lib/http.ts:51-60`, `proxy.ts:121-145`

RLS checks only `auth.uid()`. Nothing references `auth.jwt()->>'aal'`, no project-level MFA enforcement is set, and no policy consults `revoked_at`. A user who extracts their AAL1 access token (or a revoked session's refresh token) can call the Supabase Data API directly and bypass `requireUser`/`proxy` entirely, reading and writing all their rows. Revocation signs out `{ scope: "local" }` and never calls `supabase.auth.admin` session deletion, so the refresh token keeps minting fresh access tokens.

Recommendation: enable Supabase project-level MFA enforcement (or add an `aal = 'aal2'` clause to sensitive RLS policies), and call the admin session deletion on revoke or reject revoked session ids in RLS.

#### M5. `/api/settings/passkeys` is a no-op that reports success
`app/api/settings/passkeys/route.ts:7-24`

The route validates the action, writes an audit row, and returns `{ success: true }` without ever performing a WebAuthn/Supabase passkey operation. A user who clicks "delete passkey" is told it was removed when it was not, and the passkey remains a live sign-in method.

Recommendation: implement the real passkey operation or return `501` and disable the UI.

#### M6. Share route picks an arbitrary household
`app/api/plaid/share/route.ts:39-48` does `households.select("id").limit(1)` with no ordering. For a user in multiple households this shares financial data with an arbitrary one.

Recommendation: require the client to pass an explicit `household_id`, verified as a member.

#### M7. Takeout and backup omit many user-owned tables
`app/api/export/takeout/route.ts:26-52` and `app/api/cron/backup/route.ts:58-118` omit `transaction_splits`, `transaction_annotations`, `linked_refunds`, `linked_duplicates`, `receipts`, `user_tags`, `sinking_funds`, `recurring_streams`/transactions, `milestones`, `goal_accounts`/`goal_progress_events`, `advice_progress`, `category_overrides`, `shared_expenses`, `net_worth_snapshots`, `households`. A data-takeout ("right to data portability") that silently drops user-entered categorization, splits, refund links, and receipts is incomplete, and restoring a backup loses that same work.

Recommendation: extend both lists to cover every non-re-syncable user-owned table.

#### M8. RLS write policies for splits/refunds/annotations do not verify transaction ownership
`supabase/migrations/20260708040000_roadmap_completion.sql:150-160`

`transaction_splits_insert_own` and `linked_refunds_insert_own` check only `user_id`, never that the referenced transaction belongs to the caller (FKs bypass RLS). A household member of a shared connection can attach foreign splits/refunds to the owner's transactions, polluting shared totals, and `validate_transaction_split_total` (a SECURITY DEFINER constraint trigger) can then DoS the owner's legitimate edits. The project already fixed this pattern for `goal_accounts` and `budget_periods`.

Recommendation: add `exists (select 1 from public.transactions t where t.id = ... and t.user_id = auth.uid())` to the with-check of `transaction_splits`, `linked_refunds`, and `transaction_annotations`.

#### M9. Two SECURITY DEFINER RPCs put `pg_temp` in their search path
`supabase/migrations/20260730200000_goals_v2.sql:186` (`set_goal_allocation`) and `20260730250000_profile_and_tags.sql:77` (`rename_user_tag`) use `set search_path = public, pg_temp`, the CVE-2018-1058 privilege-escalation pattern. Both are granted EXECUTE to `authenticated`. The codebase already uses the safe `set search_path = ''` pattern in its `private.*` helpers.

Recommendation: change both to `set search_path = ''` and schema-qualify every object referenced in the bodies.

#### M10. `is_household_member` is SECURITY DEFINER in the public schema
`supabase/migrations/20260723150000_bucket_features.sql:10-24`. No revoke, so it is an exposed RPC running under elevated privilege. It leaks no data today (for `anon`, `auth.uid()` is null), but it is an unnecessary public SECURITY DEFINER surface.

Recommendation: move it to the `private` schema or revoke execute from `public`/`anon`.

#### M11. Encrypted Plaid token columns are browser-readable via RLS
`supabase/migrations/0001_init.sql:261-262` grants the browser client full-row select on `plaid_items`, including `access_token_ciphertext`/`iv`/`tag`. The data is ciphertext and the key is server-only, so this is not exploitable, but it is unnecessary surface area.

Recommendation: expose a column-restricted view (or column-level GRANT) so token ciphertext never leaves the server.

#### M12. CSRF origin check trusts a client-spoofable header
`proxy.ts:75-76` with `lib/origin.ts:9-19` derives the expected host from `x-forwarded-host` falling back to `host`. On self-hosted/reverse-proxy setups that pass client-supplied `x-forwarded-host` through, an attacker can match the Origin and bypass the CSRF gate. Vercel overwrites it, so Vercel is safe; self-hosting is not.

Recommendation: derive the expected host only from the `Host` header or a platform-managed header, and validate Origin against an explicit allowlist.

### Correctness / reliability

#### M13. No per-item synchronization; overlapping syncs can regress the cursor
`lib/sync.ts:72-86, 176`

Four triggers can sync the same item concurrently (manual sync, auto-refresh, webhook, daily cron, plus the initial exchange sync). There is no advisory lock or in-progress guard. Consequences: duplicate Plaid API spend, multiple `sync_jobs` rows stuck at `running` (false "stuck job" alerts), duplicate notifications (the `createNotification` dedup is a read-then-insert TOCTOU), and cursor regression when a slow run started from an old cursor finishes last.

Recommendation: serialize per item with `pg_advisory_xact_lock(hashtext(item_id))` or a `syncing_at` guard, and only persist the cursor if it still equals the cursor the run started with.

#### M14. Holdings upsert conflict target does not match the partial unique index
`lib/investment-sync.ts:147-149` upserts `holdings` with `onConflict: "account_id,security_id"`, but the only matching unique index is partial (`where source = 'plaid'`, `20260730210000_investments.sql:97-99`). PostgreSQL cannot infer a partial index without the predicate, so this errors on every holdings sync once `investmentsPage` is enabled.

Recommendation: add a full unique index `(account_id, security_id, source)` and use `onConflict: "account_id,security_id,source"`.

#### M15. Takeout route queries nonexistent `goals` columns
`app/api/export/takeout/route.ts:30` selects `current_amount, status` from `goals`, but the table has `saved_amount` and no `status` column (`0004_goals.sql:10-19`). PostgREST rejects the select with a 400, so the GDPR-style data-takeout endpoint is broken for every user.

Recommendation: fix the select to `name, target_amount, saved_amount, target_date, goal_type`.

---

## LOW severity

1. iCal TEXT escaping misses newlines. `lib/ical.ts:52-57` escapes only `\ ; ,`. A raw newline in a merchant name terminates the `SUMMARY:` line and could inject synthetic iCal properties (RFC 5545 requires CRLF encoded as `\n`). Also add `:` escaping and include the stream id in the VEVENT UID (`lib/ical.ts:104`) to avoid collisions between same-named streams.

2. Export opt-out (`ai_export_enabled`) is enforced on CSV/JSON/report-csv but not on accounts-csv, investments-csv, or the on-demand PDF (`app/api/export/accounts-csv/route.ts:58`, `investments-csv/route.ts:9`, `report/route.ts:19`). The data goes to the user themselves, so this is a consent-consistency gap, but it should be applied uniformly.

3. `latestAccounts` is overwritten on every sync page (`lib/sync.ts:70,82`). Plaid omits `accounts` on later pages, so a multi-page sync can finish with an empty array and balances silently stop refreshing. Assign only when `data.accounts` is non-empty.

4. `getClientIp` trusts `x-forwarded-for` (`lib/audit.ts:115-119`), so anyone can forge the IP recorded in `audit_logs`, weakening forensics. Read the IP only from a platform-trusted header.

5. `transactions/refunds` links `charge_id`/`refund_id` without verifying they belong to the caller (`app/api/transactions/refunds/route.ts:105-121`). Reads are user-scoped so no data leaks, but the foreign-key integrity of netting logic is untrusted.

6. Holding snapshots pair values to ids by array index (`lib/investment-sync.ts:157-164`). Postgres does not guarantee RETURNING order, so a snapshot's quantity/price/value can be written against the wrong holding. Key snapshots by a stable per-row reference.

7. Several delete/revoke queries omit `user_id` and rely on RLS alone (`push/subscribe:45-48`, `calendar/token:56-59`, `tokens:54-57`, `subscriptions/cancelled:40-43`, `settings/sessions:12-18`). Safe today because RLS is owner-scoped; add explicit `.eq("user_id", user.id)` for defense-in-depth.

8. Reconnect finalizes without confirming the re-link succeeded (`app/api/plaid/reconnect/route.ts:40-66`). It sets status active without calling `/item/get`; combined with resume state in localStorage, a stale/forged `item_id` can flip an item active without a real re-link.

9. Backup uses a single global `BACKUP_ENC_KEY` with no rotation or re-encryption path (`lib/env.server.ts:65-67`, `app/api/cron/backup/route.ts:156-175`). Unlike `PLAID_TOKEN_ENC_KEY` it has no `_PREVIOUS` rotation story. If it leaks, every user's archives become readable. Derive a per-user key (HKDF from global key + user id) or add a documented rotation run.

10. Calendar feed tokens are long-lived with no expiry or rotation (`20260723100000_phase_features.sql:41-48`), and feed reads are not rate-limited or audited (`app/api/calendar/[token]/route.ts`). Add an `expires_at` and a rotate flow.

11. `/api/import/preview` and `transactions/refunds` also have no rate limit, and Plaid-cost routes (`link-token`, `reconnect`, `disconnect`) are unbounded (each call bills Plaid). Add `checkRateLimit` to these.

12. Duplicate index creation across migrations (`20260729210000_budget_groups.sql:7-8` and `20260730014500_budget_household_index.sql:3-4` both create `budgets_household_id_idx`). Harmless (`if not exists`), just noise.

---

## INFO / hardening notes

- `.env.local` is gitignored; real secrets are not committed. Keep it that way.
- API tokens are well implemented: 256-bit random, SHA-256 stored, revocable, read-only, rate-limited at mint. They intentionally bypass MFA step-up on export routes (`lib/api-tokens.ts`).
- CSV formula injection is neutralized (`lib/csv.ts:9-11`).
- PDF generation is not injectable (pdfkit renders plain text only), card masks are stripped, and email HTML is escaped. SMTP fails closed in production.
- Cron routes authenticate with a constant-time `safeEqual` comparison of the CRON_SECRET and are correctly fail-closed. The webhook signature logic itself is correct; only the fail-open default is the problem.
- `auth/callback` is not an open redirect.
- `scripts/check-rls.sql` only checks "RLS on + at least one policy". It cannot detect permissive policies, missing owner with-checks, exposed SECURITY DEFINER functions, or `anon` grants. Extend it to flag SELECT policies whose USING clause references no `auth.uid()`/`is_household_member`/`private.*` helper and functions with `prosecdef` that still carry PUBLIC EXECUTE.
- Older migrations (`0001_init.sql`, `0004_goals.sql`) rely on Supabase default privileges and issue no explicit grants; self-hosted deployments (there is a `docker-compose.selfhost.yml`) silently break unless default privileges are configured. Add explicit `grant`/`revoke` for parity.
- `requireUser` performs a DB write (session upsert) plus `getUser()` and an AAL call on every authenticated request (`lib/http.ts:75-87`). Write amplification across all API traffic; consider caching or skipping when nothing changed.
- Webhook malformed bodies return 500 and are retried indefinitely; return 400 for unparseable bodies. Also skip non-`active` items in the webhook sync path, and return 200 on `ITEM_LOGIN_REQUIRED` so Plaid stops redelivering.
- Investment-transaction pagination breaks if `total_investment_transactions` is ever missing; break on `page.length < count` as a fallback.
- `shared_expenses` insert/update does not verify `owed_user_id` belongs to the household (`20260723150000_bucket_features.sql:69-78`). Debts can be minted against non-members. Add `is_household_member` for both parties.
- `budgets`/`goals` `household_id` is settable to an arbitrary household on client writes. Constrain it to households where `is_household_member(household_id)`.
- Feed events are anchored to the 15th of the month regardless of the bill's actual next due date (`app/api/calendar/[token]/route.ts:54`). Use `predicted_next_date`/`first_date` when present.
- `investments-csv` exports household-shared holdings with no "mine only" scope option, unlike `accounts-csv`.
- `/api/health` discloses internal sync staleness unauthenticated; acceptable for uptime monitors.
- 60s `maxDuration` on the per-user backup loop can time out mid-loop on a large tenant and silently drop users with no alert. Chunk it or move to a queue.

---

## Testing / CI status (as of 2026-08-10)

- `tsc --noEmit`: passes clean.
- `eslint`: passes clean.
- Vitest: 2275 of 2276 tests pass. One integration test fails: `tests/integration/api-routes.test.ts` > `/api/cron/sync` > "runs successfully..." times out at 30s. This test hits a real cron route and is likely environment-dependent/flaky; investigate whether it should mock the sync or receive a longer timeout.
- Two tests reference the dropped `mfa_backup_codes` table:
  - `tests/unit/roadmap-schema-completion.test.ts:33` checks the drop migration exists (passes today).
  - `tests/integration/roadmap-rls.test.ts:59` runs `admin.from("mfa_backup_codes").select("id")` against a live DB; verify it still passes once the table is dropped, or update it.
- `npm audit`: 2 HIGH severity via `sharp` (transitive of Next.js 16.2.x); fix requires Next.js 16.3.0.
- Plaid test environment: `.env.local` has `PLAID_ENV=sandbox`. Combined with H1, confirm production explicitly sets `PLAID_ENV=production`.

---

## Priority action list

1. Fix the Plaid webhook fail-open default (H1) and confirm `PLAID_ENV=production` in production.
2. Revoke PUBLIC execute on `rate_limit_hit` and move `is_household_member` out of the public RPC surface (H4, M10).
3. Add size/row/rate limits to `/api/import/preview` (H2) and step-up auth to account deletion (H3).
4. Fix the takeout `goals` select (M15) and complete takeout/backup table coverage (M7).
5. Serialize per-item syncs and fix the holdings upsert conflict target (M13, M14).
6. Bind Plaid exchange to the link token, add token rotation (M1, M2).
7. Validate push endpoints against an allowlist (M3).
8. Add FK-ownership checks to splits/refunds/annotations write policies and remove `pg_temp` from SECURITY DEFINER search paths (M8, M9).
9. Enable MFA enforcement at the project level and revoke sessions server-side (M4).
10. Upgrade Next.js to 16.3.0 for the sharp/libvips CVEs (H5).
11. Extend `scripts/check-rls.sql` to catch the policy classes it currently misses.

---

## What's done well

- Env handling is exemplary: `server-only` guards, lazy validation, fail-closed required vars, `.env.local` gitignored.
- Crypto is correctly implemented: AES-256-GCM with per-secret random IVs, auth tags, documented key rotation, constant-time secret comparison.
- Auth is defense-in-depth: every route requires the user, enforces MFA step-up and session revocation, and error responses hide internals in production.
- RLS is enabled on every user-data table and the service client is almost universally `user_id`-scoped.
- CSV injection, email header injection, PDF injection, and cross-user push are all handled.
- Tests are extensive (2276 tests) and lint/typecheck are clean.
