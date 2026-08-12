# Frontend Review: Full Repository and Analysis Method

Date: 2026-08-11

## Verdict

The previous review contains many valid findings, but it is not ready to use as an implementation backlog without revision.

The main problem is evidence quality rather than coverage.
The review mixed confirmed defects, conditional defects, open questions, performance observations, accessibility debt, and disproven claims under the same severity headings.

This version separates those categories, corrects the scope statement, and orders the work by what a user actually reaches.

Every BUG and HIGH finding below was re-read at its cited location on 2026-08-11 and each one held.
Where that pass changed a claim, a severity, or a citation, the change is recorded in the finding itself and listed under "Verified non-issues and retractions".
The Validation record states what that pass did and did not cover.

The priority order is by reachability first, then by consequence.
Defects a user meets on ordinary navigation outrank latent gates that need a second failure to open.

1. Fix Reports currency correctness.
2. Preserve dashboard household scope.
3. Fix the inverted liability change sign.
4. Repair the active GoalWizard defects.
5. Fix BudgetPlanner month divergence.
6. Stop re-inserting goal-reached notifications.
7. Make the export privacy gate fail closed.
8. Reduce unnecessary ledger projection work without weakening complete-ordering behavior.

## Scope and inventory

The inventory was generated from the repository rather than inferred from the earlier report.

- `components/` contains 171 files: 166 TSX files and five TypeScript files.
- `app/` contains 29 route files matching `page`, `layout`, `loading`, `error`, and `not-found` conventions.
- `app/` contains 33 total non-API files when globals, manifest, favicon, and the auth callback are included.
- The review includes client-facing `lib/` helpers and the API routes that define the frontend data contracts.
- Next.js 16 conventions were checked against the local guides in `node_modules/next/dist/docs/`.

The phrase “all frontend files” therefore means all 171 component files, all 29 route files, the additional non-API app files, and the client-facing data and UI helpers.
It does not mean that every API route is a frontend file, but API routes are included when they define behavior that the UI promises to users.

## How I would analyze the frontend

### 1. Establish the product and route map

Start with `docs/HANDOFF.md`, the current roadmap, the shell, and the route tree.
Record each route's authentication state, server or client boundary, primary user task, URL state, data sources, mutations, and error boundary.

For each page, answer these questions before reading individual components:

- What can an unauthenticated, authenticated, MFA-pending, and household member user see?
- Which state comes from the URL, the server, local component state, or browser storage?
- Which actions mutate the database, call an API route, call a provider such as Plaid, or only change local presentation?
- What is the expected result after a successful mutation, a non-OK response, a network failure, a refresh, Back, Forward, and a repeated click?

This prevents a component-level observation from being classified without its route and data-flow context.

### 2. Build a source inventory and dependency map

Use `rg --files` to inventory files and `rg` to find route imports, feature flags, URL builders, Supabase queries, fetch calls, browser-storage reads, and shared UI primitives.

Trace every important value from its source to its rendered output and back through its mutation path.
For financial surfaces, include the projection, currency, ownership, household scope, pagination, sorting, and export path in the trace.

Trace server-rendered data separately from client state.
Any value duplicated from props into state gets an explicit stale-state check when the route changes without a full remount.

Trace every identifier used in a React key, HTML `id`, database join, optimistic update, and notification deduplication key.
Names and display labels are not stable identifiers.

### 3. Validate the framework boundary

Check the local Next.js 16 guidance before changing or judging route code.
Confirm that `searchParams` and route parameters are handled according to the installed version, that server-only modules stay server-only, and that client components do not accidentally move sensitive queries into the browser.

Check `proxy.ts` for authentication, MFA step-up, static assets, manifest, service worker, and API behavior.
Page-local guards are not required when the proxy demonstrably protects the route, but API handlers still need their own authorization and ownership checks.

### 4. Test the user journey before assigning a bug

For every suspected bug, reproduce the closest end-user sequence in an E2E test or a browser session before labeling it a BUG or HIGH.

Use disposable users and deterministic finance fixtures.
Exercise both empty and populated states, failure responses, slow responses, repeated clicks, reloads, client navigation, Back and Forward, and household scope where applicable.

Run the primary routes at 375, 430, 768, and 1440 pixels in light and dark themes.
Check collapsed and expanded shell states, keyboard navigation, focus restoration, and browser console noise.

If automation passes while a user reports an unstyled or broken page, inspect the user's browser Network panel before claiming a server defect.
Automation does not load browser extensions, so a passing Playwright or `curl` run rules out some server failures but does not reproduce extension blocking.

### 5. Validate data and mutation contracts

For every mutation, verify all of the following:

- The request body matches the route contract and has bounded, validated input.
- The response status is checked before local state is treated as saved.
- Network failures are caught and announced.
- Optimistic state has a rollback or an explicit pending state.
- Success refreshes or reconciles every visible server-rendered value affected by the mutation.
- A repeated submission cannot duplicate, reuse, or partially apply the operation.
- Ownership, household scope, and RLS behavior are preserved through every query.

For every export, report, chart, and total, compare the visible row set with the underlying query.
Check currency partitioning, date boundaries, pending-row behavior, truncation, and the selected scope.

### 6. Review accessibility and visual quality as behavior

Check programmatic names, label associations, heading structure, landmark names, table headers, dialog semantics, focus entry, Escape handling, focus return, keyboard operation, reduced motion, contrast, and non-color cues.

Check responsive layout with real content, long merchant names, large amounts, empty states, error states, multiple currencies, and household data.

Review charts for readable axes, direct labels or a table twin, stable colors, surface contrast, and a truthful time range.
Pairwise color separation and surface contrast are separate requirements.

### 7. Classify evidence before severity

Use these evidence labels in the review:

- Confirmed: source tracing and a focused test or direct reproduction demonstrate the behavior.
- Likely: source tracing demonstrates a credible failure path, but the end-user sequence still needs a focused reproduction.
- Conditional: the behavior exists only behind a disabled feature flag, legacy path, or unusual configuration.
- Open question: the concern depends on framework, provider, or database behavior that has not been verified.
- Verified non-issue: the earlier claim was disproven by source, route protection, tests, or the actual contract.

Only confirmed defects should lead the active BUG and HIGH backlog.
Likely findings belong below them with a reproduction task.
Conditional findings should not be presented as normal production failures.

Severity is based on user impact, data integrity, privacy, security, reachability, and reproducibility.
It is not based on how easy the change appears.

## Confirmed active findings

### BUG and HIGH priority

#### 1. Export privacy checks fail open on profile-query errors

Evidence: `lib/export.ts:27-47`.

`isExportAllowed` and `fetchPrivacySafeRows` ignore the error returned by the profile `.single()` query.
When the profile query fails or returns no row, `profile?.ai_export_enabled !== false` evaluates to true.

This is a privacy gate, not merely a stale UI state issue.
The shared helper is used by CSV, JSON, report, accounts, investments, and AI-related export paths.

Reachability: latent, not currently observed.
Opening the gate requires a missing profile row or a failing profile query, and several callers (`app/api/export/report/route.ts`, for one) pass the service client, where an RLS-denied read is not the failure mode.
It stays on the list because the fix is a few lines and the failure direction is the wrong one for a privacy control, not because a user is hitting it today.

Fix: treat a profile-query error or missing profile as a failure, and make every export route fail closed with an explicit error response.
Add direct tests for profile `false`, profile `true`, profile `null`, and profile-query error cases.

#### 2. GoalWizard can create a duplicate goal after allocation failure

Evidence: `components/goals/GoalWizard.tsx:147-217`.

`finish` inserts the goal before posting the account allocation.
If the allocation fails, the wizard stays open with the draft intact and only refreshes the route.
The next click inserts another goal before retrying the allocation.

The message at `GoalWizard.tsx:200-205` already tells the user the goal was created and only the link failed, so wording is not the gap.
The gap is that nothing prevents a second insert from the same draft.

Fix: close or reset the wizard after the goal insert succeeds, or record the created goal id in the draft and reuse it instead of inserting again.

#### 3. Pay-down goals discard the entered target, and complete instantly without a linked account

Evidence: `components/goals/GoalWizard.tsx:157-172`, `lib/goals-v2.ts:95-103,171-184,242-246`, `app/api/goals/accounts/route.ts:121-129`, and `app/goals/page.tsx:72-108`.

This is two defects on one path, and both are deterministic rather than occasional.

First, `goalTargetAmount` computes a pay-down target as `starting_balance - target_balance` and never reads `target_amount`.
The wizard writes `target_balance: 0` for every pay-down goal, so the target is always the full captured balance.
A user who asks to pay down 5,000 of a 12,000 loan gets a 12,000 target, and the amount they typed is discarded even when the account link succeeds.

Second, `starting_balance` is captured only by the allocation route, and `allocationMode` defaults to `"none"` in the wizard draft.
Creating a pay-down goal without linking an account therefore leaves `starting_balance` null, which makes the target zero, and `badgeFor` returns `"completed"` when the target is not positive.

Fix: require a linked liability and persist its starting balance, or block pay-down creation until the required data is available.
Decide explicitly whether a pay-down target is "pay it all off" or "pay off the amount I entered", and make `target_balance` reflect that choice instead of a hardcoded zero.
Add an E2E test that creates a pay-down goal and verifies its initial balance, target, and status.

#### 4. BudgetPlanner can display one month while saving another

Evidence: `components/budget/BudgetPlanner.tsx:255-315` and `app/budget/page.tsx:201`.

The component copies the initial monthly view into state and does not reconcile that state when the `month` prop changes during client navigation.
An edit can therefore render the old month while the PUT request writes to the new month.

Fix: key the planner by the month, scope, and currency, or derive the displayed monthly view from the current props without duplicating the source of truth.
Test same-segment navigation between two months followed by an edit.

#### 5. Reports CSV omits the selected currency filter

Evidence: `app/reports/page.tsx:93-110,225-252`, `lib/reports.ts:481-497`, and `app/api/export/report-csv/route.ts:40-73`.

The page partitions the visible report by currency, but `reportFiltersToSearchParams` does not add the selected currency to the CSV export parameters.
The route then loads the date and other filters without the selected currency and emits a single unlabeled amount column.

This can place differently denominated values in one CSV even though the page tells the user that totals are separated by currency.
The CSV does not sum currencies; it combines rows that should have been excluded.

Fix: carry currency through the export URL and apply the same currency filter used by the page.
Add a mixed-currency export test that asserts the CSV contains only the selected currency's rows.

#### 6. Export toggle reports success when the database write fails

Evidence: `components/settings/ExportSection.tsx:19-29`.

The toggle ignores the profile update error and always updates local state.
The checkbox, badge, and export-link appearance can therefore disagree with the stored privacy setting.

Fix: check the update result, only commit local state on success, and expose a theme-aware error with an alert announcement.

### HIGH priority correctness and reliability

#### 7. A successful Plaid connection leaves a spent link token in client state

Evidence: `components/ConnectBankButton.tsx:70-145`.

After success, the component clears persisted resume data but retains `linkToken` and `resume` in React state.
The next connection attempt can reuse the single-use token and open Plaid with a completed session.

The OAuth query parameter is also not removed after the resume is consumed.
A later reload can show a false “Bank connection expired” message because the saved resume is gone.

Fix: clear token, resume state, and the OAuth intent after success or terminal failure.
Handle `onExit` explicitly and make the URL cleanup part of the resume lifecycle.
The spent-token reuse is the headline defect; the earlier cancellation and automatic-reopen claim should not be treated as the primary finding without a direct reproduction.

#### 8. The transactions page performs unnecessary complete projection work

Evidence: `app/transactions/page.tsx:160-210` and `lib/ledger-data.ts:16-31`.

The page fetches the complete matching ledger projection even on direct database-sort paths where the projection is only used to populate filter controls.
The work is repeated by refresh behavior and can fail the page when one chunk fails.

Do not solve this by silently capping the complete projection.
Merchant, category, and account sorting must process the complete filtered display projection before pagination, or the ordering becomes incomplete.

Prefer skipping the full projection on direct date and amount paths, loading filter facets with distinct or aggregate queries, pushing projected sorting into SQL where practical, and exposing explicit truncation if a hard bound is unavoidable.

#### 9. Dashboard household scope is dropped by common navigation paths

Evidence: `app/dashboard/page.tsx:136-184`, `components/dashboard/MonthChips.tsx:34-47`, `components/dashboard/DashboardToolbar.tsx:72-100`, and `components/dashboard/CardCarousel.tsx:70-79`.

The page reads household scope and loads scoped data, but the shared navigation parameters omit `scope` outside the scope control itself.
Changing the view, month, account, or card can silently return the user to personal data.

Fix: thread scope through the shared dashboard URL builder and test every dashboard navigation control in household mode.

#### 10. Credit and loan month changes use the wrong sign and color

Evidence: `lib/accounts-page.ts:259-267` and `components/accounts/AccountGroup.tsx:35-55`.

Credit and loan balances are displayed as absolute values, but their month changes are rendered with the asset convention.
`displayBalance` absolutes the snapshot series that feeds `monthChange`, and `AccountGroup` colors any change of `>= 0` as success.
Growing debt therefore appears green and paying debt down appears red, on every accounts page visit with liability history.

Fix: negate the change or invert the sign and color convention for liability groups.
Keep the behavior aligned with the signed net-worth series in `lib/accounts-page.ts:368-389`, which already uses `-Math.abs(balance)` for credit and loan snapshots.

#### 11. Household account institution metadata can be lost

Evidence: `app/accounts/page.tsx:180-201,285-305`.

Account queries can follow a household member while the `plaid_items` lookup remains scoped to the owner user.
The member's accounts then lose institution metadata, and the institution filter can omit them.

Fix: resolve institution items for the same account scope or use a household-aware item query with explicit ownership checks.
Add a household fixture with accounts from both users and test the institution filter.

#### 12. Goal-reached notifications re-insert on every run

Evidence: `lib/notifications.ts:63-76` and `lib/notifications.ts:145-153`.

`createNotification` dedupes by testing whether an existing notification's title or body contains `subjectKey`.
The goal caller passes `goal.id`, a UUID, while the text it builds contains `goal.name` and the formatted target.
The substring test can therefore never match, so the dedupe window is inert and the notification is inserted again on every run that still sees the goal as reached.

This was previously filed as a medium.
It is a repeating, user-visible defect on a scheduled path, which puts it above the accessibility and labelling work below.

Fix: dedupe on a stored subject column or a unique `(user_id, type, subject_id)` key rather than on rendered text.
The net-worth milestone block at `lib/notifications.ts:156-160` already does this with a unique `(user_id, key)` constraint and is the pattern to copy.

### Follow-up audit, not yet a finding

Several mutation handlers may classify failures inconsistently across `components/settings/BudgetsSection.tsx`, `components/settings/CategoryOverridesSection.tsx`, `components/transactions/BulkTagBar.tsx`, `components/transactions/SavedViewsBar.tsx`, `components/settings/ProfileSection.tsx`, `components/notifications/PushSection.tsx`, and `components/goals/GoalsManager.tsx`.

The earlier “about 20 handlers have no catch” claim was too broad and has been withdrawn.
The files represent different cases: no exception handling, non-OK responses without network catches, intentional rollback, silent background-load failures, and handlers that already report errors.

Nothing here is actionable until the audit runs, so it is listed as work rather than as a defect.
For each handler, record whether a non-OK response is checked, whether network failure is caught, whether optimistic state is rolled back, and whether the user is told what happened.
File the real failures as individual findings, then decide whether a small shared request helper is justified.

## Confirmed medium findings

### Reports, dashboard, and data correctness

- `app/reports/page.tsx:225-231` links PDF export to `/api/export/report`, which uses the weekly report period rather than the active report filters.
- `lib/notifications.ts:61,89,111-208` lets a notification failure abort later notification work because the blocks are not isolated.
- `components/dashboard/MonitorView.tsx:75` maps anomaly severity `info` to `danger`, because the ternary only special-cases `warning`.
  The `info` severity is produced by the category-spike branch at `lib/planning.ts:479-484`.
  An earlier draft of this review cited `lib/dashboard.ts:75`, which contains no severity mapping at all.
- `components/dashboard/MonitorView.tsx:169,176` passes the identical `currentNet - previousNet` delta to both the Net worth tile and the Monthly cash flow tile, so the net-worth tile reports a cash-flow change.
- `components/dashboard/widgets/InvestmentsWidget.tsx:43` and `components/investments/TopMovers.tsx` label `periodChangePct` as “Top movers today”.
  `lib/investments.ts:33` documents that value as the price change over the available history, not a day or a fixed 30-day window.
- `components/dashboard/CardNetworkLogo.tsx:20` defaults an unidentified network, including `apple` and `generic`, to VISA.
  The inline comment says this is deliberate because the current accounts are all Visa, so treat it as a latent assumption to revisit when a non-Visa card is added rather than as a present defect.
- `app/api/cron/sync/route.ts` and `lib/investments.ts:216-226` do not create ongoing snapshots for manual holdings, so the latest chart point can diverge from the current total.

### Transactions and accessibility

- `app/transactions/page.tsx:429-552` renders the mobile list and the desktop table simultaneously and hides one with CSS, so `components/transactions/MobileLedgerList.tsx:67` and `app/transactions/page.tsx:533` both mount `TransactionEditor` for the same rows.
  That duplicates `note-<id>`, `tags-<id>`, and `cats-<id>` in the document, and a label can bind to the hidden copy.
- `components/transactions/TransactionEditor.tsx:147-284` lacks dialog focus management and `aria-labelledby`.
- `components/transactions/AddTransactionModal.tsx:114-164` does not programmatically associate its fields with labels.
- `components/transactions/TransactionSortMenu.tsx:98-118` uses an open `dialog` without modal focus behavior.
- `app/transactions/receipts/page.tsx:16-20` and `lib/receipt-data.ts:116-125` let one signed-URL failure take down the receipt inbox.
- `lib/import.ts:27-69` does not strip a UTF-8 BOM before detecting CSV headers.
- `app/transactions/page.tsx:319-323` calculates a day net from the current page slice and does not give it a currency boundary.

### Budget, cash flow, accounts, and investments

- `app/settings/page.tsx:279-284` reads four months of transaction history with no `.limit()`, so the row count is whatever the PostgREST `max-rows` setting allows.
  It does not load 20,000 rows as previously claimed.
  The specific 1,000-row figure is unverified: it is the Supabase default, but this project's setting has not been checked.
  Either way the defect is silent truncation, which can produce incomplete or wrong budget suggestions for a large history.
  Fix this with SQL aggregation by category and month, not an unannounced client-side cap, and confirm the configured limit while doing so.
- `components/settings/ManualAccountsSection.tsx:164-181` shows an "Include in net worth" checkbox whose only save path is a button labelled "Save balance", and recomputes `includedTotal` from the unsaved local state.
  The checkbox value *is* persisted, by `saveAccount` sending `includeInNetWorth`, so the earlier "not persisted by that action" wording was wrong and the HIGH severity was too high.
  The real defect is that nothing tells the user the toggle needs saving while the header total already reflects it.
  Fix: persist the toggle on change, or relabel the button and mark the total as unsaved.
- `components/budget/SeedBudgetButton.tsx:168-179` can corrupt decimal input during controlled editing.
- `components/budget/BudgetTable.tsx:74-81` can save sort order `0` when the field is cleared.
- `components/cash-flow/BreakdownBars.tsx:28-44,87` can collide with a real category named `Other`.
- `lib/forecasting.ts:175-179` treats manual asset accounts as cash for yield and disagrees with the net-worth planner's liability model.
- `app/budget/page.tsx`, `app/cash-flow/page.tsx`, `app/forecasting/page.tsx`, and `app/recurring/page.tsx` contain UTC-derived current-month or today anchors that can cross a local date boundary.
- `lib/accounts-page.ts:481-488` now recomputes filtered group totals, but any future filtered change display must also be verified against the surviving rows.
- `components/investments/TopMovers.tsx:13` uses `name-ticker` as a key, which can collide when a security exists in multiple accounts.

### Goals, settings, and shared UI

- `components/goals/GoalWizard.tsx:232-234` lacks dialog focus movement, trapping, and restoration.
- `components/goals/GoalCardMenu.tsx:174-175` and `components/recurring/RecurringList.tsx:138` use menu roles without complete menuitem semantics or keyboard behavior.
- `components/notifications/InAppPreferences.tsx:43-67` has no busy state on Save, so repeated clicks can issue overlapping upserts.
- `components/ui/Select.tsx:10` removes the native select arrow without supplying a replacement cue.
- `components/settings/TagsSection.tsx:50-70` refreshes the server but does not reset local state after rename or merge.
- `components/settings/ProfileSection.tsx:105-108` hides the avatar file input in a way that is not keyboard accessible.
- `components/settings/SessionsSection.tsx:17-31` and `components/settings/HouseholdSection.tsx:20-45` have no per-action busy guard.
- `components/SignupForm.tsx:58-59,67-68` does not wire Email and Password fields to their labels like `components/LoginForm.tsx` does.
- `components/shell/UserMenu.tsx:79-115` and `components/goals/GoalCardMenu.tsx` need complete menu keyboard semantics.
- `components/shell/MobileNavigation.tsx:101-112` lacks Escape handling and focus return to the trigger.

## Conditional findings and open questions

### GoalsManager stale edit draft is a latent kill-switch-path defect

Evidence: `components/goals/GoalsManager.tsx:51-56,286-313`.

The row initializes its edit draft once and can overwrite a newer contribution when the user edits the same row later.
However, `app/goals/page.tsx` evaluates `goalsV2` as enabled by default in `lib/feature-flags.ts:34`, and the legacy manager is only reachable when that flag is turned off.

Keep this as a conditional defect for the legacy kill-switch path, not as an active production BUG.
If the flag is used operationally, add a legacy-path E2E test before changing the component.

### MFA cancellation behavior needs provider verification

`components/settings/MfaSection.tsx:127-143` raises a concern about cancelling an unverified factor.
The concern is not a confirmed defect until Supabase behavior is verified with the installed SDK and a disposable factor.
Keep it in an open-questions list rather than the confirmed findings.

### Card branding is a visual correctness issue, not a HIGH data defect

`lib/card-design.ts:49-87` matches broad words such as `gold` and `preferred`.
This can choose the wrong design for some names, but `components/dashboard/CardCarousel.tsx:112-136` hides the generated display name whenever institution artwork exists.

The accurate finding is that the matcher can assign the wrong fallback design or network when artwork is absent.
Classify it as MED or LOW visual correctness and constrain premium-brand matches by issuer or institution.

## Verified non-issues and retractions

- The notifications page is protected by `proxy.ts:148` and its missing page-local guard is not a defect.
- Recreating an inline callback in `ReconnectBankButton` is not itself a bug.
- The CSV does not sum different currencies; the confirmed issue is that the selected currency is omitted from the export filter.
- The earlier claim that the Settings page loads 20,000 rows is disproven; the query has no `.limit()` and is bounded by the PostgREST `max-rows` setting, whose configured value is still unverified.
- The GoalWizard allocation-failure message already states that the goal was created, so "the UI must say so" was not a real gap; only the duplicate insert is.
- The manual-account inclusion checkbox is persisted by `saveAccount`, so the earlier "not persisted by that action" claim was wrong and the item has moved from HIGH to MED.
- `lib/dashboard.ts:75` contains no anomaly severity mapping; the `info` to `danger` collapse lives at `components/dashboard/MonitorView.tsx:75`.
- The investments "today" label is a real mislabel, but it is not a 30-day window; `periodChangePct` covers the available history.
- The earlier recommendation to cap the complete ledger projection is unsafe because display-value sorting must process the complete filtered result before pagination.
- `ledgerDatabaseOrder` amount-direction behavior is intentional and covered by tests.
- The Next.js 16 `searchParams` Promise handling is valid for the installed framework.
- `app/layout.tsx` service-worker registration is valid because `public/sw.js` exists and Plaid Link is loaded on demand.

## Validation record

The prior focused validation run passed 59 unit tests across export, Plaid, ledger, reports, card design, goals, and budget behavior.
That result supports the reviewed paths, but it does not prove that every finding is fixed or that every browser journey has passed.

On 2026-08-11 every BUG and HIGH finding was re-read at its cited location, along with the file inventory and a sample of the medium bullets.
The inventory numbers were reproduced exactly: 166 `.tsx` plus five `.ts` files under `components/`, and 29 route files under `app/`.
That pass was source tracing only.
It confirms that each cited line says what the finding claims, and it does not replace the end-user reproduction each BUG and HIGH still needs.

The next implementation pass should reproduce each BUG and HIGH in E2E, add a focused regression test, then run the repository gate:

```text
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run validate:palette
git diff --check
```

Run the affected Playwright journey against disposable data after the unit and build checks.
Do not claim a finding is resolved until the end-user sequence, the focused regression, and the relevant route state have all been rechecked.

Separate tooling note: the installed Vercel CLI is 58.9.1 while 58.9.4 is available.
Upgrade with `npm i -g vercel@latest` or `pnpm add -g vercel@latest` when Vercel CLI compatibility matters.
