# Repository review, 2026-11-15

Reviewed `main` at `37908d5` (clean tree, 1,721 tracked files).
This is a source review of authentication, the Plaid sync and webhook path, the daily cron, notifications, account deletion, the in-app AI surface, exports and tokens, CI, and the pure money engines, plus a run of the local gates.
Findings already recorded in `docs/TODO.md` or an earlier file in `docs/reviews/` are not repeated unless their status changed; section "Still open from earlier reviews" lists the ones that remain.
Nothing here was exercised against a live Supabase project, Plaid, SMTP, the AI provider, or a signed-in browser.
Every finding below was confirmed by reading the cited code path; the two that were also executed say so.

## How to read this document

Each finding has the same four parts.

- **Evidence**: the file and line that shows the behaviour.
- **Impact**: what a user or the owner actually sees.
- **Fix**: the smallest change that closes it.
- **Tests**: the regression that should fail before the fix.

Severity key, unchanged from the 2026-09-30 review:

- **P0**: CI or correctness is broken now.
- **P1**: Real defect with user-visible, privacy, or billing impact; fix next.
- **P2**: Defect with limited impact, or a hardening gap.
- **P3**: Improvement, cleanup, or documentation drift.

## Gate status at review time

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass |
| `npm run lint` | Pass |
| `npm run test:unit` (`SUPABASE_SECRET_KEY=` empty) | Pass: 579 files, 6,462 tests, 127 s |
| `npm run validate:palette` | Pass, with the two documented light-theme surface-contrast exceptions |
| `npm audit --audit-level=high` (the CI gate) | Pass |
| `npm audit` (all levels) | 8 moderate, all one `minimatch` advisory under `eslint-config-next`'s nested `typescript-eslint`; `--omit=dev` reports 0 |
| `npx npm-check-updates` | 6 patch, 6 minor, 4 major (`eslint` 10, `typescript` 7, `plaid` 51, `web-push` 4) |

There are no P0 findings: nothing is red today.
`npm run build`, the Playwright suites, and `tests/integration/` were not run.
No dependency was changed in this review, so the table describes `main` exactly as it stands.

## Summary

| ID | Severity | Finding |
| --- | --- | --- |
| P1-1 | P1 | One transient sync failure parks a bank item in `error`, and neither the cron nor Refresh ever retries it |
| P1-2 | P1 | Account deletion leaves `error`-state items alive at Plaid |
| P1-3 | P1 | The daily digest only sees notifications from the seven hours before the cron |
| P1-4 | P1 | `writeAudit` never checks the insert result, so failed audit writes vanish silently |
| P2-1 | P2 | Account deletion destroys storage before the step that can still fail |
| P2-2 | P2 | Unauthenticated webhook requests can drive Plaid API calls |
| P2-3 | P2 | `PENDING_DISCONNECT` and `NEW_ACCOUNTS_AVAILABLE` webhooks are dropped |
| P2-4 | P2 | AI client has no timeout, and `ask`/`receipt` return 500 on a provider error |
| P2-5 | P2 | Small `max_tokens` budgets share room with adaptive thinking |
| P2-6 | P2 | Receipt scan throws on an impossible date and spends quota before validating the upload |
| P2-7 | P2 | The cron failure alert is suppressed for 24 hours even when its own email failed |
| P2-8 | P2 | Cron deadline starves the same users every day |
| P2-9 | P2 | A notification-preference read error aborts a sync page after its rows were written |
| P2-10 | P2 | Sync claim fails open while every other limiter fails closed |
| P2-11 | P2 | `ai/insights` inserts rows without a cap, and `ai_insights` has no retention |
| P3 | P3 | Twenty smaller items: Plaid page size, digest idempotency, calendar-feed audit volume, flag backlog, doc drift, CI hardening |

## P1: defects

### P1-1 One transient sync failure parks a bank item in `error`, and neither the cron nor Refresh ever retries it

- **Evidence.**
  `syncAllForUser` catches *any* per-item error and writes `status = "error"` (`lib/sync.ts:655`).
  The error may be a Plaid 5xx, a 30-second timeout, `RATE_LIMIT_EXCEEDED`, `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, or a Postgres hiccup; none of those mean the connection is broken.
  Every scheduled and user-initiated path then selects only `status = "active"`: `listActiveItems` (`lib/plaid-service.ts:121`), `rotateStaleItemTokens` (`lib/plaid-service.ts:467`), and the cron's own user list (`app/api/cron/sync/route.ts:233`).
  The only ways back to `active` are a successful webhook-triggered sync (the webhook handler syncs regardless of status), a `LOGIN_REPAIRED` webhook, or the user pressing Repair or Reconnect.
- **Impact.**
  A single bad minute at Plaid turns a healthy connection into a "Bank connection issue" banner and notification that says the connection "needs to be updated (error: sync_failed)".
  The item is then skipped by the daily cron, by Refresh, and by auto-refresh.
  In production it usually heals when Plaid next sends `SYNC_UPDATES_AVAILABLE`, which can be days for a quiet account.
  On a self-hosted or local deployment, where `app/api/plaid/link-token/route.ts` registers no webhook because the URL is not public https, it never heals on its own.
  The user is also told to reconnect a bank that does not need reconnecting, which costs a Plaid Link session.
- **Fix.**
  Classify the failure before writing status.
  Only codes that require user action (`ITEM_LOGIN_REQUIRED`, `ITEM_NOT_FOUND`, `INVALID_ACCESS_TOKEN`, `ACCESS_NOT_GRANTED`, `USER_PERMISSION_REVOKED`, `ITEM_LOCKED`, `NO_ACCOUNTS`, `TOKEN_ROTATION_LOST`) should set `status = "error"`.
  Everything else should leave the item `active`, record the code in `error_code` and `sync_jobs.last_error`, and let the next run retry.
  Add a consecutive-failure counter (or reuse `last_sync_success_at`) so a transient error that persists for, say, three days is escalated to the banner.
  Emit the `broken_bank` notification only for the user-action class, and change its body so it does not claim a reconnect is needed when the code is transient.
  As a backstop, have the cron also retry `error` items whose `error_code` is in the transient class.
- **Tests.**
  Unit: `syncAllForUser` with a mocked Plaid 500 leaves `status` `active` and creates no `broken_bank` notification; with `ITEM_LOGIN_REQUIRED` it sets `error` and notifies once.
  Unit: the cron user list includes a user whose only item is in transient error.
- **Related defect in the same block.**
  The notification at `lib/sync.ts:659` uses the default `window` dedupe with `item.id` as the subject key.
  Window mode matches the key by substring against the title and body (`notificationExists` in `lib/notifications.ts`), and neither contains the item id, so it never dedupes.
  The cron's `notifyBrokenBanks` then adds a second, `exact`-keyed alert for the same item the same day.
  Switch this call to `exact` with the same `broken_bank:${item.id}:${today}` key the cron uses.

### P1-2 Account deletion leaves `error`-state items alive at Plaid

- **Evidence.**
  `removeUserPlaidItems` iterates `listActiveItems(userId)` (`app/api/account/route.ts:41`), which filters `status = "active"`.
  An item in `error` is skipped, `failed` stays 0, and the route goes on to delete the auth user, which cascades the `plaid_items` row and the only copy of its access token.
- **Impact.**
  The Plaid Item survives the account it belonged to.
  Plaid keeps the bank authorization and continues to bill subscription products for it, and it can no longer be removed from the app because the encrypted token is gone.
  P1-1 makes `error` items common, so this is not an edge case.
  This is a privacy defect: the user asked for erasure and the bank link was not revoked.
- **Fix.**
  Add `listItemsForRemoval(userId)` that returns every item whose status is not `disconnected`, and use it here.
  Keep the existing tolerance for `ITEM_NOT_FOUND` and `INVALID_ACCESS_TOKEN`.
  Audit `app/api/plaid/disconnect/route.ts` and the takeout and backup checklists named in the route comment for the same filter.
- **Tests.**
  Unit: deletion with one `active` and one `error` item calls `itemRemove` twice.
  Unit: a failing `itemRemove` on the `error` item returns 503 and does not delete the auth user.

### P1-3 The daily digest only sees notifications from the seven hours before the cron

- **Evidence.**
  `sendDailyDigest` selects notifications with `created_at >= todayStart`, where `todayStart` is UTC midnight (`app/api/cron/sync/route.ts:54-55`).
  The cron runs once a day at 07:00 UTC (`vercel.json`).
  The window is therefore 00:00 to about 07:00 UTC of the run day.
- **Impact.**
  Anything created between 07:01 and 23:59 UTC is never in any digest.
  That is most webhook-driven alerts, since they arrive when the bank posts: large transactions, charged-after-cancellation, price increases and new subscriptions found by a daytime refresh, and login alerts.
  A user who relies on the digest email instead of opening the app misses them entirely.
  The 2026-09-30 review recorded only that the window uses the UTC day; the larger problem is that the window does not cover the day at all.
- **Fix.**
  Make the window "since the last digest", not "since midnight".
  Store `last_digest_sent_at` on `profiles` (or a small `digest_deliveries` table like `backup_deliveries`), select `created_at > last_digest_sent_at` capped at 48 hours, and advance the marker only after a successful send.
  That also fixes the two smaller defects below.
- **Smaller defects in the same function.**
  There is no "already sent" marker, so re-running the cron (a manual retry after a 207) sends the digest twice.
  The function catches and logs every error itself (`route.ts:89`), so `runUserStep("cron.sync.digest", ...)` never records a failure and a broken digest is invisible in the 207 body, despite the A-13 comment directly above saying the failure "must surface".
  Rethrow after logging.
- **Tests.**
  Unit with a fixed clock: a notification created at 15:00 UTC the previous day is included in the 07:00 digest; a second invocation the same day sends nothing.

### P1-4 `writeAudit` never checks the insert result

- **Evidence.**
  `lib/audit.ts:165` awaits `supabase.from("audit_logs").insert(...)` and discards the returned `{ error }`.
  supabase-js reports database errors in the result object and does not throw, so the surrounding `try/catch` only catches a missing `SUPABASE_SECRET_KEY` or a network exception.
- **Impact.**
  A rejected audit insert (a check constraint on a new action name, a column mismatch after a migration, an RLS or grant regression) produces no row and no log line.
  The audit trail has 136 action names added over many PRs; one that fails the database-side constraint would be silently absent, and Settings > Audit would simply not show it.
  `lib/export-route.ts` already documents this exact hazard for `data_exports` ("a silently dropped export journal row would claim an audit trail the database never recorded") and checks its own insert, then calls `writeAudit`, which does not.
- **Fix.**
  Destructure `{ error }` and `logError("audit.write", error)` when it is set.
  Keep the function non-throwing.
  Apply the same check to the unchecked reads and deletes in `lib/push.ts` (`push_subscriptions` select and delete).
- **Tests.**
  Unit: a mocked insert that resolves `{ error: { message: "x" } }` calls `logError` and does not throw.
  Add a migration-check assertion (or a unit test over the `AuditAction` union) that every action name is accepted by the `audit_logs` constraint, if one exists.

## P2: security and robustness gaps

### P2-1 Account deletion destroys storage before the step that can still fail

- **Evidence.**
  `DELETE /api/account` runs `cleanupUserStorageObjects` (`app/api/account/route.ts:290`) before `removeUserPlaidItems`.
  When any Plaid removal fails the route returns 503 and keeps the account.
- **Impact.**
  The account survives with its `receipts` and `account_statements` rows pointing at objects that no longer exist, and the avatar gone.
  The user sees "Some bank connections could not be removed. Try again." and has already lost their uploaded files.
- **Fix.**
  Reorder: Plaid removal first (it is retryable and idempotent), then storage, then `deleteUser`.
  If storage cleanup fails after Plaid succeeded, the retry is safe because the items are already `disconnected`.
- **Tests.**
  Unit: with a failing `itemRemove`, no storage `remove` call is made.

### P2-2 Unauthenticated webhook requests can drive Plaid API calls

- **Evidence.**
  `verifyPlaidWebhook` reads `kid` from the unverified JWT header and calls `plaid.webhookVerificationKeyGet({ key_id: kid })` on a cache miss (`app/api/plaid/webhook/route.ts:73`).
  Failed lookups are not cached and the route has no rate limit.
- **Impact.**
  Anyone who can reach `/api/plaid/webhook` can make the server issue one authenticated Plaid request per POST with a random `kid`.
  That spends the Plaid rate limit the real sync depends on and holds a function open for up to the 30-second client timeout per request.
- **Fix.**
  Add a negative cache (unknown `kid` remembered for a few minutes, bounded to a small map) and a fail-closed IP limiter in front of the key fetch, using the same hashed-IP pattern as the calendar feed.
  Reject a `kid` that is not a plausible key id (length and charset) before any network call.
  Do the cheap checks first: decode the payload and reject a stale `iat` before fetching the key.
- **Tests.**
  Unit: two requests with the same unknown `kid` produce one `webhookVerificationKeyGet` call; a stale `iat` produces none.

### P2-3 `PENDING_DISCONNECT` and `NEW_ACCOUNTS_AVAILABLE` webhooks are dropped

- **Evidence.**
  `handleItemWebhook` handles `ERROR`, `PENDING_EXPIRATION`, `LOGIN_REPAIRED`, and `USER_PERMISSION_REVOKED` (`app/api/plaid/webhook/route.ts:238-245`) and ignores every other `ITEM` code.
- **Impact.**
  `PENDING_DISCONNECT` is Plaid's advance warning that an Item will stop working unless the user goes through update mode; ignoring it means the first the user hears is the failure.
  `NEW_ACCOUNTS_AVAILABLE` means the user opened a new account at an already-linked bank; ignoring it means that account never appears until they think to relink.
- **Fix.**
  Treat `PENDING_DISCONNECT` like `PENDING_EXPIRATION` (stay `active`, set `error_code`, show the Reconnect prompt).
  For `NEW_ACCOUNTS_AVAILABLE`, set a flag on the item and offer update mode with account selection from the accounts page.
  Log unhandled `webhook_type`/`webhook_code` pairs once (codes only, never the body) so the next new code is noticed.
  Confirm the current code list against Plaid's webhook reference before implementing.
- **Tests.**
  Unit: each new code produces the expected `setItemStatus` call; an unknown code logs and returns 200.

### P2-4 AI client has no timeout, and `ask`/`receipt` return 500 on a provider error

- **Evidence.**
  `getAnthropicClient` constructs the client with only `apiKey` (`lib/ai-provider.ts:29`), so the SDK's default request timeout and retry count apply.
  `app/api/ai/ask/route.ts:99` and the matching catch in `app/api/ai/receipt/route.ts` send every thrown error to `errorResponse`, which is a 500.
- **Impact.**
  The SDK default timeout is far longer than a serverless invocation, so a slow provider ends as a platform timeout rather than a handled error.
  `CLAUDE.md` states the contract as "a provider error falls back the same way, never a 500"; `insights` honours it and the other two do not.
  The daily quota for the call is spent before the provider is contacted, so an outage burns the user's ten questions.
- **Fix.**
  Pass an explicit `timeout` (about 30 s for `ask` and `insights`, 45 s for the vision call) and `maxRetries: 1`.
  Wrap the provider call in `ask` and `receipt` and map provider failures (overload, rate limit, timeout, connection) to a 503 with a plain "AI is temporarily unavailable" message.
  Charge the per-day counter only after the provider answered, or refund on provider failure; keep a separate short-window limiter in front so retries cannot loop.
- **Tests.**
  Unit: a rejected provider promise yields 503 for both routes, and the day counter is unchanged.

### P2-5 Small `max_tokens` budgets share room with adaptive thinking

- **Evidence.**
  All three calls enable `thinking: { type: "adaptive" }` for supported models and set `max_tokens` to 2048, 600, and 1024 (`lib/ai-provider.ts:171`, `216`, `285`).
  None of them inspects `stop_reason` for `max_tokens`.
- **Impact.**
  Thinking output counts against `max_tokens`.
  With a 600-token ceiling, a question the model reasons about at length can end with a truncated answer, or with no text block at all, which `ask` renders as "No answer produced."
  In `insights` and `receipt` a truncated structured output fails `JSON.parse`; `insights` silently falls back to rules and `receipt` returns a 500.
  Verify the current token-accounting rules in the provider documentation before choosing numbers; this review did not call the API.
- **Fix.**
  Either drop thinking for these three short, bounded tasks, or raise `max_tokens` so there is clear headroom above the expected answer.
  Handle `stop_reason === "max_tokens"` explicitly: for `ask`, return a "the answer was cut short" message; for the JSON calls, treat it as a provider failure.
  Validate the parsed JSON shape instead of casting it (`insights` array, string fields, finite `amount`), so a malformed response fails in one known place.
  Log `response.usage` (token counts only) so cost per route is observable.
- **Tests.**
  Unit: a mocked response with `stop_reason: "max_tokens"` and no text block returns the handled message, not a 500.

### P2-6 Receipt scan throws on an impossible date and spends quota before validating the upload

- **Evidence.**
  `matchReceiptTransaction` accepts any string matching `^\d{4}-\d{2}-\d{2}$` and calls `new Date(extracted.date)` followed by `toISOString()` (`app/api/ai/receipt/route.ts:32-48`).
  A model-read date such as `2026-13-45` or `2026-02-30` is an Invalid Date or a silently shifted one, and `toISOString()` throws `RangeError` on the former.
  The day counter is charged at line 106, before the form is parsed and before the size and type checks.
- **Impact.**
  A misread receipt date becomes a 500 after the image has already been sent to the provider and the scan counted.
  An oversized or wrong-type file costs one of ten daily scans without any provider call.
- **Fix.**
  Validate the date with the round-trip check the repo already uses elsewhere, and return the extraction with `matchedTransactionId: null` when it fails.
  Move the limiter below the upload validation.
  Clamp `amount` to a finite, plausible range and cap `merchant` length before returning it to the client.
- **Tests.**
  Unit: an extraction with `date: "2026-13-45"` returns 200 with no match; an unsupported media type returns 400 and leaves the counter untouched.

### P2-7 The cron failure alert is suppressed for 24 hours even when its own email failed

- **Evidence.**
  `alertCronFailure` consumes the `cron-alert:${cronName}` window at `lib/cron-alert.ts:22` before it looks up the admin or sends.
  A send failure is caught and logged.
- **Impact.**
  The first failed attempt closes the window, so no alert is attempted again for a day.
  The alert rail is SMTP, and the October 1 backup incident in `docs/TODO.md` was itself an SMTP delivery problem, so the failure most likely to need an alert is the one that cannot deliver it.
  There is still no second channel: no `instrumentation.ts`, no error sink (open since the 2026-09-30 review).
- **Fix.**
  Take the window only after a successful send (insert-if-absent after `sendMail` resolves, or release on failure).
  Add one non-SMTP sink for cron and unhandled route errors: `instrumentation.ts` with `onRequestError`, forwarding context and error class only.
  Web push to the admin's own subscription is a cheap second channel that already exists in `lib/push.ts`.
- **Tests.**
  Unit: a throwing `sendCronAlertEmail` leaves the next call free to send.

### P2-8 Cron deadline starves the same users every day

- **Evidence.**
  `syncUsers` walks `userIds` in a fixed order (bank users in query order, then every profile by id) and stops at `maxDuration - 45` seconds (`app/api/cron/sync/route.ts:196-205`).
  `loadMaintenanceUsers` adds every row in `profiles`, and signup is open (P2-5 of the 2026-09-30 review, deferred).
- **Impact.**
  The backup incident note records 29 delivery attempts, so the deployment already has more accounts than the "1-2 users" the budget assumes.
  Each user costs several sequential Plaid and database round trips; once the total passes 255 seconds, the users at the tail are skipped, and it is the same users the next day.
  The integrity pass after it reloads every transaction of every user and shares the same deadline.
- **Fix.**
  Order users by oldest `last_maintenance_at` first (a new `profiles` column stamped at the end of `syncUser`), so a skipped user goes first tomorrow.
  Skip users with no bank item, no manual account, and no activity instead of running the full step list for an empty profile.
  Run a small fixed concurrency (2 to 3 users) since the per-item claim already serialises work on one item.
  Resolve the open-signup decision: an invite or allowlist gate removes the growth that causes this.
- **Tests.**
  Unit: with a deadline that admits two of three users, the skipped user is first in the next run's order.

### P2-9 A notification-preference read error aborts a sync page after its rows were written

- **Evidence.**
  `notifySyncedTransactions` throws on an `alert_preferences` read error (`lib/sync.ts:250`).
  It is called from `applyTransactionPage` after the upsert and `finish_transaction_sync_page`, so the throw propagates out of the sync loop.
- **Impact.**
  The page's data is committed but the cursor is not advanced, the run is recorded as failed, and under P1-1 the item is parked in `error`.
  An alerting concern takes down the ledger sync.
- **Fix.**
  Make the whole notify step best-effort: catch, log, continue.
  The same applies to `processRuleAutomation` on the line above if it can throw for reasons unrelated to the page write; decide deliberately whether a rule failure should fail the sync, and document the answer in the function comment.
- **Tests.**
  Unit: a failing preference read still returns the page's counts and advances the cursor.

### P2-10 Sync claim fails open while every other limiter fails closed

- **Evidence.**
  When `claim_item_sync` errors, `syncItemTransactions` logs and proceeds without the claim (`lib/sync.ts:103-106`).
  `backfillItemTransactions` and `rotateItemAccessToken` both refuse to run in the same situation.
- **Impact.**
  During a database brown-out, overlapping webhook, cron, and manual runs for one item all proceed, which is the double-spend of Plaid calls and the duplicate notifications the claim exists to prevent.
  It is also the moment a token rotation could invalidate a token under a running sync.
- **Fix.**
  Fail closed: return the no-op result when the claim cannot be established, and let the next trigger retry.
  The 2026-09-30 remediation made the auto-sync window and manual limiter fail closed for the same reason.
- **Related.**
  `STALE_SYNC_SECONDS` is 300 and the cron's `maxDuration` is also 300, while a first sync drains an unbounded number of pages.
  A long initial sync can be reclaimed by a second run at the five-minute mark.
  Refresh the claim timestamp every N pages, or bound the routine sync by wall clock and persist progress the way Repair does.

### P2-11 `ai/insights` inserts rows without a cap, and `ai_insights` has no retention

- **Evidence.**
  The 4-per-day limiter in `app/api/ai/insights/route.ts:55` guards only the provider call.
  When the limit is reached, or no key is configured, the route still computes the rule-based fallback and inserts three rows into `ai_insights` on every POST.
  `lib/operational-retention.ts` prunes five tables; `ai_insights` is not one of them.
  The route also writes no audit entry, unlike `ask` and `receipt`.
- **Impact.**
  A client retry loop cannot run up a provider bill, but it can write rows without bound, and the table grows for the life of the account.
- **Fix.**
  Add a route-level limiter (for example 20 per day, fail closed) in front of everything.
  Replace instead of append: keep the latest generation per `insight_type` and `source_month`, or prune rows older than 180 days in `pruneOperationalData`.
  Add an `ai_insights_generated` audit action that records provider versus fallback.

## P3: improvements and drift

### Plaid usage and sync

- **Request 500 transactions per `/transactions/sync` page.**
  `lib/sync.ts:433` passes only `include_original_description`, so Plaid's default page size of 100 applies.
  The investments sync already asks for 500 (`lib/investment-sync.ts:257`).
  A larger page means up to five times fewer Plaid calls and database round trips on an initial link, which is the "Plaid frugality" rule applied to the hot path.
  Confirm the maximum in Plaid's reference before changing it.
- **`getAccountIdMap` runs once per page for the whole user.**
  `applyTransactionPage` reloads every account id for the user on each page.
  Load it once per run and refresh only when a page reports an unknown account.
- **`import` order in `lib/sync.ts`.**
  `import { processRuleAutomation }` sits on line 1, above `import "server-only"`.
  Harmless, but the guard should be the first statement so a future client import fails at the top of the file.
- **The webhook route does its work inline.**
  A `SYNC_UPDATES_AVAILABLE` for a large backlog runs the full drain before answering.
  Plaid retries a webhook that is slow to acknowledge; the per-item claim absorbs the duplicate, but each retry still costs an invocation.
  Acknowledge first and continue with `after()` from `next/server` (read the Next 16 guide in `node_modules/next/dist/docs/` before using it), and export an explicit `maxDuration` on the route.

### Notifications

- **Low-cash alert repeats daily.**
  The subject key is `low_cash_forecast:${today}` (`lib/notifications.ts:59`), so a user with a persistent projected low balance gets the same alert every day.
  Key it on the projected low date or on the ISO week.
- **Calendar feed writes an audit row on every poll.**
  `app/api/calendar/[token]/route.ts:67` records `calendar_feed_read` per request, and calendar clients poll continuously within the 60-per-hour limit.
  One subscribed client can add tens of thousands of rows a year under the 365-day audit retention.
  Record the first read per token per day instead.
- **Token revoke reports success for a row it did not change.**
  `DELETE /api/tokens` does not check that the update matched a row, and audits `api_token_revoked` regardless.
  Add `.select("id")` and return 404 when nothing was revoked.

### Rate-limit keys

- **Shared bucket when the client IP is unknown.**
  `getClientIp` returns null off Vercel, and the callers fold that into one key: `export-token-ip:null` (`lib/export-route.ts:23`), `mcp-ip:unknown` (`app/api/mcp/route.ts:151`), and the calendar feed's hash of `"unknown"`.
  On a self-hosted deployment every token caller shares one budget, so one script can lock out the rest.
  Document the reverse-proxy header a self-host must set, or let `getClientIp` honour a configured trusted header (`TRUSTED_IP_HEADER`).
- **Cookie-session exports have no limiter.**
  `export/csv`, `json`, `qif`, `report`, `report-csv`, `tax`, `accounts-csv`, and `investments-csv` are unthrottled for signed-in users, and `export/report` renders a PDF.
  Add one shared `export:${userId}` limiter in `resolveExportContext`.
- **`/api/health` queries the database on every unauthenticated hit.**
  Cache the result in module scope for 30 seconds.

### Money engines

- **`buildPayoffSchedule` gives a zero-balance debt a $25 minimum.**
  `lib/debt.ts:132` computes `Math.max(25, balance * 0.02)` even when the balance is 0, and that phantom payment joins the monthly budget.
  Executed during this review: `$5,000 at 20%` alone pays off in 109 months with $5,840.10 interest; adding a second debt with a $0 balance changes the result to 67 months and $3,308.20.
  The debt page and dashboard filter `balance > 0` before calling, and `lib/debt-scenarios.ts` relies on the rollover deliberately for lump sums, so no shipped screen shows the wrong number today.
  The pure function is still wrong for a caller that passes a paid-off card without an explicit `minPayment`.
  Default the minimum to 0 when the balance is 0, and keep the scenario path passing its pre-computed minimums explicitly.
- **Rent-versus-buy omits the two largest terms.**
  `calculateRentBuy` (`lib/calculators.ts`) counts no selling cost and no return on the down payment had it been invested, and holds tax, insurance, and maintenance flat while rent grows.
  All three bias the result toward buying.
  Add `sellingCostPct` and `investmentReturnApr` inputs, and label the result a projection with its assumptions listed.
- **Date validation is copied into about fifteen files.**
  The `value === new Date(value).toISOString().slice(0, 10)` round trip appears in `lib/payday.ts`, `lib/sinking-funds.ts`, `lib/card-value.ts`, `lib/statement-vault.ts`, `lib/xirr.ts`, `lib/receipts.ts`, `lib/reports.ts`, and six route files, with small differences between copies.
  Export one `isValidDateKey` from `lib/date-utils.ts`; P2-6 is what happens when one site forgets the round trip.
- **Server-side "today" still uses UTC in a few handlers.**
  `app/api/investments/manual/route.ts:21`, `app/api/demo/route.ts:56` and `:98`, and `app/api/mcp/route.ts:39` take the UTC date.
  `transactions/manual` tolerates one day of skew on purpose; the others should use `resolveViewerToday` as `CLAUDE.md` requires.

### Authentication

- **Test seam in production code.**
  `lib/step-up.ts:37` branches on `NODE_ENV === "test"` to call a mock's `signInWithPassword`.
  Inject the verifier instead, so the shipped function has one path.
- **A session without a `session_id` claim is treated as not revoked.**
  `lib/session-revocation.ts:19`, open since the 2026-09-30 review.
  Still worth closing: fail closed, or at least log.
- **`pathname.startsWith("/auth")` is a prefix match.**
  `proxy.ts:17` makes any future `/authors` or `/authorize-device` page public by accident.
  Match `/auth/` and the exact `/auth` path.
- **No `global-error.tsx`.**
  `app/error.tsx` cannot catch an error thrown by the root layout itself.
  Add a minimal `app/global-error.tsx`.

### Feature-flag backlog

`lib/feature-flags.ts` defines 75 flags; 63 default to off.
That is a large amount of merged code that no user runs and that only synthetic tests exercise, and each dark flag is a combination nobody has accepted against a real database.
`docs/TODO.md` repeats "every new release flag remains off; enabling any of them is a separate owner decision" across a dozen checkpoints without an owner or date for any of them.

- Triage the 63 into three lists: enable now (no migration, no provider cost), enable after a named acceptance step, and delete.
- Give each surviving flag a one-line exit criterion in the flag's own comment.
- Add a unit test that fails when a flag has been off for longer than an agreed age without an entry in `docs/TODO.md`, so the list cannot only grow.
- Fix the misplaced comment: the "Plaid Liabilities is a separately billed provider call" note at `lib/feature-flags.ts:32` sits above `insightGenerators`, not `liabilitiesSync`.

### CI, dependencies, and operations

- **Scheduled workflows stop silently.**
  The weekly report and monthly backup are driven by GitHub Actions schedules (`.github/workflows/weekly-report.yml`, `backup.yml`).
  GitHub disables scheduled workflows in a repository with no activity for 60 days, without notifying anyone.
  Dependabot's weekly PR currently keeps the repository active, which is an accident, not a design.
  Add a freshness check to `/api/health` (last weekly-report run, last backup run) so an uptime monitor notices.
- **`.github/dependabot.yml` comments are stale.**
  They cite `react` 19.2.8, `sharp` 0.35.4, `eslint-config-next` 16.2.10, and list `plaid` 47, `nodemailer` 10, and `vitest` 5 as deferred majors.
  `package.json` has `react` 19.3.1, `sharp` 0.35.5, `plaid` 50, `nodemailer` 10, and `vitest` 5.
  `docs/HANDOFF.md` (2026-10-25) likewise says the `plaid` 49 and `@anthropic-ai/sdk` 1.x majors stay deferred while both are installed.
- **Type packages in `dependencies`.**
  `@types/nodemailer` and `@types/pdfkit` belong in `devDependencies`.
- **No Node version pin.**
  CI uses Node 22, but `package.json` has no `engines` field and there is no `.nvmrc`, while `@types/node` is `^26`.
  Pin one version in all three places.
- **Actions are pinned by tag.**
  `actions/checkout@v7` and `actions/setup-node@v7` should be pinned to commit SHAs, most importantly in `greetings.yml` and `label.yml`, which run on `pull_request_target`.
- **Unit suite spends half its time importing.**
  Vitest reports 1,206 modules evaluated 9,163 times and estimates about 29 s saved with `isolate: false`.
  Try it for `tests/unit` only; the suite runs twice in CI (coverage and future clock).
- **Moderate audit findings.**
  The eight moderate advisories are one `minimatch` issue under `eslint-config-next`.
  Dev-only and below the CI threshold; clear it with an `overrides` entry when a fixed `minimatch` is compatible, as was done for `postcss` and `js-yaml`.
- **Available updates.**
  Patch and minor updates are routine and can ride the next Dependabot group.
  `plaid` 51 and `web-push` 4 are new majors since the last review and need their own branches; `eslint` 10 and `typescript` 7 remain blocked for the reasons recorded in `dependabot.yml`.
- **Default sender is a provider sandbox address.**
  `lib/reporting.ts:64` falls back to `onboarding@resend.dev` when `SMTP_FROM` is unset.
  That sender only delivers to the provider account's own address, which matches the "1 sent, 28 failed" result of the October backup retry.
  In production, refuse to send without `SMTP_FROM`, the same way the transport already refuses without `SMTP_HOST`.

### Naming

- **`/api/mcp` is not an MCP server.**
  It is a token-authenticated REST endpoint returning aggregates; it does not speak the Model Context Protocol (no JSON-RPC, no tool listing).
  Either rename it (`/api/v1/aggregates`) before the flag is ever turned on, or implement the protocol.
  Renaming is free while `mcpEndpoint` is off.

## Still open from earlier reviews

These were recorded before and are unchanged in the source today.
They are listed so this document can be used as a single worklist; the original entries hold the detail.

| Item | Source | State |
| --- | --- | --- |
| Split replacement, annotation updates, and linked goal-progress writes are not atomic | `docs/TODO.md`, 2026-10-03 | Open |
| Unlinking a bank leaves statement PDFs in the `statements` bucket | `docs/TODO.md`, 2026-10-03 | Open |
| Reports-only member cannot discover the `householdId` the aggregates route needs | `docs/TODO.md`, 2026-10-03 | Open |
| Settings token form mints only `export:rows` | `docs/TODO.md`, 2026-10-03 | Open |
| `/api/mcp` does not report truncation at the 25,000-row projection limit | `docs/TODO.md`, 2026-10-03 | Open |
| Open signup, six-character minimum password | 2026-09-30 P2-5 | Deferred by owner; P2-8 above is a consequence |
| Integrity pass loads every transaction of every user daily | 2026-09-30 P3 | Open |
| CSP has no violation reporting | 2026-09-30 P3 | Open |
| Service-worker cache is never pruned | 2026-09-30 P3 | Open |
| `/api/import/csv` has no UI caller | `docs/TODO.md` | Open |
| No error-monitoring sink, no `instrumentation.ts` | 2026-09-30 | Open; see P2-7 |
| Integration tests do not run in CI | `docs/TODO.md` | Open; largest verification gap |
| Backup restore stays behind `backupRestore: false` pending redesign | `docs/TODO.md`, 2026-09-02 | Open |
| Migration `20261025090000_transaction_datetime.sql` unapplied to production | `docs/TODO.md`, 2026-10-25 | Not verified in this review |

## Recommended order of work

Each line is sized to be one reviewable PR.

1. **`fix/sync-transient-errors`**: P1-1, with P2-9 and P2-10, since all three decide when a sync failure should mark an item broken.
2. **`fix/account-delete-plaid-items`**: P1-2 and P2-1 together; both are in `app/api/account/route.ts`.
3. **`fix/audit-write-checked`**: P1-4, plus the unchecked calls in `lib/push.ts`.
4. **`fix/daily-digest-window`**: P1-3; needs one small migration for the delivery marker.
5. **`fix/webhook-hardening`**: P2-2 and P2-3.
6. **`fix/ai-provider-resilience`**: P2-4, P2-5, P2-6, P2-11.
7. **`fix/cron-fairness-and-alerts`**: P2-7 and P2-8; needs one `profiles` column.
8. **`chore/flag-triage`**: the feature-flag backlog; a decision document first, code second.
9. **`chore/ci-and-deps`**: the CI, dependency, and documentation-drift items.
10. The remaining P3 items individually, as they are touched.

Items 4 and 7 add migrations.
Per `CLAUDE.md`, apply and verify them in a disposable project and have the owner apply them to production before the code that reads the new columns is deployed.

## Verification limits

- No live database, Plaid, SMTP, AI provider, or signed-in browser was used.
- `npm run build`, Playwright, and `tests/integration/` were not run.
- P1-1 to P1-4 and all P2 items were confirmed by reading the code paths, not reproduced end to end.
- The debt-engine item was executed locally with a throwaway unit test, which was removed afterwards.
- Plaid webhook codes, the `/transactions/sync` page-size maximum, and AI token accounting are stated from prior knowledge of those APIs; check each against the provider's current reference before implementing.
- The 105 route handlers were tabulated for authentication, rate limiting, service-client use, and audit calls, and about 30 were read in full.
  The import, rules, budget, goals, recurring, and investments routes were not read line by line, and neither were the 113 migrations beyond a scan for `security definer` functions without a pinned `search_path` (none found) and grants to `anon`.
- React components were not reviewed for behaviour or accessibility in this pass.

## Implementation status (2026-11-16, PR #239)

Each finding above was checked against the branch at `0659ce9` by reading the diff, not by exercising live services.
These statuses describe source on the PR branch, not a deployment.
The findings above describe `main` at `37908d5` and are kept as written.

| Finding | Status and evidence |
| --- | --- |
| P1-1 | Fixed. `lib/plaid-item-health.ts` classifies user-action codes; other failures leave the item `active` with the code recorded, and `listActiveItems({ retryTransient: true })` plus the cron user list retry items previously parked with a transient code. The sync-time `broken_bank` alert uses the `exact` daily key. Sync health reports a failing item as stale after 72 hours. |
| P1-2 | Fixed. Account deletion uses `listItemsForRemoval` (`active` and `error`). Disconnect now also refuses to delete local rows when Plaid removal fails. |
| P1-3 | Fixed, pending migration. The digest reads from the last successful delivery (`cron_delivery_windows`), capped at 48 hours, sends once per UTC day, and rethrows so the step is reported. |
| P1-4 | Fixed. `writeAudit` logs a returned insert error; `lib/push.ts` checks its read and prune. The suggested check of every `AuditAction` against a database constraint was not added. |
| P2-1 | Fixed. Plaid removal runs before storage cleanup. |
| P2-2 | Fixed. `kid` format, signature length, `iat`, and body hash are checked before any key fetch; unknown keys are negatively cached for five minutes and fetches share a fail-closed per-IP limiter. |
| P2-3 | Fixed, pending migration. `PENDING_DISCONNECT` is handled like `PENDING_EXPIRATION`; `NEW_ACCOUNTS_AVAILABLE` sets `plaid_items.new_accounts_available` and update mode enables account selection. Unhandled codes are logged once. |
| P2-4 | Fixed. The client sets a timeout and one retry; `ask` and `receipt` return 503 on provider failure and refund the daily counter. |
| P2-5 | Fixed. Thinking is no longer requested for the three calls, `max_tokens` stops are handled, parsed output is validated, and token usage is logged. |
| P2-6 | Fixed. Dates use `isValidDateKey`, the quota is charged after upload validation, and extracted fields are bounded. |
| P2-7 | Fixed, pending migration. The alert window advances only after a successful send, with web push as a fallback. `instrumentation.ts` logs route and error class; no external error sink was added. |
| P2-8 | Fixed, pending migration. Users are ordered by `profiles.last_maintenance_at`, empty profiles are skipped, and two users run concurrently. Open signup remains an owner decision. |
| P2-9 | Fixed. Rule automation and alerts after a committed page are best-effort. |
| P2-10 | Fixed. A claim error returns without syncing. Routine sync has a 180-second budget and resumes from the repair cursor. |
| P2-11 | Fixed. The route has a 20-per-day limiter, `ai_insights` is pruned after 180 days, and generation is audited. Rows are still appended rather than replaced. |
| P3 | Done: 500-row sync pages, one account-map load per run, `after()` on the sync webhook, weekly low-cash key, daily calendar-feed audit, token revoke 404, `TRUSTED_IP_HEADER`, session-export limiter, cached `/api/health` with scheduler freshness, zero-balance debt minimum, rent-versus-buy inputs, shared `isValidDateKey`, viewer-day in the demo and manual-holding routes, injected step-up verifier, `/auth/` prefix match, `global-error.tsx`, `docs/FEATURE_FLAGS.md`, CI SHA pins, `.nvmrc` and `engines`, `SMTP_FROM` required in production, and the `/api/v1/aggregates` rename with a `truncated` field. |
| P3, not done | `requireUser()` in `lib/http.ts` still skips the revocation check when a token has no `session_id`; only the page path in `lib/session-revocation.ts` fails closed. The aggregates route's default period still uses the UTC day. The flag-age unit test, the `isolate: false` trial, and the `minimatch` override were not attempted. |

### Follow-up fixes made during this check

- A sync skipped because another run held the item claim was recorded as a failed job with `SYNC_CLAIM_UNAVAILABLE`.
  Only a claim that could not be checked is now recorded that way; ordinary contention is recorded as done, as before.
- A user whose maintenance was cut short by the cron deadline was still stamped `last_maintenance_at`, which moved them to the back of the next run.
  The stamp is now skipped for that user.
- `lib/audit.ts` imported `node:net` above `import "server-only"`; the guard is first again.

### Behaviour changes to be aware of

- Disconnecting a bank now returns 503 and keeps local data when Plaid removal fails for a reason other than a missing item or invalid token.
  An item whose stored token cannot be decrypted can therefore not be disconnected from the app until that is handled separately.
- `20261115130000_cron_delivery_windows.sql` must be applied before this code is deployed: the digest, cron alerts, `/api/health`, the maintenance user list, the AI quota refund, and the new-accounts flag all read objects it creates.
