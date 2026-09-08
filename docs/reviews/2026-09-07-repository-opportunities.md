# Repository review and next priorities

Reviewed 2026-09-07 at `ef831c33b5268723ab0026c68bfa1015a8159fb2`, matching remote `main` during this review.
Scope: current product and architecture, selected financial write paths, recurring calendar delivery, exports, automation, test workflows, dependency freshness, and a signed-in production sample of Dashboard and Accounts.
The original findings below describe that reviewed baseline; their line numbers are historical references.
Implementation status and current verification are recorded separately below.
No production financial records were intentionally changed, no calendar credentials were minted, and no reconciliation was saved.
The reconciliation browser exercise changed only unsaved local form state, then closed the dialog.

## Implementation status, 2026-09-07

All ten findings are addressed in the implementation.
The database migrations are applied; application deployment awaits the review-fix merge.
The three feature proposals remain future work.

| Findings | Implemented behavior | Regression evidence |
| --- | --- | --- |
| R-01, R-02, R-04, R-09 | One owner-validated reconciliation transaction uses an explicit opening balance or the last verified statement, selected cleared activity, and the correct asset/liability direction. | Real PostgreSQL rollback, retry, ownership, MFA, revocation, stale-revision, carry-forward, and adjustment checks; local browser saves and stale-save rejection. |
| R-03 | Calendar uses the shared recurring occurrence model, real anchors, amount overrides, manual items, scheduled entries, and the owner's timezone. | Exact-date, override, source-scoping, disabled-stream, pagination, and failure-response tests. |
| R-05 | Accounts CSV preserves signed balances, including card overpayments and manual liabilities. | Signed export regression. |
| R-06 | Manual creation, note, goal link, and goal progress commit or roll back together. | Database fault injection for annotation and goal-event writes; browser entry with persisted note. |
| R-07, R-08 | All profiles receive daily maintenance; bank work remains limited to active connections, promotion runs before snapshots, and returned promotion failures produce an alert and HTTP 207. | Manual-only discovery across pages, per-user promotion, bank-failure continuation, and explicit partial-failure tests. |
| R-10 | Reconciliation uses masked account labels and a wider responsive dialog with wrapped transaction descriptions. | Desktop inspection and a 390 by 844 phone check with no horizontal dialog overflow. |

### Reconciliation contract

The first new statement requires a user-supplied end-of-day opening balance and date.
Later statements start at the previous verified statement balance and retain uncleared activity since the original opening date.
Existing reconciliation records have no verified `basis` and are preserved as history rather than treated as trusted opening balances.
Current bank balances do not enter the calculation.
A nonzero difference requires explicit adjustment consent.
The save RPC locks the account and transaction inputs, checks the preview revision, and commits clearing, adjustment, and statement history together.
A stable request UUID makes an unchanged retry return the original result; reusing the UUID with different input is rejected.
Clients cannot create verified statement history or update/delete records.
A column-limited legacy insert remains owner/MFA/revocation-gated for compatibility with the deployed form; these rows never anchor the new workflow.
The preview RPC enforces ownership, MFA, and session revocation, and write RPCs are service-role only.

### Verification and rollout

The full local unit suite passes: 468 files and 5,165 tests.
Coverage is 97.93% statements, 95.07% branches, 98.42% functions, and 99.17% lines, with the existing 95% thresholds unchanged.
Lint, typecheck, production build, and palette validation pass.
The dependency audit reports zero vulnerabilities.
Every repository migration applies to a new isolated PostgreSQL 17 database, and both `scripts/check-rls.sql` and `scripts/check-financial-writes.sql` pass.
The migration CI job now runs those financial write assertions on its actual local Supabase stack.
The native local database uses minimal stand-ins for Supabase-owned auth/storage schemas; application policies and functions come from the actual migrations.
Browser verification used the real local Next.js app, PostgREST, application routes, and database writes, with a test-only local auth response for the seeded user.
This verifies the financial workflow, not hosted Supabase Auth or deployment configuration.
The durable `tests/e2e/reconciliation.spec.ts` journey requires explicitly matching isolated `TEST_SUPABASE_URL` and app database configuration; that full Supabase Auth fixture suite was not run in this environment.

The user-authorized database rollout applied the two new atomic-write migrations, a follow-up ownership lookup grant, and five missing predecessors on 2026-09-07.
Two already-applied migrations were mapped to the repository versions after exact stored-SQL comparison.
The live ledger matches all 84 local versions, live RLS and authorization checks pass, and deployed function definitions match the isolated database.
[TODO.md](../TODO.md#deployment-prerequisite) owns the current rollout state.
Dependency maintenance updates Supabase JS to 2.116.0 and Lucide to 1.42.0.
ESLint 10 is outside the installed `eslint-plugin-react` 7.37.5 peer range, and TypeScript 7 is outside the installed `@typescript-eslint/parser` 8.67.0 range (`>=4.8.4 <6.1.0`), so those majors remain deferred.
Nodemailer 10 is already covered by the previously observed PR #164.

## Recommendation

Prioritize reconciliation and calendar correctness before expanding the feature set.
The application already has substantial planning, reporting, recurring, and investment functionality.
The largest remaining opportunity is making those capabilities agree, handle failures explicitly, and recover safely.

## Original confirmed defects

Evidence labels distinguish browser observations, executable route probes with mocked services, and source/schema analysis.
P1 means a high-priority correctness or data-integrity defect; P2 means a material follow-up.
Six temporary route probes reproduced the behaviors described below without connecting to a database.
Their assertions deliberately confirmed the present incorrect behavior; they were removed from the normal test suite afterward.

### R-01, P1: Adjustment saves fail after partially recording reconciliation

**Evidence: source/schema analysis and a fault-injected route probe.**
[`app/api/accounts/reconcile/route.ts`](../../app/api/accounts/reconcile/route.ts), lines 275-302 and 330-340, persists cleared flags, inserts an `account_reconciliations` row, then inserts the adjustment into `transactions` using the cookie-bound client.
`transactions` has no authenticated insert policy; the dedicated [manual transaction route](../../app/api/transactions/manual/route.ts) explicitly uses an owner-scoped service client for this reason.
Under the repository's intended schema, choosing a nonzero adjustment fails with RLS after earlier writes have committed.
The isolated probe confirmed that the statement insert precedes the rejected transaction insert and the response is 500.
That probe simulated the RLS rejection; no production adjustment was attempted.

**Fix:** perform ownership validation, cleared-status changes, statement insertion, and adjustment insertion inside one narrowly authorized database transaction.
Do not solve this by granting general browser insert access to provider transaction rows.
Give saves an idempotency key so a retry cannot create another statement or adjustment.
**Acceptance:** an authenticated browser save with a nonzero adjustment succeeds against an isolated database; an injected final-write failure leaves every table unchanged; retrying the same save creates exactly one result.

### R-02, P1: Reconciliation compares historical statements to today's balance

**Evidence: source analysis and read-only browser preview.**
[`app/api/accounts/reconcile/route.ts`](../../app/api/accounts/reconcile/route.ts), lines 38-49, always loads `current_balance`; the requested statement date only bounds transaction selection.
[`lib/reconcile.ts`](../../lib/reconcile.ts), line 72, calculates `bookBalance - statementBalance` independently of cleared and outstanding transactions.
The save route repeats that calculation at lines 325-328.
A correct statement ending at $1,000 followed by a later $100 purchase can therefore show a false $100 discrepancy and offer a fabricated adjustment.
The live preview confirmed that checking a transaction changes the cleared/outstanding totals while leaving the difference unchanged.

**Fix:** define a statement-date reconciliation basis using an opening/reconciled balance and the relevant ledger movements, including explicit treatment of outstanding entries.
Use the same calculation in the preview and save, and refuse adjustment when the necessary balance basis is unknown.
Changing the statement date must invalidate or reload its transaction working set.
**Acceptance:** later transactions do not change the result for an earlier statement; outstanding items are accounted for; an unavailable balance never becomes an actionable $0 balance.

### R-03, P1: Calendar subscriptions publish invented bill dates

**Evidence: executable calendar-route probe.**
[`app/api/calendar/[token]/route.ts`](../../app/api/calendar/%5Btoken%5D/route.ts), lines 70-80, sets every stream's starting date to the current month's 15th.
It does not load `predicted_next_date`, `user_amount`, manual recurring items, or scheduled one-off entries.
A fixture due September 9 with a corrected amount of $20 was emitted on September 15 for $10.
Weekly and biweekly dates also inherit the artificial anchor, so refreshing in a new month can shift the recurrence pattern.
The visible Settings contract describes upcoming bills and paydays, not estimated mid-month placeholders.

**Fix:** adapt the shared recurring occurrence model used by Dashboard and Recurring to the calendar serializer, including overrides, supported sources, and stable occurrence identities.
Retain the token's amount-sharing permission and explicit owner scope.
**Acceptance:** recurring page and subscribed calendar agree on dates and amounts across month boundaries, weekly/biweekly schedules, corrected amounts, dismissed items, and scheduled entries.

### R-04, P1: A failed cleared-status read can erase reconciliation flags

**Evidence: executable read-route probe and source analysis of the subsequent save.**
[`app/api/accounts/reconcile/route.ts`](../../app/api/accounts/reconcile/route.ts), lines 109-121, ignores errors from `transaction_annotations` and treats missing data as an empty set.
The probe returned HTTP 200 and `cleared: false` after an injected annotation read failure.
If a user saves that apparently valid preview, `syncClearedStatus()` unmarks in-scope rows absent from `cleared_ids`, at lines 225-232.
A transient read failure can therefore become a persistent loss of previously cleared flags.

**Fix:** fail the preview when any required input fails and require a complete, current working set for saves.
Replace the unpaged transaction/annotation reads with bounded pagination or explicit overflow refusal, so a partial result is not treated as the whole statement.
**Acceptance:** annotation failure yields an error and no enabled save; existing cleared flags survive; a large statement cannot silently omit entries.

### R-05, P2: Account CSV exports reverse credit-balance signs

**Evidence: executable export-route probe.**
[`app/api/export/accounts-csv/route.ts`](../../app/api/export/accounts-csv/route.ts), lines 44-46, applies `Math.abs()` to credit and loan balances.
A card with a $25 overpayment, represented as `-25`, exports `25`.
The CSV has no separate field preserving the credit's direction, so a consumer can interpret money owed to the user as debt.
This disagrees with the signed balance handling in [`lib/account-balance.ts`](../../lib/account-balance.ts).

**Fix:** preserve signed provider balances or export an explicitly documented signed net-worth contribution alongside the raw balance.
**Acceptance:** positive debt, negative card credits, and checking overdrafts retain their economic meaning when exported and re-aggregated.

### R-06, P2: Manual transaction creation silently drops failed notes or goal links

**Evidence: executable manual-entry route probe.**
[`app/api/transactions/manual/route.ts`](../../app/api/transactions/manual/route.ts), lines 64-84, calls the annotation route but ignores its returned HTTP status.
The probe injected an annotation response of 500; transaction creation still returned 201.
A failed goal lookup, annotation write, or goal-event write can therefore be hidden behind a successful creation response.

**Fix:** make transaction creation and requested metadata persistence atomic where possible, using a shared domain operation instead of invoking another HTTP handler.
If partial success remains possible, return the created transaction ID and an explicit recoverable metadata error; do not encourage recreating the transaction.
**Acceptance:** injected annotation/goal failures never produce an unqualified success, and recovery does not duplicate the ledger entry.

### R-07, P2: Scheduled-entry promotion failures are silently discarded

**Evidence: source analysis.**
[`lib/scheduled-promotion.ts`](../../lib/scheduled-promotion.ts), lines 42, 60, and 78, returns `{ promoted, failed }` on database errors instead of throwing.
[`app/api/cron/sync/route.ts`](../../app/api/cron/sync/route.ts), lines 223-225, discards that result through `runOptionalSync()`, which only handles exceptions.
Consequently the documented failure logging does not happen for these errors, and an otherwise successful cron response says `ok: true` while due entries remain unpromoted.

**Fix:** inspect and propagate the result into the cron's failure summary, operational alert, and promotion counts.
Keep deterministic transaction IDs for retry safety.
**Acceptance:** failures during selection, insertion, and status advancement are observable; successful retries converge without duplicate transactions.

### R-08, P2: Manual-only users miss recurring daily maintenance

**Evidence: source/call-site analysis.**
[`app/api/cron/sync/route.ts`](../../app/api/cron/sync/route.ts), lines 210-218, discovers users only through active `plaid_items`.
The same per-user loop owns daily account snapshots, monthly net-worth snapshots, recurring refresh, planning notifications, and digests.
Manual-only users, and users whose last bank becomes inactive, do not receive those steps.
Manual-account writes capture a daily snapshot separately, but that does not provide the periodic maintenance or monthly snapshot backstop.
Scheduled promotion is already outside the bank-only loop, which demonstrates that the application supports this user category.

**Fix:** separate bank synchronization from maintenance for eligible application users, with pagination and per-step failure isolation.
**Acceptance:** a manual-only fixture receives snapshots and eligible alerts without any Plaid calls; a broken connection does not suppress unrelated maintenance.

### R-09, P2: Manual liabilities are reconciled as assets

**Evidence: executable reconciliation-route probe.**
[`app/api/accounts/reconcile/route.ts`](../../app/api/accounts/reconcile/route.ts), lines 53-66, omits `account_type` and hardcodes `liability: false` for every manual account.
Manual accounts explicitly support `account_type: "liability"`.
The probe confirmed a manual liability returns asset direction `-1`, reversing cleared/outstanding movement and the proposed adjustment direction.

**Fix:** load the manual account type and use the shared liability classifier.
**Acceptance:** equal Plaid and manual liability fixtures produce equal reconciliation signs.

### R-10, P2: Reconciliation account selection remains ambiguous and cramped

**Evidence: signed-in production UI and source analysis.**
The dialog exposes two indistinguishable `CREDIT CARD` options even though the Accounts list distinguishes them by mask.
[`app/accounts/page.tsx`](../../app/accounts/page.tsx), lines 334-336, passes only `account.name` into the selector.
At the desktop viewport inspected, the narrow dialog squeezes account, date, and balance into three columns; the account and date text are visibly clipped.
The transaction list also heavily truncates raw descriptors.

**Fix:** use the shared account label helper with masks, a wider responsive reconciliation layout, and readable transaction dates/descriptions.
**Acceptance:** duplicate account names remain distinguishable; account, date, and balance are fully readable at desktop and phone widths; keyboard navigation and focus restoration still work.

## Engineering improvements

1. **Run application/database contracts in CI against an isolated Supabase stack.**
   The migration workflow already starts local Supabase and checks schema policies, but it does not execute route behavior against those policies.
   Reconciliation mocks permit the very insert that RLS forbids.
   Extend that existing foundation with authenticated adjustment, rollback, ownership, session-revocation, and MFA tests.
   The E2E workflow passes login credentials but not the service credentials required by the disposable-fixture financial journeys, so those journeys skip there.
   Keep production credentials out of this job and fail if its required journeys unexpectedly skip.

2. **Reconcile migration history by content, then enforce deployment prerequisites.**
   The live ledger read still showed seven local-only versions (`20260902220000`, `20260903010000`, `20260904000000`, `20260904120000`, `20260905100000`, `20260905110000`, `20260905120000`) and two remote-only versions (`20260903171727`, `20260903171733`).
   This proves history divergence, not that every corresponding schema effect is absent.
   Inspect actual policies, functions, triggers, and backup tables before applying or repairing history.
   The canonical deployment caveats remain in [TODO.md](../TODO.md#deployment-prerequisite).

3. **Finish consolidating financial adapters.**
   Calendar delivery and account CSV are concrete examples where separate adapters bypass corrected recurring and balance semantics.
   Prefer shared domain inputs with output-specific serialization, backed by cross-surface contract tests.
   Consolidate only proven duplication; avoid a broad framework rewrite.

4. **Keep dependency work in focused changes.**
   The registry check found newer `@supabase/supabase-js` 2.116.0 and `lucide-react` 1.42.0, plus major ESLint 10, Nodemailer 10.0.1, and TypeScript 7 releases.
   There are currently zero reported dependency vulnerabilities.
   Open PR #164 already covers a Nodemailer 10 update, so inspect and update that work rather than opening a duplicate.
   These versions were inspected, not installed or compatibility-certified by this review.

## Features worth adding

These extend capabilities already present and do not require a new external data provider.
Ranked by user impact and confidence, with financial correctness as the prerequisite.

| Priority | Feature | Why it is useful | Concrete first delivery |
| --- | --- | --- | --- |
| 1 | Recovery center | Backups exist, but `backupRestore` is still disabled by default. Recovery is unfinished product value. | Inspect an archive, show completeness and missing receipt assets, preview changes, then atomically restore supported user-authored configuration with a rollback-tested workflow. |
| 2 | Unified review inbox | Monitor, transaction duplicate review, transfer linking, recurring review, and reconciliation distribute outstanding work across pages. | One owner-scoped list of existing actionable items with a reason, relevant transactions, next action, and persistent resolution; reuse existing actions and dismissal state. |
| 3 | Explain this total | Users need to understand differing snapshot dates, account scope, excluded transfers, currencies, and unknown balances. | Add a compact provenance panel to net worth and spending showing the as-of date, included/excluded accounts, currency treatment, and a matching ledger drill-through. |

Existing [Monitor](../../components/dashboard/MonitorView.tsx) already has attention items, safe-to-spend, runway, and paycheck tiles.
Existing forecasting already has presets and three assumption-based scenarios.
Do not build duplicate versions of those features under new names.
Market benchmarks and FX conversion remain dependent on an appropriate provisioned data source, as recorded in the existing roadmap.

## Suggested delivery order

1. Reconciliation contract and atomic persistence: R-01, R-02, R-04, R-09, and R-10, with a real database/browser regression.
2. Calendar parity and signed account export: R-03 and R-05, with output-contract fixtures.
3. Reliable partial-failure handling and maintenance coverage: R-06, R-07, and R-08.
4. CI integration coverage and migration-history reconciliation.
5. Recovery center, then the review inbox and total explanations.

## Original review verification and limits

- Local and remote `main` matched the reviewed SHA.
- `npm run test:unit`: 465 files and 5,146 tests passed.
- Six isolated route probes passed while asserting the current erroneous behaviors documented above.
- Lint, typecheck, production build, and palette validation passed.
- `npm audit`: zero reported vulnerabilities.
- `npx npm-check-updates`, open PR/issue inspection, and `supabase migration list --linked` completed.
- Production browser inspection sampled Dashboard, Accounts, and the unsaved reconciliation preview; it was not an exhaustive responsive or accessibility audit.
- No destructive integration suite, production save, real archive restore, calendar subscription mutation, or production security exploit test was performed.
- Source/schema findings are not represented as production mutation reproductions.
- App code, dependency manifests, and migrations are unchanged by this review.
