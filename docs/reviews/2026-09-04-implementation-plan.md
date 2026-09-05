# FundFlow review implementation plan

Prepared September 4, 2026, Pacific time.
This is the implementation handoff for the [comprehensive review](2026-09-04-comprehensive-review.md).
It proposes fixes; none of the application changes below were performed as part of the review.
Finding IDs refer to the companion document and are the completion checklist.

## Starting point and working rules

Reviewed local commit: `4b554e03f92c5aa7d8142891041731cce3bbda2e`.
Reviewed production/main commit: `652ced2013a51e89a3d3464c8829b8c5adce53fa`.
The trees were identical during the review.
Re-check current HEAD, production SHA, feature flags, and linked schema before implementing because this document is a dated snapshot.
Read `AGENTS.md`, `CLAUDE.md`, and the relevant installed Next.js guides before changing application code.
Use a `codex/` branch and preserve unrelated work.

For each bug, first reproduce the user journey in an isolated environment with synthetic fixtures, as closely as possible to the real browser observation.
For direct-data security issues, an actual Auth session and PostgREST/Storage request is the relevant end-to-end boundary, rather than a mocked helper call.
Do not attempt the security reproduction against the personal production account.
Do not run a writing integration suite merely because `.env.local` happens to contain working credentials.

Prefer the existing financial-domain and export contracts over a new parallel calculation layer.
Use integer minor units or the repository's established money helpers consistently at persistence boundaries.
Do not add ad hoc floating-point comparisons for transfer or restore integrity.
Document any behavior change in the living documentation with the same patch that establishes it.
Do not manually modify generated changelogs or overwrite archived reviews.

Each work package should produce a reviewable patch, focused tests, a browser acceptance record where relevant, and an honest list of unverified deployment conditions.
Avoid one enormous change that combines access-control migrations, financial-model changes, a visual redesign, and major dependencies.
There is no requirement to replace the stack or adopt a new provider to complete this plan.

## Priority and dependency map

| Package | Finding IDs | Priority | Dependency / release condition |
| --- | --- | --- | --- |
| A: Safe test and migration baseline | FF-30, FF-31 | P2, prerequisite | Must precede writing database/E2E tests or schema repair. |
| B: Authoritative session enforcement | FF-01, FF-02, FF-04 | P1 | A; deployed access-matrix verification required. |
| C: Consent and bounded rule execution | FF-03, FF-06, FF-07 | P1/P2 | A; can proceed independently of visual work. |
| D: Recoverable data and deletion | FF-05, FF-08, FF-09, FF-10 | P1/P2 | A; B protects new cleanup/status operations. |
| E: Financial source of truth | FF-11, FF-12, FF-13 | P1 | A; AI delivery also depends on C and F. |
| F: Supported AI provider behavior | FF-29 | P1 | C; model capability verification before rollout. |
| G: Transaction workflow and drilldowns | FF-14, FF-15, FF-16, FF-23 | P2 | A; canonical contracts from E where shared. |
| H: Dashboard and planning honesty | FF-17, FF-18, FF-19, FF-20, FF-21, FF-22, FF-25 | P2 | E; G provides coherent ledger drilldowns. |
| I: UI hierarchy and security history | FF-24, FF-26, FF-27, FF-28 | P2/P3 | B/D/G/H define truthful states and actions. |
| J: Living docs and dependency maintenance | FF-32, FF-33; final FF-30 gate | P2/P3 | Documentation accompanies every package; final reconciliation after all. |

Start A immediately and keep it narrow enough that it does not delay security fixes.
B, C, D, E, and F are the first substantive remediation sequence.
A visual improvement may ship separately, but should not be used to declare the underlying financial/security work complete.

## A. Establish a safe behavioral test baseline and reconcile migrations

**Scope:** FF-30 and FF-31.

**Files:** `tests/setup.ts`, `tests/integration/`, `tests/e2e/` fixture configuration, `.github/workflows/ci.yml`, migration-check workflow, `scripts/check-rls.sql`, `supabase/migrations/`, `README.md`, and `docs/QA.md`.

1. Add an explicit integration/E2E environment contract that rejects the known production project and does not fall back to `.env.local` for destructive fixtures.
2. Support a local Supabase stack or dedicated disposable test project with separate credentials and deterministic cleanup.
3. Keep `npm run test:unit` free of external writes and document the distinction from `npm test` if the latter includes integration work.
4. Create users A and B, two sessions for A, an AAL1 session, an AAL2 session for an MFA-enrolled user, and household sharing fixtures.
5. Add real data-API tests alongside structural SQL checks.
6. Make the high-severity dependency-audit check blocking instead of appending `|| true`.
7. Record the exact local-only and remote-only migration versions listed in the review.
8. Compare their SQL to deployed functions, columns, grants, constraints, and policies using read-only metadata.
9. Rehearse clean migration replay and an upgrade from the actual prior schema before creating a forward-only repair migration or intentionally repairing ledger entries.
10. Document why each ledger repair is correct; matching filenames or an existing column alone are insufficient evidence.

**Acceptance:** A mistaken production URL makes the integration harness refuse to run before any write.
A clean test database and the upgrade fixture reach equivalent expected schema state.
Tests verify user B cannot access A's private resources, permitted household reads still work, and service-only operations remain service-only.
The pipeline fails when a synthetic high-severity audit result or intentionally weakened policy is introduced in the test harness.
Remove those negative-control changes before merging.

**Useful existing coverage:** `tests/integration/rls.test.ts`, `tests/integration/roadmap-rls.test.ts`, `tests/integration/receipts-rls.test.ts`, and `tests/integration/account-snapshot-rls.test.ts`.
Add an explicit session/MFA matrix suite rather than assuming these existing tests cover it.

## B. Make revocation and MFA authoritative across access paths

**Scope:** FF-01, FF-02, and FF-04.

**Files:** a new forward migration under `supabase/migrations/`, `app/api/settings/sessions/route.ts`, `lib/http.ts`, `lib/session-revocation.ts`, `lib/mfa.ts`, `lib/step-up.ts`, `lib/rate-limit.ts`, `proxy.ts`, and `scripts/check-rls.sql`.
Inspect all routes using service-role clients as part of the access matrix.

### Reproduction before implementation

In the isolated environment, log in as A on two sessions and revoke the first from the second.
Verify whether the old token can update `revoked_at` or delete its row through the data API, then read a protected table.
For MFA coverage, use A's genuine pre-step-up session to query each sensitive table directly.
Record allowed/denied results for SELECT, INSERT, UPDATE, DELETE, Storage reads/writes, and callable RPCs.
Never infer enforcement from a redirected page alone.

### Implementation

1. Separate session activity metadata from authoritative revocation state, or enforce immutable revocation with a narrowly privileged interface.
2. Revoke browser-role writes that allow clearing or deleting revocation evidence.
3. Give heartbeat creation/update a dedicated operation bound to `auth.uid()` and the JWT session ID.
4. Ensure heartbeat cannot overwrite revoked state and cannot manufacture another session's identity.
5. Authorize revocation of a target session from an active permitted caller and retain tombstones for the necessary token lifetime.
6. If using Auth-provider session invalidation, verify the exact supported API and token invalidation semantics instead of assuming a database marker revokes a refresh token.
7. Add a common restrictive security policy to sensitive tables while preserving ordinary owner/household policies.
8. Review every permissive policy because policy OR composition can leave alternate paths open.
9. Define minimal exceptions required for login, MFA enrollment/challenge, and session bootstrap; exceptions must not expose financial data or allow revocation reversal.
10. Apply equivalent checks to private storage and privileged RPCs, including owner validation inside service-role entry points.
11. Treat failed assurance/revocation checks as temporarily unavailable for protected operations and return an actionable response.
12. Give rate limiting an explicit policy by use case: security and paid-provider actions should not silently bypass limits when storage is unavailable.

**Acceptance:** A revoked token cannot restore itself, create a substitute unrevoked record, or read/write protected data through any tested path.
A still-active second session remains usable and can view appropriate device history.
AAL1 cannot access protected data for an MFA-enrolled user; AAL2 can.
Users without MFA can still use the intended AAL1 flows.
Household sharing remains intact only for its documented fields/actions.
Database/RPC errors produce denial or temporary unavailability rather than authorization success.
Concurrent heartbeat and revocation always leave the session revoked.

**Tests:** Extend `tests/unit/session-revocation.test.ts`, `tests/unit/http-session-revocation.test.ts`, `tests/unit/api-settings-sessions.test.ts`, and the real-token matrix introduced in A.
Use a local browser session to confirm meaningful error/recovery messaging without exposing security internals.

**Rollout:** Deploy schema and compatible server code in a sequence that never temporarily re-enables browser mutation of revocation state.
Have an active recovery/admin path in the test rehearsal, but do not solve a failed rollout by disabling RLS in production.
Verify the exact deployed policies and perform safe controlled test-account acceptance after deployment.

## C. Enforce consent and bound merchant-rule computation

**Scope:** FF-03, FF-06, and FF-07.

**Files:** `app/api/ai/receipt/route.ts`, `lib/ai-gate.ts`, `lib/export.ts`, `lib/ai-provider.ts`, `lib/rules-engine.ts`, `lib/planning.ts`, `app/api/rules/batch/route.ts`, and the Settings export/receipt descriptions.

### Consent and payload contract

Introduce one reusable consent decision for AI-bound data.
Reuse or refactor the existing fail-closed preference reader rather than constructing another independent boolean expression.
The result must distinguish denied, missing/unavailable preference, and allowed.
An absent profile or failed query must never reach a provider call.
Make the meaning of an existing row with a null preference explicit and consistent with the documented export setting; do not accidentally change legacy semantics without a migration decision.

Separate raw user-requested ledger export from provider-bound analysis.
Describe the latter as minimized data, not anonymous data.
Define which merchant descriptors are cleaned, which original values remain in the user's ledger, and which receipt data is transmitted.
Do not send account identifiers, token material, notes, or uncontrolled extra fields because a spread operator happens to include them.
Give the disabled receipt control a direct link to the relevant Integrations preference.

**Consent tests:** Existing preference allowed/denied, missing profile, missing AI settings, each query failure, unavailable provider, and cancellation.
For every non-allowed outcome, assert the provider stub received zero calls and no image bytes.
Test representative synthetic bank descriptors with embedded references and preserve ordinary merchant names.
Use `tests/unit/ai-gate.test.ts`, `tests/unit/ai-routes-and-push.test.ts`, and receipt route tests.

### Regex contract

Reproduce the accepted expression from FF-06 in a child process with a hard deadline.
Choose a non-backtracking implementation that supports the intended user features, or replace unrestricted regex with a documented small safe grammar.
If compatibility requires rejecting existing rules, report the specific rule as needing review and skip it safely rather than blocking the whole ledger.
Validate both at rule save time and at evaluation time because historical stored rules bypass new input validation.
Bound candidate input length and rule-count work.
If native JavaScript regex remains anywhere, isolate it behind a cancellable worker with a deadline; a Promise timeout cannot interrupt a synchronous regex on the same event loop.

**Regex acceptance:** Adversarial optional/repetition/alternation cases finish within the specified worker or non-backtracking bound, ordinary supported patterns retain behavior, invalid historical rules do not break finance pages, and batch simulation returns a useful error.
Extend `tests/unit/rules-engine.test.ts` with bounded runtime regressions and test the save-to-ledger browser journey in the isolated project.

## D. Guarantee complete recovery and make deletion resumable

**Scope:** FF-05, FF-08, FF-09, and FF-10.

**Files:** `lib/user-data.ts`, `lib/restore.ts`, `lib/backup.ts`, `app/api/export/takeout/route.ts`, `app/api/cron/backup/route.ts`, `app/api/backup/restore/route.ts`, `scripts/restore-backup.mjs`, `.github/workflows/backup.yml`, `app/api/account/route.ts`, avatar/receipt storage routes, and a new forward migration if persistent job state is needed.

### Complete archives

1. Inventory user-owned schema and stored objects against `USER_DATA_TABLES`.
2. For every field/table, explicitly decide portable takeout, encrypted recovery, intentionally excluded secret, derived/rebuildable state, or documented unsupported state.
3. Add missing category/cash-flow overrides, rule bounds/tags, account preferences, and other discovered user decisions to the correct archive contract.
4. Include required keys and relationships in encrypted recovery without expanding the privacy-minimized takeout by accident.
5. Paginate with stable unique ordering using a supported page size and bounded concurrency.
6. Handle non-ID tables with a stable composite key rather than assuming every table has `id`.
7. Define snapshot consistency during concurrent edits: use a consistent database snapshot when feasible or a documented cutoff with reconciliation and completeness checks.
8. Include schema version, generated-at time, per-table counts, attachment counts/checksums, and completeness status.
9. Throw on any failed page or missing required section; never emit a successful partial archive.
10. Account for receipt bytes and archive-size limits without sending an oversized email attachment or silently dropping files.
11. Keep restore disabled until validation, ownership rewriting, ordering, duplicate handling, and rollback behavior are proven.

**Recovery tests:** Round-trip a synthetic account with 2,505 transactions, more than one page of annotations, manual and linked accounts, split transactions, goals, rules with tags/bounds, account exclusions, recurring links, and receipt files.
Assert exact counts, relationships, checksums, user preferences, canonical totals, and idempotence after a repeated restore.
Inject an error on page two and assert that no successful archive is published.
Test old archive versions, missing foreign keys, another user's IDs, corrupt ciphertext, and partial storage failure.
A decryptable JSON file is not the acceptance criterion.

### Reliable backup delivery

Persist a delivery key such as user plus backup period plus archive version.
Claim jobs atomically and record archive-generated, delivery-attempted, delivered, and failed states without logging financial content.
Return an explicit partial-failure outcome that the workflow treats as actionable.
Retry only unfinished jobs and retain useful sanitized failure reasons.
Test one failing recipient among several successful recipients and confirm retries do not resend the successful ones.

### Account deletion

Reproduce deletion with an avatar and receipt in the isolated account.
Inventory private object prefixes, relational data, Plaid removal, and deliberately retained audit metadata.
Create a resumable deletion state that blocks new writes once deletion begins and preserves the minimum encrypted cleanup information until external removals succeed.
Delete Storage objects through the Storage API, not by deleting storage metadata rows.
Track actual Plaid successes instead of counting attempts.
Only delete the Auth identity once required cleanup is complete, or establish a durable cleanup worker that can finish afterward without losing access to required state.
Present pending/failed/completed deletion truthfully and document retention exceptions.
Support step-up for each supported sign-in method, including a clear path for users without a password.

**Deletion acceptance:** Avatar ownership no longer blocks completion, receipt bytes are removed, failed provider cleanup is retryable, duplicate requests are idempotent, and success is never shown before the promised scope is complete.
Inject failures at each boundary and inspect persisted state after retry.
Ensure cleanup cannot target another user's object prefix or account.

**Tests:** Extend `tests/unit/user-data.test.ts`, `tests/unit/backup.test.ts`, `tests/unit/backup-restore-route.test.ts`, `tests/unit/restore-backup-script.test.ts`, and dedicated isolated storage/deletion integration coverage.

## E. Establish consistent financial summaries and a conserved forecast model

**Scope:** FF-11, FF-12, and FF-13.

**Files:** `lib/net-worth.ts`, `lib/dashboard.ts`, `lib/account-balance.ts`, `lib/forecasting.ts`, `lib/forecasting-data.ts`, `lib/finance-domain.ts`, `lib/finance-query.ts`, `lib/ai-insights.ts`, `lib/ai-provider.ts`, `lib/export.ts`, `app/api/ai/insights/route.ts`, `app/forecasting/page.tsx`, and `components/dashboard/widgets/NetWorthWidget.tsx`.

### Current and historical net worth

Define a shared summary contract containing value by currency, assets, liabilities, as-of/coverage information, excluded accounts, and missing/stale balances.
Use it consistently in Accounts, Dashboard, Forecasting inputs, and snapshot writing.
Keep a historical snapshot explicitly historical instead of silently substituting it for a current balance summary.
Respect inclusion preferences for linked and manual accounts.
Abort snapshot writes after source errors or explicitly store an incomplete status that no consumer renders as a complete figure.
Do not convert absent balances to zero.
Do not add different currencies without a disclosed conversion policy and dated rates.

**Net-worth acceptance:** With identical scope, all three screens show identical current values to the cent.
An excluded account stays excluded after snapshot refresh.
A failed account query cannot write a zero/partial snapshot.
Mixed currencies remain separated unless a separately approved conversion contract exists.
A stale historical point displays its actual date.
Test negative bank balances, positive card credit balances, liabilities, missing balances, manual accounts, and user preferences.

### Forecast contract

Make the meanings of cash contribution, debt principal payment, interest, investment contribution, and return explicit before changing the formula.
Use the existing canonical flow classification to derive baseline income/expense data.
Count one economic debt payment once, rather than both sides of an internal transfer.
Keep observed negative net cash flow instead of turning it into zero savings.
Choose complete historical periods or visibly explain partial-period weighting.

Either define the savings input as cash remaining after all funded payments, or deduct funded debt/investment payments from the appropriate cash source in the model.
Do not combine pre-debt savings with unfunded debt reduction.
Expose the derived monthly-expense assumption used by emergency-fund and other milestones; if there is insufficient history, require a visible assumption instead of silently using $3,000.
Display projection incompleteness, excluded assets, unavailable balances, and currency scope.
Treat growth rates and milestone assumptions as editable scenarios, not guaranteed outcomes.

**Conservation tests:** With $1,000 cash, $500 debt, zero income, zero returns, and a $100 principal payment funded from cash, the next state is $900 cash and $400 debt, leaving net worth unchanged at $500.
A two-sided $100 bank/card payment contributes $100 to the payment estimate, not $200.
A recurring $200 monthly deficit reduces forecast cash under zero-return assumptions.
Emergency targets vary with the visible monthly-expense input.
Insufficient history produces a labeled assumption state rather than a fabricated personalized default.
Add these cases to `tests/unit/forecasting.test.ts`, `tests/unit/forecasting-data.test.ts`, and `tests/unit/forecasting-render.test.ts`, then verify the same scenarios through the browser.

### Insight aggregation

Keep raw export rows separate from an insight aggregate type that preserves semantic flow.
Define payload fields for period boundaries, currency, user/household scope, completeness, income, expense, transfers, refunds, and top merchants/categories.
Use the same canonical projection and financial aggregation as the matching screen.
Apply C's consent and text-minimization policy before invoking a provider.
Generate deterministic fallback wording from the actual supplied period, never from a fixed This month string over six months of data.

**Insight acceptance:** Linked transfers and loan payments do not become expense, refunds follow canonical behavior, privacy-disabled requests never call the provider, and the fallback totals match Cash Flow for the same period and scope.
Test six-month data with only one selected month, empty months, current incomplete month, mixed currencies, and explicit truncation.
Extend `tests/unit/ai-insights-lib.test.ts`, `tests/unit/ai-insights-route.test.ts`, and `tests/unit/ai-provider-lib.test.ts`.

## F. Repair the AI provider contract and degradation behavior

**Scope:** FF-29.

**Files:** `lib/ai-provider.ts`, `app/api/ai/ask/route.ts`, `app/api/ai/receipt/route.ts`, environment validation, AI route tests, `docs/TODO.md`, `docs/ARCHITECTURE.md`, and `CLAUDE.md`.

Read the current official provider model/capability documentation before choosing an explicit supported model.
Centralize Anthropic client construction and model selection.
Represent thinking and structured-output capabilities deliberately, rather than sending the same options to any environment-selected model.
Validate unsupported configuration at a clear boundary and surface an operationally useful sanitized error.
Do not silently switch providers or send data to a new destination.

Define route-specific behavior: Insights can return a labeled deterministic summary; Ask should explain temporary unavailability; Receipt scanning should retain the user's selected image for retry without claiming extraction succeeded.
Use appropriate status codes and avoid exposing provider internals or submitted receipt contents in logs.
Keep paid-provider rate limits and consent checks ahead of payload transmission.

**Acceptance:** Default and supported override configurations produce valid request shapes.
An unsupported model/configuration fails clearly before a misleading success response.
Provider timeout, quota exhaustion, invalid response, and outage yield the documented experience for each route.
A separately authorized, minimal provider smoke test confirms the selected model when available; fixture-only tests must not be described as live provider verification.

References: [model lifecycle](https://platform.claude.com/docs/en/about-claude/model-deprecations), [adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking), and [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## G. Make transaction review safe, compact, and context-preserving

**Scope:** FF-14, FF-15, FF-16, and FF-23.

**Files:** `lib/transaction-quality.ts`, `lib/ledger-projection.ts`, `app/api/transactions/transfers/route.ts`, `components/transactions/TransferReview.tsx`, `app/transactions/page.tsx`, `app/wrapped/page.tsx`, ledger filter parsing, and a forward constraint/RPC migration.

1. Reproduce a transfer whose incoming side posts one day before its outgoing side, then a duplicate confirmation attempt in two browser sessions.
2. Load candidates with stable pagination and explicit failure/incomplete handling.
3. Match within an absolute date tolerance and remove already-linked transaction IDs before generating suggestions.
4. At confirmation, re-read both rows with ownership checks and validate distinct accounts, opposite signed amounts, currency, date tolerance, and permitted state.
5. Enforce one-use-per-transaction atomically, including use on either side of a link.
6. Write the link and decision together, and make repeated identical confirmation idempotent.
7. Replace the first-screen cards with a compact review-count action and a queue showing account, merchant, date, amount, currency, and why the pair was suggested.
8. Provide Link, Dismiss, and an appropriate undo/unlink path with clear consequences.
9. Show fetch/save errors and refresh affected ledger/summary data after success.
10. Replace the Plaid-centric sign help with the actual displayed convention and ensure import preview clearly identifies its source sign convention.
11. Add the selected year's start/end to annual category/merchant drilldowns using the ledger's supported filter schema.
12. Preserve those filters through pagination, sorting, detail return, and export.

**Acceptance:** The first mobile viewport provides access to search or real ledger rows without scrolling past three repetitive cards.
Every suggestion provides enough source context to decide without guessing.
Two concurrent confirmations cannot reuse a transaction or leave a decision without a link.
A failed write leaves previous financial state intact and displays a retryable error.
A yearly category click opens exactly the year/category whose total was clicked.
Displayed expense/income signs and their help text agree.

**Tests:** Extend `tests/unit/transaction-quality.test.ts`, `tests/unit/transactions-transfers-route.test.ts`, `tests/unit/transfer-linking.test.ts`, and `tests/unit/wrapped-page-ui.test.ts`.
Add persisted-state integration tests for races and browser coverage at 390 by 844 and desktop widths.

## H. Make dashboards and planning screens state their limits honestly

**Scope:** FF-17 through FF-22 and FF-25.

**Files:** `lib/dashboard-widgets-data.ts`, `components/dashboard/OverviewView.tsx`, dashboard widget components, `app/dashboard/page.tsx`, `app/budget/page.tsx`, `components/budget/BudgetPlanner.tsx`, `lib/goals-v2.ts`, `app/review/page.tsx`, `app/wrapped/page.tsx`, and the Cash Flow/recurring data loaders.

### Dashboard scope and coverage

Pass a shared explicit account/household/date scope to cumulative spend and other affected loaders.
If a widget is intentionally global, label that exception next to its title and explain why.
Reuse investment balance-only coverage from the detailed Investments page instead of telling users with known accounts to add another one.
Carry recurring stream direction into the widget and distinguish expected income, upcoming payments, overdue items, and unavailable predictions.
Make the window label match the query: next seven days and this month are different promises.
Distinguish recent connection success from old account-balance data in summary badges.

**Acceptance:** Select one account with a unique synthetic expense and verify every in-scope card excludes the other account's expenses.
Change month and household scope and verify totals, labels, and drilldowns together.
An investment account without holdings displays a known balance with an itemization limitation.
Incoming recurring salary/interest is never labeled a bill due.
Overdue streams remain discoverable.
An old balance does not acquire a fresh as-of date merely because a sync attempt succeeded.

### Budget, goals, and period states

Show the active month/year or horizon prominently beside navigation.
When no budget is configured, provide a clear setup state and reviewed historical suggestions rather than implying zero left to budget is a completed plan.
Use unknown/unconfigured states for goal pace and budget review.
Explain goal allocations as recorded planning amounts, not bank transfers.

Label current periods month-to-date or year-to-date and identify the observed-through date.
Compare equivalent elapsed periods where useful, keeping full historical periods available.
Do not clamp a legitimate negative savings rate to make it look better.
Introduce an explicit reviewable classification for ambiguous credits only after tracing the current canonical refund/transfer behavior and preserving user overrides.

**Acceptance:** Keyboard navigation announces the active budget period.
A goal with no contribution history says it lacks pace data.
An account with no budgets receives a setup prompt instead of a healthy-budget assertion.
A current-year recap identifies its partial period, and zero-income savings rates remain undefined rather than misleading percentages.
A nonzero but small income denominator retains mathematically correct results with context.

## I. Edit the UI around the user's task

**Scope:** FF-24, FF-26, FF-27, and FF-28.

**Files:** `components/accounts/NetWorthHero.tsx`, `components/accounts/AccountRow.tsx`, account display-name helpers, Settings section composition, `components/settings/ImportSection.tsx`, `components/settings/ImportReviewSection.tsx`, `components/settings/SessionsSection.tsx`, `components/settings/AuditLogSection.tsx`, Reports/Advice presentation, and shared layout/button components only where necessary.

### Accounts

Reduce the default hero height and show the first meaningful account row promptly.
Add dated chart context, useful axis labels or an accessible table, and explain whether the chart is current value or historical snapshots.
Choose one primary history visualization and place secondary detail behind a disclosure.
Use one account-name formatter for account rows, filters, import selectors, transfer review, and exports where display names are intended.
Retain original source names in inspectable detail.

### Settings and imports

Make preview-first import the primary entry.
Keep sign/date/account selection in the same flow, followed by duplicate review and a final summary of rows to be imported.
If a fast path remains, make it an explicit secondary mode with equivalent safety guarantees.
Link missing AI consent to Integrations rather than using above/below positional instructions.
Separate routine data tools from account destruction and avoid oversized primary buttons on wide forms.
Use status messages that survive network failures; do not leave save/remove operations with an unhandled rejection and no feedback.

### Security history

Extend the view model with last-active/created timestamps and readable device/browser information already available from session metadata.
Keep the raw user-agent only in expandable detail if useful.
Render audit events through a small event-description mapping with timestamp, result, and sanitized relevant values.
Unknown event types should still have a safe readable fallback.
Do not invent location, claim a browser string uniquely identifies a device, or expose IP/token details by default.

### Navigation and emphasis

Make daily review, transaction search, and bank-health recovery easy to find.
Explain the different purposes of Cash Flow and Reports or consolidate overlapping controls where the contracts truly match.
Keep Advice action summaries short with explanations on demand.
Use one visually dominant action per section and a bounded reading width.
Retain the palette and successful mobile Settings section selector.

**Visual acceptance matrix:** Desktop 1440 by 900, mobile 390 by 844, narrow mobile 320 pixels, and 200 percent zoom.
Check light and dark themes in an isolated session, keyboard-only navigation, visible focus, Escape/focus return for dialogs, screen-reader labels, reduced motion, long account/merchant names, empty data, loading, stale data, and failed requests.
No horizontal page overflow, clipped primary action, inaccessible icon-only control, or hidden error is acceptable.
Axe and palette checks supplement manual interaction; they do not replace it.
Save only synthetic/redacted visual fixtures in the repository.

## J. Reconcile documentation and refresh dependencies deliberately

**Scope:** FF-32, FF-33, and the final FF-30 delivery gate.

**Living-document ownership:** `README.md` describes setup and user-visible capability; `docs/ARCHITECTURE.md` describes implemented contracts; `docs/TODO.md` tracks unfinished work; `docs/HANDOFF.md` records exact operational state and next action; `docs/QA.md` documents evidence-based validation.
`CLAUDE.md` should express rules the code actually follows or clearly identify a required invariant being repaired.

1. Replace the retired-model claim and align provider-construction descriptions with F.
2. Update receipt documentation to match supported upload, retention, consent, and recovery behavior.
3. Correct webhook bypass wording against the current route and flags.
4. Replace unsupported full-backup/recovery claims with the tested contract from D.
5. Fix the moved restore-document reference and distinguish decrypting an archive from restoring an account.
6. Document the isolated integration-test environment and credential refusal behavior from A.
7. Update migration/deployment status only with exact current evidence.
8. Rewrite overconfident QA diagnostics as hypotheses with corroborating checks.
9. Correct feature-flag comments that imply all defaults are enabled when specific flags are disabled.
10. Add a lightweight link/contract check for current docs without rewriting historical archives.

Run dependency freshness again when this package starts.
First review compatible minor/patch candidates, including Playwright, Supabase JS, Supabase SSR, Anthropic SDK, and Lucide.
Treat zero-major version changes as potentially breaking despite their small numbers.
Handle Vitest/coverage together and keep TypeScript, ESLint, Plaid, and Nodemailer major upgrades in separately reviewable changes.
Read official migration notes for each major and record skipped incompatible upgrades rather than forcing the toolchain through.
Never infer that an SDK upgrade fixes a retired model name.

Upgrade the outdated Vercel CLI using `npm i -g vercel@latest` or `pnpm add -g vercel@latest` when performing deployment-tool maintenance.
Measure regional latency before proposing an app/database region move.
A region change needs before/after request traces and rollback planning, not an assumption based only on a map.

**Acceptance:** Current-document links resolve, security and financial claims agree with implemented tests, dependency audit has no unaccepted high/critical findings, and every changed package passes its compatibility checks.
A clean install reproduces the validated lockfile state.

## Verification and completion ledger

The review baseline passed lint, typecheck, 4,770 unit tests across 438 files, production build, configured palette validation, and the dependency audit.
That is baseline evidence, not acceptance for the proposed patches.

Run focused tests for the changed contract first.
For a completed application package, use the repository gates:

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run validate:palette
npm audit --audit-level=high
git diff --check
```

Run the relevant isolated integration and browser suites under A's explicit environment guard.
After code changes, run `graphify update .` as required by the repository, keeping generated graph output uncommitted.
Do not broaden testing against production merely to replace missing test fixtures.

| Release area | Required evidence before marking its findings complete |
| --- | --- |
| Session/MFA | Real-token access matrix, revocation race tests, deployed policy verification. |
| Consent/AI | No-call denial/error tests, supported request shape, honest provider-smoke status. |
| Regex | Bounded adversarial execution plus a working saved-rule browser journey. |
| Backup | Multi-page completeness and full round-trip state/object verification. |
| Deletion | Failure-injected resumable cleanup with verified object/provider completion. |
| Finance | Cross-screen equality and conservation/refund/transfer/currency invariants. |
| UI | Synthetic browser acceptance at stated sizes, keyboard and error-state review. |
| Migrations | Clean replay, upgrade rehearsal, exact linked ledger and schema evidence. |
| Docs/dependencies | Resolved current links, matched behavior claims, clean install and required gates. |

For every FF ID, record the fixing commit, test evidence, browser evidence where relevant, migration version if any, deployed SHA, and any remaining limitation.
If a finding becomes inapplicable because current code changed, record the source evidence and close it as superseded rather than silently deleting it.
Do not mark an entire package complete while a required acceptance condition remains untested.

## Final acceptance scenario

Using only an isolated account, connect or fixture two accounts, import reviewed history, classify a transfer, inspect the same scoped numbers in Dashboard/Accounts/Cash Flow, establish a budget and goal, inspect forecast assumptions, generate an allowed insight, create and recover a complete backup, revoke a second session, and finally delete the isolated account with files attached.
At each step, verify both what the user sees and the persisted state.
The result should be a product whose summaries agree, whose uncertainty is visible, whose security controls cannot be undone by the token they are meant to stop, and whose recovery/deletion promises are demonstrably true.
