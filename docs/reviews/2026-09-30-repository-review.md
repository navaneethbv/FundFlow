# Repository review, 2026-09-30

Reviewed branch `fix/security-ui-memory` at `b86d84b` (clean tree).
This is a focused source review of auth, rate limiting, Plaid sync, notifications, cron, caching, date handling, tokens, and documentation, plus a run of the local gates.
Previously recorded findings in `docs/TODO.md` and `docs/reviews/` are not repeated unless their status changed.
Nothing here was exercised against a live Supabase project, Plaid, SMTP, or a signed-in browser.

## Gate status at review time

| Gate | Result |
| --- | --- |
| `npm run lint` | Pass |
| `npx tsc --noEmit` | Pass |
| `npm run test:unit` (`SUPABASE_SECRET_KEY=` empty) | **2 failed**, 5,383 passed, 483 files |
| `npm audit --audit-level=high` | **1 high** (`brace-expansion`, dev-only); `--omit=dev` reports 0 |
| `npx npm-check-updates` | 7 patch, 2 minor, 2 major (`eslint` 10, `typescript` 7), 2 zero-major (`@anthropic-ai/sdk` 0.131, `sharp` 0.35.5) |

Both unit failures and the audit failure are gates `ci.yml` runs (`test:coverage`, `npm audit --audit-level=high`), so CI on any branch, including `main`, is expected to be red from 2026-10-01 UTC onward.

## Severity key

- **P0**: CI or correctness is broken now.
- **P1**: Real defect with user-visible or security impact; fix next.
- **P2**: Defect with limited impact, or a hardening gap.
- **P3**: Improvement, cleanup, or documentation drift.

## P0: CI is broken by the calendar

### P0-1 Two unit tests are calendar time bombs

- `tests/unit/phase2b-calculations-paging.test.ts` ("totals more rows than one PostgREST page") and `tests/unit/dashboard-recurring-dismissal.test.ts:43` ("shows an eligible stream as a late reminder") both call `getDashboardData(..., "2026-09", ...)` without pinning the clock or passing `options.today`.
- `vitest.config.mts:21` sets `TZ: "UTC"`, and `getDashboardData` derives `today` from `localDateKey(new Date())` (`lib/dashboard.ts:931`).
  Once UTC reaches 2026-10-01, `"2026-09"` is no longer the open month, so the mocked rows fall out of the available-month list and the assertions fail.
- Reproduced: in a throwaway copy with the clock pinned, the paging test passes at `2026-09-15T12:00Z` and `2026-09-30T12:00Z` and fails at `2026-10-01T12:00Z` with `expected undefined to be 1198`.
- This is the same class as the four scheduled-route failures fixed on 2026-09-26.
- **Fix:** pass `today` through `DashboardOptions` (preferred, matches production callers) or use `vi.useFakeTimers({ toFake: ["Date"] })` with `vi.setSystemTime` and restore real timers in `afterEach`.
  Then grep `tests/unit` for other hardcoded `"2026-` months or dates passed to code that reads `new Date()`, and pin those too.
- **Regression guard:** add a CI step (or a vitest global setup option) that runs the unit suite with the system time faked to a far-future date, such as `2030-01-15`, so the next time bomb fails on the PR that adds it.

### P0-2 `npm audit --audit-level=high` fails on `brace-expansion`

- Advisories GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p.
- Paths: `eslint@9.39.5 > minimatch@3.1.5 > brace-expansion@1.1.18` and `eslint-config-next@16.3.6 > typescript-eslint > minimatch@10.2.6 > brace-expansion@5.0.9`.
- Development-only; the production dependency tree reports 0 vulnerabilities.
- **Fix:** `npm audit fix` (lockfile-only), or an `overrides` entry if the fix needs one, then rerun lint and audit.
  Take the pending patch bumps in the same change (`next` and `eslint-config-next` 16.3.8, `@supabase/supabase-js` 2.117.2, `nodemailer` 10.0.13, `vitest` and `@vitest/coverage-v8` 5.0.3, `dotenv` 18.0.5).

## P1: defects

### P1-1 Initial bank link floods notifications with historical "large transaction" alerts

- `lib/sync.ts:403` runs routine sync with `notify: true` whether or not the item has a cursor.
  The first sync of a newly linked item backfills up to 24 months, and `notifySyncedTransactions` (`lib/sync.ts:151`) creates one `large_transaction` notification per historical row at or above the threshold (default 500).
- Each notification costs 3 or more queries (`createNotification` re-reads `alert_preferences` per call at `lib/notifications.ts:245`, then checks for an existing row, then inserts), so a large backfill page is also an N+1 write storm inside the sync loop.
- **Fix:** suppress transaction-level notifications when the run started without a cursor (`!item.sync_cursor`), and only alert on rows whose `date` is within a short recency window (for example 7 days of the viewer's today).
  Batch the inserts: load preferences once, collect candidates, and insert once with an `on conflict do nothing` on the dedupe key.
- **Test:** a first-sync run with 50 historical large rows creates zero notifications; an incremental run with one recent large row creates exactly one.

### P1-2 Pending-to-posted transitions alert twice for the same purchase

- `mapTransactionRow` (`lib/sync.ts:43`) does not store Plaid's `pending_transaction_id`.
  When a pending charge posts, Plaid removes the pending id and adds a posted row with a new `transaction_id`, so the `exact` dedupe on `plaid_transaction_id` treats it as new and fires a second large-transaction alert.
- **Fix:** persist `pending_transaction_id` (migration plus mapping), and skip the alert when the posted row's `pending_transaction_id` already has a notification.
  This column also helps the integrity pass and duplicate detection.

### P1-3 "Charged after cancellation" fires for charges made before the cancellation

- The cancellation watch (`lib/sync.ts:179`) matches every added or modified row by merchant name and never compares the transaction date with `cancelled_subscriptions.created_at`.
  A pending charge that posts after the user marks the subscription cancelled, any `modified` historical row, and the backfill of a newly linked account all trigger the alert.
- It uses the default `window` dedupe (one per UTC day per merchant), so the false alert can repeat daily.
- **Fix:** select `created_at` with the merchant, alert only when `row.date` is after the cancellation date and the row is not pending, dedupe `exact` on the transaction id, and skip on cursorless first syncs (shares the P1-1 change).

### P1-4 New-device login alert misidentifies iPhones and can send duplicates

- `lib/login-alert.ts:45` checks `/Macintosh|Mac OS/i` before `/iPhone|iPad/i`, and every real iOS user agent contains `like Mac OS X`.
  Reproduced: a stock iOS Safari UA and an iOS Chrome (`CriOS`) UA both summarize to `Safari on macOS`.
  The unit test fixture at `tests/unit/ai-provider-lib.test.ts:260` uses a truncated UA without `like Mac OS X`, which hides the bug.
- Chrome on iOS (`CriOS/`), Firefox on iOS (`FxiOS/`), and Edge on iOS (`EdgiOS/`) are labelled Safari.
- `lib/http.ts:105` triggers the alert for every API request in the first 15 seconds of a session; a dashboard load fires several requests in parallel, so one sign-in can send up to the 3-per-day limit of identical emails.
- **Fix:** order `iPhone|iPad` before the macOS pattern, add the iOS browser tokens before `Safari`, and replace the fixtures with real UA strings.
  Make the alert fire once per session record, for example by only notifying when the upsert actually inserted (an insert-first `on conflict do nothing` that reports whether a row was created).

### P1-5 Dashboard cache serves stale totals after the user edits transactions

- `lib/dashboard-cache.ts` keeps a 45-second per-instance cache, invalidated only by sync, demo, manual accounts, and reconcile.
- None of the transaction mutation routes invalidate it: `app/api/transactions/{annotate,annotate-batch,manual,override,refunds,review,transfers}`, `app/api/rules/batch`, and `app/api/import/commit`.
  A user recategorizes or adds a transaction and returns to the Dashboard within 45 seconds to see the old numbers.
- Invalidation is process-local, so on Fluid Compute a write handled by one instance does not clear another instance's entry even after this fix.
- **Fix:** call `invalidateDashboardCache(user.id)` after every successful ledger write.
  For cross-instance correctness, either add a per-user `data_version` (bumped by a trigger on the ledger tables) to the cache key, or shorten the TTL to what is acceptable after a write.

### P1-6 Reports, report CSV, Wrapped, and the ledger strip use the UTC month instead of the viewer's

- `app/reports/page.tsx:116` and `app/api/export/report-csv/route.ts:48` default the anchor month from `new Date().toISOString().slice(0, 7)`.
  For a US user on the evening of the last day of a month, Reports opens on the next, empty month while the Dashboard (which uses `resolveViewerToday`) shows the current one.
- `app/wrapped/page.tsx:43` derives `asOfDate` the same way, and `getFullYear()` for `currentYear` uses the server's zone.
- `components/dashboard/LedgerStrip.tsx:86` decides "current month" in the browser with UTC.
- **Fix:** use `resolveViewerToday(supabase, user.id)` on the server and `localMonthKey()` on the client, and add a rule to `CLAUDE.md` or a lint check that bans `toISOString().slice(0, 7|10)` for "today" outside `lib/date-utils.ts` and `lib/report-period.ts`.

### P1-7 The daily "digest skipped" fallback creates a mislabeled notification every day

- `app/api/cron/sync/route.ts:88` inserts a `broken_bank` notification titled "Daily digest email skipped" whenever SMTP is unconfigured in production.
- It runs on every daily cron, has no dedupe, and the insert result is not checked.
- Because `broken_bank` always bypasses the digest preference, the fallback notification is itself picked up by the next day's digest attempt, which fails the same way.
- **Fix:** add a dedicated `delivery_failed` type (or reuse the cron-failure admin alert rail), dedupe on the day, check the insert error, and raise one admin alert rather than writing into every user's feed.

## P2: security and robustness gaps

### P2-1 Plaid auto-sync window and manual sync limiter fail open

- `app/api/plaid/sync/route.ts:54` (30-minute auto-pull window) and `:64` (6/min manual) call `checkRateLimit` without `failClosed`.
  During a limiter outage every tab's AutoRefresh reaches Plaid, which contradicts the "enforced server-side" frugality rule in `CLAUDE.md`.
- **Fix:** `failClosed: true` for the auto window (return `{ skipped: true }`), and decide explicitly for the manual path.

### P2-2 Rate-limit counters are never pruned, and the public calendar feed lets anyone add rows

- `rate_limit_counters` (`supabase/migrations/0002_rate_limit.sql`) only ever upserts.
- `app/api/calendar/[token]/route.ts:33` keys its limit on the hash of the *presented* token, so every random guess inserts a new counter row and the limit never applies to a scanner.
  The comment says it blunts brute force; the 256-bit token makes guessing infeasible anyway, so the real effect is unbounded table growth from an unauthenticated endpoint.
- **Fix:** rate-limit the feed by client IP (and keep the per-token limit for valid tokens only, after the lookup), and add a daily prune: `delete from rate_limit_counters where window_start < now() - interval '2 days'`, run from the daily cron or `pg_cron`.

### P2-3 No retention for growing operational tables

- No code or migration prunes `audit_logs`, `user_session_records`, `notifications`, `sync_jobs`, `data_exports`, or the rate-limit table.
- `requireUser()` upserts `user_session_records.last_seen_at` on every authenticated API request, which is a write per request and grows one row per session forever.
- **Fix:** a documented retention policy per table, a daily prune in the cron, and throttle the `last_seen_at` write (skip when the stored value is under 5 minutes old).

### P2-4 Personal API tokens never expire or react to credential changes

- `api_tokens` has no `expires_at` (`supabase/migrations/20260723150000_bucket_features.sql:85`), and nothing revokes API or calendar tokens on password change or verified MFA factor removal.
- Minting a token, which grants the full privacy-safe export indefinitely, does not require MFA step-up the way account deletion and restore do.
- `verifyApiToken` (`lib/api-tokens.ts:41`) ignores the query error, so a transient database failure reads as "invalid token" rather than 503.
- **Fix:** add `expires_at` with a default (for example 90 days) and show it in Settings, revoke API/calendar tokens on password change or verified MFA factor removal, preserve explicit per-token revoke in Settings, require step-up to mint, and surface lookup errors as 503.
  Sign-out and Auth session cleanup must preserve integration tokens, including when the final session is deleted.
  A dedicated "revoke all integrations" or "sign out of all devices" action does not exist yet and remains deferred.

### P2-5 Open signup on a single-household deployment

- The app has no signup allowlist, and the local `supabase/config.toml:176` has `enable_signup = true` and `minimum_password_length = 6`.
  If the production project matches, any visitor can create an account, connect banks against the owner's production Plaid credentials (billed per item), and consume per-user AI quota.
- Not verified against the production Supabase dashboard.
- **Fix:** confirm the production auth settings; if signup is open, either disable it and use invites, or enforce an email allowlist server-side (Supabase `before_user_created` auth hook).
  Raise the minimum password length and enable leaked-password protection.

### P2-6 Household invite acceptance is a one-click GET and loses the token across login

- `app/api/household/accept/route.ts` mutates on GET with no confirmation screen.
  It is not exploitable as CSRF today because the token only reaches the invitee's inbox, but it is fragile and joining a household is a data-sharing decision.
- When the invitee is signed out it redirects to `/login` without a return path, so the invite is lost after sign-in; there is no general post-login deep-link return either (`proxy.ts:187`).
- The invite lookup error at line 31 is not checked.
- **Fix:** GET renders a confirmation page; POST (origin-checked) accepts.
  Add a validated same-origin `next` parameter to the login flow.

### P2-7 `is_household_member_for(hid, user)` is callable by any signed-in user

- Granted to `authenticated` in `supabase/migrations/20260810100000_security_hardening.sql:53` as an RPC, so a user can test whether any user id belongs to any household id.
  Needs both UUIDs, so impact is low.
- **Fix:** if only RLS policies need it, revoke `execute` from `authenticated` and call it from `security definer` policy helpers, or move it to the `private` schema.

### P2-8 No timeouts on outbound Plaid and SMTP clients

- `lib/plaid.ts` sets no axios `timeout`, and `lib/reporting.ts` sets no Nodemailer connection or socket timeouts.
  A hung provider call can consume the whole 300-second daily cron, which processes users sequentially, and the remaining users silently get no sync.
- **Fix:** set `baseOptions.timeout` (for example 30 seconds) for Plaid and `connectionTimeout`/`socketTimeout` for SMTP; add a deadline check in `syncUsers` that stops starting new users near `maxDuration` and reports the skipped count.

## P3: improvements and drift

- **AI default model is out of date.** `lib/ai-provider.ts:17` defaults to `claude-sonnet-4-6`; current Sonnet is `claude-sonnet-5-5`.
  `supportsAdaptiveThinking` is a hand-maintained substring list that will keep drifting; prefer an explicit allow or deny by family and a test per configured model id.
  Bump `@anthropic-ai/sdk` to 0.131 in the same change.
- **AI payload keeps its own exclusion list.** `lib/ai-provider.ts:66` duplicates `TRANSFER_GROUPS` from `lib/finance-domain.ts`; use the shared set so the two cannot diverge.
- **Integrity pass loads every transaction of every user daily.** `app/api/cron/sync/route.ts` `loadUserTransactions` pages the full ledger into memory; the comment says "bounded".
  Push duplicate and orphan checks into SQL.
- **`requireUser()` treats an undecodable session id as not revoked** (`lib/http.ts:82`, `lib/session-revocation.ts:19`).
  Fail closed or log loudly; a token without `session_id` should not skip the revocation check silently.
- **Digest and notification dedupe use the UTC day** (`app/api/cron/sync/route.ts:51`, `lib/notifications.ts:181`) while the rest of the cron uses the profile timezone.
- **CSP has no violation reporting.** Add `report-to`/`report-uri` so CSP breakage after a dependency change is visible.
- **Service worker cache has no size bound.** It is content-addressed and safe, but it grows across deploys forever; prune entries not seen in the current build on `activate`.
- **`features.md` is stale.** It says migration import is "missing" and names `components/settings/ImportSection.tsx`, but Mint, Monarch, and YNAB import ship through `/api/import/preview` (`lib/import-{mint,monarch,ynab}.ts`) and FF-26 removed `ImportSection`.
  Update the status lines, or archive the file now that `docs/TODO.md` owns current status.
- **`/api/import/csv` has no UI caller** (already recorded in `docs/TODO.md`); decide delete or keep.
- **Major toolchain bumps** (`eslint` 10, `typescript` 7) were not attempted; try each on its own branch.

## Missing must-have features

Ranked by impact for a real 1-2 user deployment.
Items excluded by decision (credit score, benchmark data, multi-currency FX) are not re-raised.

1. **A far-future clock run in CI.** Guards against P0-1 recurring; cheapest high-value item on this list.
2. **Signup allowlist or invite-only accounts** (P2-5).
3. **Operational-data retention** (P2-2, P2-3).
4. **Token lifecycle:** expiry, step-up mint, and revoke-all on credential change (P2-4).
5. **Post-login deep-link return** with same-origin validation (P2-6).
6. **Credit utilization and limits** on credit-card accounts, sourced only from authoritative liability data with freshness shown (open in the 2026-09-03 parity findings).
7. **Error monitoring.** There is no `instrumentation.ts`, OpenTelemetry, or error tracker; production errors exist only in function logs and the admin email rail.
   Add `instrumentation.ts` with `onRequestError` forwarding to a chosen sink, scrubbed of financial data.
8. **Integration tests in CI** against a disposable Supabase (already deferred in `docs/TODO.md`; still the largest verification gap).

## Verification limits

- No live database, Plaid, SMTP, AI provider, or signed-in browser was used.
- P1-1 to P1-3 and P1-5 are confirmed by reading the code paths; they were not reproduced end to end.
- P1-4 (iPhone label) and P0-1 were reproduced locally as described.
- Production Supabase auth settings (P2-5) were not inspected.

## Implementation status (2026-09-30 local work)

The findings below were checked against the working source before implementation.
These statuses describe local code, not a deployment.

| Finding | Status and evidence |
| --- | --- |
| P0-1 | Fixed locally. Both reported failures reproduced, and the 2030 clock run found five additional fixture failures. Explicit scenario clocks and a separate CI future-clock run now cover them. |
| P0-2 | Fixed locally. Seven requested patch updates and the SDK update are installed with scripts disabled; the dependency audit reports zero vulnerabilities. |
| P1-1 to P1-3 | Fixed locally, pending schema rollout. Cursorless syncs do not notify. Both notification insert paths now map the builder to the actual `read_at` database column. Large alerts use a seven-calendar-day viewer window and one conflict-safe batch insert per page. Posted purchases share the pending purchase identity. Cancellation alerts require a posted charge authorized strictly after the viewer's cancellation day and use exact transaction dedupe. |
| P1-4 | Fixed locally. Real iOS browser tokens are recognized. Only the request that inserts the session record owns the login alert; existing activity timestamps update at most every five minutes. |
| P1-5 | Fixed locally. All nine named mutation routes invalidate the local dashboard cache, with a behavior assertion per route. Cross-instance staleness remains bounded to five seconds; invalidation is not distributed. |
| P1-6 | Fixed locally. Reports, report CSV, and Wrapped use the profile timezone; LedgerStrip uses the browser month. A report CSV regression covers September 30 in Los Angeles after UTC reaches October. |
| P1-7 | Fixed locally. SMTP misconfiguration uses the deduplicated admin failure rail and never inserts a broken-bank notification into user feeds. If SMTP itself is unavailable, the admin rail logs its delivery failure. |
| P2-1 | Fixed locally. Both automatic and manual Plaid limits fail closed; automatic requests return the existing skipped response. |
| P2-2 | Partly not reproduced, partly fixed. The cron already pruned counters and sync jobs. Invalid calendar tokens now consume a hashed client-IP budget; only verified tokens create per-token counters. Global counters expire after two days. |
| P2-3 | Fixed locally with deliberate retention exceptions. Owner-scoped daily pruning retains audit logs for 365 days, exports for 90 days, completed sync jobs for 30 days, inactive non-revoked sessions for 90 days, and window-deduped notifications for 90 days. Revoked session records and exact notification subjects remain durable because deleting them would remove security or replay barriers. |
| P2-4 | Implemented locally, PostgreSQL smoke checks passed; full Auth acceptance and rollout pending. API tokens expire after 90 days, minting requires fresh step-up, client inserts are denied, and only revocation is client-writable. Lookup failures return 503. Auth password changes and verified MFA factor removal revoke API/calendar tokens through database triggers. Tokens also become unusable on expiry or explicit per-token revoke in Settings; sign-out and session cleanup do not revoke them. A dedicated "revoke all integrations" or "sign out of all devices" action is deferred. Revocation cannot be undone. Existing tokens receive a 90-day migration grace period. |
| P2-5 | Deferred by explicit user decision. Local Supabase configuration permits signup and sets a six-character minimum password. No allowlist hook is enabled. Production Auth configuration was not inspected or changed. |
| P2-6 | Fixed locally. GET opens a confirmation page; a same-origin POST accepts. Password, passkey, MFA, and OAuth login preserve a validated local return path. Invite lookup errors surface instead of appearing as invalid links. |
| P2-7 | Implemented locally, pending schema verification. The membership helper moves to the unexposed private schema while policy dependencies retain its OID and execute permission. |
| P2-8 | Fixed locally. Plaid requests time out after 30 seconds; SMTP has connection/greeting/socket bounds. Cron stops starting users near its deadline and reports the skipped count in a partial-failure response. |
| P3 model/payload | Fixed locally. The default is Sonnet 5.5, adaptive-thinking recognition uses explicit version families, and transfer exclusions use the canonical shared set. The current model ID and adaptive thinking support were verified against [official model documentation](https://platform.claude.com/docs/en/models/sonnet-5-5/overview). No user data was sent to a model during verification. |
| P3 features.md | Fixed locally. Migration import is documented as implemented for transactions and the removed component reference is gone. |
| Other P3 items | Deferred outside the prompt's small-cleanup scope: SQL integrity aggregation, missing session-ID fail-closed behavior, viewer-day digest windows, CSP reporting, service-worker pruning, and the unused CSV import endpoint. |

### Remaining features and rollout

Credit utilization presentation, an external error-monitoring sink, and full disposable Supabase integration coverage remain follow-up work rather than being described as shipped.
Existing migration CI already exercises transaction-review contention against local PostgreSQL; it does not cover all Auth/provider workflows.
The signup allowlist remains explicitly deferred.
The two minor dependency updates, ESLint/TypeScript major upgrades, and the additional sharp update were not bundled into these focused fixes.
No major toolchain compatibility claim is made.

Apply and verify these migrations in a disposable environment before any deployment, then have the owner apply them to production before the dependent code:

- `20261001050000_transaction_alert_identity.sql`
- `20261001051000_private_household_membership.sql`
- `20261001052000_api_token_lifecycle.sql`

The new rollback-only `scripts/check-review-remediation.sql` is wired into migration CI for token permissions, lifecycle revocation, private helper placement, and notification conflict inference.
The sign-out regression follow-up replayed all 89 migrations on clean local PostgreSQL 17.11 with minimal Auth/Storage schema stand-ins, then passed both RLS and lifecycle scripts with `ON_ERROR_STOP=1`.
The new final-session assertion failed against the original migration before the fix.
Real Supabase Auth acceptance remains unverified; see [the latest handoff](../HANDOFF.md#2026-09-30-preserve-integration-tokens-across-sign-out).
The token trigger behavior and RLS must pass the migration smoke workflow and real Auth lifecycle acceptance before rollout.
No live migrations, production settings, live financial writes, pushes, PRs, or deployments were performed in this session.
No approved disposable Supabase target or local Docker stack was available, so full Auth integration remains unverified.
The local PostgreSQL RLS and lifecycle checks above passed during the follow-up.

### Local verification

The normal-clock suite with coverage passed 5,424 tests and the unchanged coverage gates.
The 2030 clock run passed all 5,423 unit tests.
The final notification column mapping was also checked by 23 focused tests.
Branch coverage was 96.11 percent; line coverage was 99.57 percent.
Five Chromium checks passed: token form keyboard interaction, expiry display, overflow and accessibility at 375/1440 pixels in light/dark themes, and the real signed-out invitation redirect.
The token UI checks use the actual component with synthetic responses; they do not establish authenticated persistence or Supabase Auth behavior.
Signed-in confirmation-page and token lifecycle acceptance remain blocked on the disposable Auth environment.

The original remediation run could not build in its execution environment: Turbopack reported `creating new process -> binding to a port -> Operation not permitted (os error 1)` even after escalation.
The webpack diagnostic fallback also failed because `node:crypto` from the existing `lib/planning.ts` dependency chain reaches a client bundle.
The normal development server compiled the login page successfully.
The sign-out regression follow-up subsequently passed `npm run build` with Turbopack; the earlier environment blocker no longer applies to this checkout.
Final gate results are recorded in `docs/HANDOFF.md`.

## Hand-off prompt

Copy everything inside the block below into another coding agent session that has this repository checked out.

````text
You are working in the FundFlow repository (Next.js 16 App Router, TypeScript, Supabase, Plaid).
Before changing anything, read CLAUDE.md, AGENTS.md, docs/ARCHITECTURE.md, and docs/reviews/2026-09-30-repository-review.md.
CLAUDE.md is binding: in particular, every service-client query filters user_id explicitly, dates are YYYY-MM-DD strings, positive amount means money out, every spend total applies EXCLUDED_PFC, every RLS policy for authenticated users also gates on private.session_not_revoked() and private.mfa_satisfied(), and migrations are never applied to the live project by you.
Never name an LLM, agent, or vendor in branch names, commits, or PR text, and add no co-author or "generated with" lines.
Do not push, open PRs, deploy, or apply migrations unless the user explicitly asks.

Task: fix the findings in docs/reviews/2026-09-30-repository-review.md, in this order, one focused commit per finding (or tightly related group), each with a regression test that fails before the fix and passes after.

1. P0-1: make tests/unit/phase2b-calculations-paging.test.ts and tests/unit/dashboard-recurring-dismissal.test.ts independent of the wall clock by passing options.today (preferred) or faking Date and restoring real timers in afterEach. Search tests/unit for other hardcoded "2026-" dates that reach code reading new Date() and pin them. Then run the whole unit suite once with the clock faked to 2030-01-15 and fix every additional failure the same way; add a CI step or vitest option that keeps doing this.
2. P0-2: clear the brace-expansion high advisory (npm audit fix or an overrides entry, lockfile only), and take the patch bumps listed in the review. Use npm install with scripts disabled when regenerating the lockfile.
3. P1-1, P1-2, P1-3 in lib/sync.ts and lib/notifications.ts: no transaction-level notifications on a cursorless first sync; recency window for large-transaction alerts; batch notification writes (load preferences once); store pending_transaction_id via a new migration and skip duplicate alerts on pending-to-posted; cancellation watch compares the transaction date with cancelled_subscriptions.created_at, ignores pending rows, and dedupes exactly on the transaction id. Any new table or column must pass scripts/check-rls.sql.
4. P1-4 in lib/login-alert.ts and lib/http.ts: correct iOS detection order and iOS browser tokens using real user-agent strings in tests; send the new-device alert at most once per session record.
5. P1-5: call invalidateDashboardCache(user.id) after every successful write in the transaction, rules, and import routes listed in the review; add a test per route asserting invalidation.
6. P1-6: replace UTC-derived "today" and month keys in app/reports/page.tsx, app/api/export/report-csv/route.ts, app/wrapped/page.tsx, and components/dashboard/LedgerStrip.tsx with resolveViewerToday (server) or localMonthKey (client); test the last-day-of-month evening case in a US timezone.
7. P1-7: replace the "Daily digest email skipped" broken_bank insert in app/api/cron/sync/route.ts with a deduped, correctly typed path whose insert error is checked.
8. P2 items, each as its own change: fail-closed auto-sync window; IP-based limit on the public calendar feed plus a daily prune of rate_limit_counters; retention prune for operational tables and a throttled last_seen_at write; API token expiry, step-up to mint, and revoke-all on credential change; household invite confirmation page (GET shows, POST accepts) and a validated same-origin next parameter for login; revoke authenticated execute on is_household_member_for if no caller needs it as an RPC; Plaid and SMTP client timeouts plus a deadline check in the cron user loop.
9. P3 items only after the above, and only the ones that stay small: AI default model and adaptive-thinking detection, shared TRANSFER_GROUPS in the AI payload, features.md status drift.

For P2-5 (open signup) do not change production settings. Report what the code does, and ask the user before adding an allowlist hook.

Verification for every step: npm run lint, npx tsc --noEmit, SUPABASE_SECRET_KEY= npm run test:unit, npm run build, npm run validate:palette, npm audit --audit-level=high. Do not run integration tests unless TEST_SUPABASE_URL points at a disposable project the user approved. For UI changes, check the real page at 375 px and 1440 px in light and dark themes. Do not lower coverage thresholds, skip tests, or weaken assertions.

When finished, update docs/TODO.md and docs/HANDOFF.md with what changed, what was verified, and what remains (migrations to apply, live checks not run), and mark each finding in the review file as fixed, deferred with a reason, or not reproduced. Report failures honestly with their output.
````
