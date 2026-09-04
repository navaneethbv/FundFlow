# FundFlow UI Review and Monarch Feature Comparison

## Executive summary

FundFlow's primary desktop workflows are operational and visually coherent.
Dashboard navigation, global search, transaction search, Cash Flow, Reports, Accounts, Goals, Debt, Settings, and the command palette all worked during the authenticated read-only review.
The product is not yet ready to be treated as fully Monarch-parity or as uniformly trustworthy for forward-looking financial decisions.
The largest risks are inconsistent recurring totals across FundFlow surfaces, a forecast debt-payment default that can exceed current liabilities by several multiples, invented defaults in a second forecasting simulator, and stale or unavailable investment holdings.

The overall release verdict is **ship with fixes**.
Routine account and transaction review appears usable.
Recurring planning, debt forecasting, and FIRE projections need remediation before their outputs should guide financial decisions.

## Audit boundary

The review was performed on September 3, 2026 in the user's authenticated Chrome session.
FundFlow and Monarch were inspected side by side using the user's real account data.
The production review was strictly read-only.
No transaction, recurring item, budget, goal, account, institution, setting, or Monarch record was created, edited, linked, dismissed, or deleted.

This document deliberately omits personal account balances, account identifiers, merchant names, transaction descriptions, goal values, and screenshots.
Only the minimum aggregate comparisons and technical conclusions needed to implement fixes are retained.
No live-data screenshot should be committed to the repository.

The visual review covered the desktop layout at approximately 1918 by 870 pixels.
The review also used the accessibility tree to inspect names, roles, states, and navigation targets.
A complete mobile pass, keyboard-only pass, automated accessibility scan, browser console review, network trace, and Core Web Vitals capture were not available in this session.
Those checks remain required before final release sign-off.

## Audit snapshot

- Local branch: `feat/ledger-strip-account-picker`.
- Local commit: `329c853c63c8d7c133f5e594d5ea1410e83a5d11`.
- FundFlow surface: authenticated production application at `fund-flow-swart.vercel.app`.
- Monarch surface: authenticated Monarch Money web application.
- Comparison period: September 2026 unless a page used a different built-in range.
- Repository state before documentation: clean.

The local commit was recorded for source traceability only.
It was not independently proven to be the exact production deployment commit.
An implementation agent must resolve the deployed commit before using a source line as conclusive production evidence.

## Method and evidence grading

The review used three evidence levels.

- **Confirmed** means the behavior was reproduced in the live UI and, where relevant, matched a current source path.
- **Data or provider dependent** means the UI exposed a real discrepancy, but its root cause may be account coverage, consent, upstream availability, sync timing, or persisted configuration.
- **Product choice** means Monarch has a capability that FundFlow intentionally excludes or should add only after a separate privacy, security, or product decision.

Monarch was used as a comparator, not as an unquestioned correctness oracle.
Monarch also displayed at least one obviously implausible goal-timing message during the review.

## What worked in FundFlow

### Application shell and navigation

- Sidebar navigation loaded the expected destinations without broken routes.
- The four dashboard views, Overview, Monitor, Plan, and Wealth, were reachable.
- The command palette found Cash Flow and navigated to it successfully.
- Query state for the dashboard view survived a reload.
- Loading and empty states were generally legible and consistent with the dark visual system.

### Transactions

- The transaction ledger loaded thousands of real records.
- Merchant search returned a filtered result set and a visible filter chip.
- Sorting, filters, columns, receipts, schedules, notes, splits, and saved-view controls were present.
- The apparent plain-text `Save this view` control is a working button implemented by `components/transactions/SavedViewsBar.tsx`.
- No evidence showed that saved views are broken.

### Cash Flow and Reports

- Cash Flow supported monthly, quarterly, and yearly horizons.
- Cash Flow supported category, group, and merchant dimensions.
- Charts exposed accessible data-table alternatives.
- Reports included Cash Flow, Spending, and Income views.
- Reports included breakdown and trend modes, date ranges, pending-state controls, dimension controls, sort field and direction, CSV export, PDF export, and saved reports.
- The sort controls that were missing in an older comparison are present now.

### Accounts, Goals, and Debt

- Accounts grouped cash, credit, and investment balances coherently.
- Balance history and institution freshness were visible.
- Goals showed progress, status, target date, linked account, and allocation controls.
- Debt showed nonzero liabilities, APR assumptions, minimum-payment estimates, avalanche and snowball strategies, and payoff timing.
- The Debt page's current minimum-payment budget was internally plausible for the displayed liabilities.

### Settings and operational transparency

- Settings included profile, display, notifications, security, integrations, household, institutions, categories, merchants, rules, tags, and data controls.
- Institution health separated transaction availability from investment availability.
- Reconciliation explained when a ledger balance could or could not be calculated from a persisted anchor and complete history.
- FundFlow was more transparent than Monarch about sync health, data coverage, and fallback behavior.

## Confirmed FundFlow defects

### FND-001: Recurring money does not tell one consistent story

**Severity:** High.

The Recurring page and the Dashboard Plan bill calendar showed materially different monthly recurring income and expense totals for the same live account and period.
The gap was too large to be explained by normal display rounding.
The Dashboard builds `recurringItems` in `lib/dashboard.ts`, while the Recurring page separately expands provider and manual streams in `lib/recurring-page.ts` through `lib/recurring-data.ts`.
These paths use different horizons, matching rules, fallback dates, and credit-card-bill handling.

The result is a financial-trust defect.
A user cannot know which FundFlow total represents the expected month.

**Expected behavior:** Every FundFlow surface must consume one canonical month projection with the same as-of date, stream inclusion policy, matched-payment state, and credit-card-bill rules.

### FND-002: Recurring detection promotes refund-like inflows into expected income

**Severity:** High.

The live Recurring page classified a small merchant credit as recurring income and marked it overdue.
The UI reported that the candidate was detected from three transactions.
`lib/recurring-detection.ts` detects stable cadence and amount patterns but does not have enough account or income-category context to distinguish payroll-like income from repeated refunds or card credits.

This inflates expected income and can affect bill planning, safe-to-spend calculations, and forecast confidence.

**Expected behavior:** Locally inferred inflows must remain in a review state unless they come from an eligible depository account and match an approved income category or strong payroll signal.
Unreviewed inferred inflows must not contribute to expected-income totals.

### FND-003: Blank recurring merchant names reach the user interface

**Severity:** Medium.

The Recurring list and calendar displayed occurrences without a merchant name.
The action's accessible name was effectively `More options for `.
`lib/recurring-page.ts` falls back with nullish coalescing, so an empty string bypasses the `Unknown` fallback.

**Expected behavior:** Provider and manual display text must be normalized, trimmed, and assigned a safe fallback before it reaches sorting, action labels, exports, or calendar cells.

### FND-004: Credit-card-bill absence is hidden instead of explained

**Severity:** Medium.

The live Recurring summary omitted the Credit cards column because the synchronized bucket was zero.
`components/recurring/MonthSummary.tsx` renders the column only when its total is greater than zero.
That makes it impossible to distinguish no bills due from unavailable Liabilities data or an incomplete bill sync.

The existing phase specification says the bucket should remain empty and clearly labeled when bill data is unavailable.
The current component does not meet that contract.

**Expected behavior:** Always render the Credit cards bucket with an explicit state such as no bills due, product not enabled, provider unavailable, stale, or sync failed.

### FND-005: The forecasting debt-payment default is not a safe planning assumption

**Severity:** High.

The live Forecasting page defaulted monthly debt payment to more than four times the currently displayed liabilities and far above the Debt page's minimum-payment budget.
The projection consequently implied that current debt would disappear almost immediately.

`lib/forecasting.ts::computeForecastDefaults` takes the median monthly sum of the absolute value of every canonical transaction whose group is `LOAN_PAYMENTS`.
This measures historical cash movement rather than a future debt-payment plan.
It can also count both sides of a transfer pair and unusually large payoff activity.
The current unit coverage does not protect against paired transfer rows or a payment larger than the remaining liability.

**Expected behavior:** The default must come from the debt planner's current minimum-payment budget or an explicit persisted user assumption.
It must never imply payments beyond the remaining liability in a projection month.

### FND-006: Forecasting contains a second simulator with invented user data

**Severity:** High.

The Forecasting page correctly loads persisted life events for `LifeEventsPanel`, but the same page also renders `FireSimulator` with a separate local event model.
`components/forecasting/FireSimulator.tsx` starts with a fictional home down payment, a fictional career event, a hard-coded age, and fallback savings and spending values.
`app/forecasting/page.tsx` also invents monthly income and spend by multiplying monthly savings or by using fixed fallback amounts.

The page can therefore say that no life events are configured while simultaneously projecting two life events.
It can also present a FIRE date calculated from values the user never entered and that the app did not derive from actual income or spending.

**Expected behavior:** There must be one persisted life-event model and one clearly sourced set of assumptions.
Missing inputs must be requested or shown as unavailable, not fabricated.

### FND-007: Advice labels recommendations as user priorities

**Severity:** Medium.

The Advice page showed a `Prioritized by you` section with several items while its priority manager said that nothing had been prioritized.
`lib/advice.ts` fills the prioritized list with contextual recommendations when saved priorities are empty.
`app/advice/page.tsx` labels that combined result as user-selected.

**Expected behavior:** Saved priorities must be labeled as user priorities.
Contextual fallback items must be labeled as recommendations and must not imply a user action that did not occur.

### FND-008: Year in Money compares a partial current month with completed months

**Severity:** Medium.

The 2026 Year in Money view called the current partial month the quietest month only a few days into the month.
`lib/annual.ts` includes every positive-spend month and has no completed-month or as-of guard for this comparison.

**Expected behavior:** Comparative awards must use completed months only.
If the current month is shown, it must be labeled as partial and excluded from superlatives.

### FND-009: Internal provider outcome codes leak into Investments

**Severity:** Medium.

The Investments sync-status panel displayed the raw code `no_investment_product` for multiple institutions.
`app/investments/page.tsx` directly interpolates `item.outcome` into `Last sync: ...`.

**Expected behavior:** Provider and job outcomes must pass through a finite user-facing status map with a recovery message where an action exists.

### FND-010: Stale implementation copy remains in Budget

**Severity:** Low.

The Budget page says that goal contribution events arrive in Phase 7 even though goal contribution behavior is already implemented.
This exposes internal roadmap language and contradicts the shipped product.

**Expected behavior:** Replace phase language with timeless product copy that describes current behavior and known limitations.

### FND-011: External text normalization is not applied to every Settings surface

**Severity:** Low.

An account name in Institution reconciliation and APR settings displayed Unicode replacement characters.
The repository already has `normalizeExternalDisplayText` and uses it in Plaid ingestion, Dashboard, and Accounts.
`app/settings/page.tsx` passes raw account names into `ReconciliationSection` and `CardAprSection` paths.

**Expected behavior:** Normalize at ingestion and apply the same defensive display normalization at every external-text boundary.

### FND-012: Some dashboard labels expose raw financial-feed descriptions

**Severity:** Low.

The Monitor view's next-paycheck card displayed a long raw payroll descriptor rather than the cleaned payer name used elsewhere.
The price-drift panel also describes changes in repeat merchant charge amounts as personal inflation even when purchases may not be comparable.

**Expected behavior:** Reuse canonical merchant display names and describe unmatched amount changes neutrally.
Reserve inflation language for comparable recurring goods or services.

## Confirmed FundFlow interaction and responsiveness defects

### UX-001: Navigation has no reliable pending feedback

**Severity:** Medium, high perceived impact.

The live Forecasting to Accounts navigation took approximately 3.6 seconds in the authenticated Chrome session.
Immediately after the click, the old Forecasting DOM and URL were still visible while the request was in flight.
No `aria-busy`, progress label, spinner, or route-level pending indicator was exposed during that interval.
The page eventually navigated successfully, so this is a feedback and perceived-responsiveness defect rather than a dead link.

The Dashboard Overview, Monitor, Plan, and Wealth tabs are query-parameter Links in `components/dashboard/DashboardViewTabs.tsx` and `components/ui/Tabs.tsx`.
They do not own a pending state, and a route `loading.tsx` cannot be relied on to communicate progress for every same-segment search-parameter transition.
Goals, Investments, Debt, Forecasting, Advice, and Notifications also have no segment-level `loading.tsx` fallback.

**Expected behavior:** A click should immediately communicate that navigation was accepted, preserve the shell, mark the active transition as busy, and show a stable skeleton or progress indicator until the destination content is ready.

### UX-002: The projection action feels stalled while the request runs

**Severity:** Medium.

The Forecasting `Update projection` button took approximately 2.8 seconds in the live session.
`components/forecasting/AssumptionsPanel.tsx` renders a plain GET form button with no client pending state, spinner, disabled state, or live status message.
The result eventually loaded, but the user receives no immediate confirmation that the click was accepted.

**Expected behavior:** The form should immediately disable the submit control, show a loading icon and stable text such as `Updating projection`, announce progress to assistive technology, and restore the control if the request fails.

### UX-003: Async buttons do not share one loading contract

**Severity:** Medium, with duplicate-submission risk on some actions.

`components/ui/Button.tsx` already supports `loading`, `aria-busy`, disabled interaction, and a spinner.
The implementation uses that contract for Refresh, transaction search and filters, recurring actions, reports, imports, and several goal flows.
Other async actions only change text, disable the control without a spinner, or do not guard the request at all.

Confirmed examples include account-preference saves in `components/accounts/AccountPreferences.tsx`, audit-log refresh in `components/settings/AuditLogSection.tsx`, card APR saves in `components/settings/CardAprSection.tsx`, email-preference saves in `components/notifications/EmailPreferences.tsx`, manual holding creation in `components/investments/AddManualHoldingForm.tsx`, manual transaction creation in `components/transactions/AddTransactionModal.tsx`, demo-data actions in `components/settings/DemoDataSection.tsx`, and saved-report actions in `components/reports/SavedReportsSection.tsx`.
Several of these handlers call `fetch` and `router.refresh()` without an equivalent visible pending state.
The account-preference, audit-log, and APR handlers do not even maintain a local busy flag, so repeated clicks can issue overlapping requests.

**Expected behavior:** Every user-triggered asynchronous action must have one pending state, one disabled policy, one visible spinner or progress affordance, one accessible status announcement, and one error recovery path.
Repeated activation must be harmless and must not create duplicate writes or duplicate refreshes.

### UX-004: Loading coverage is uneven across routes

**Severity:** Medium.

Skeleton fallbacks exist for Dashboard, Accounts, Transactions, Cash Flow, Reports, Recurring, Settings, Wrapped, and Budget.
No corresponding `loading.tsx` exists for Goals, Investments, Debt, Forecasting, Advice, or Notifications.
Those data-heavy pages can leave the previous page visible during a slow server render with no destination-specific visual cue.

**Expected behavior:** Every data-heavy route must use a shared shell-preserving loading fallback, or the root loading boundary must provide an equivalent experience.
The fallback must expose `aria-busy="true"` and a meaningful destination label.

## Data, configuration, and operational gaps

### DAT-001: Transaction coverage differs materially

FundFlow showed 220 fewer total transactions than Monarch during the live comparison.
This is a current completeness signal, not proof that FundFlow's ledger UI is broken.
The two products also had different connected account coverage and may apply different pending-transaction retention rules.

The gap must be reconciled by institution, account, date, pending state, and source identifier.
No implementation should copy or overwrite transactions merely to force the totals to match.

### DAT-002: Same-period spending differs

The two Cash Flow pages showed a material expense difference for the same September period while both showed no income for the partial month.
Possible causes include missing transactions, pending-state treatment, classification overrides, account coverage, and sync timing.

The correct next step is a transaction-level reconciliation report.
It is not safe to choose either aggregate as correct without that evidence.

### DAT-003: Investment balances and holdings are stale or unavailable

Monarch displayed current security-level holdings, quantities, values, allocations, and benchmark comparisons.
FundFlow displayed investment account balances that were weeks stale and reported that the connected institutions did not provide the Investments product.
The FundFlow holdings UI exists, so this is primarily a product-consent, provider-availability, and sync-recovery gap rather than a missing table component.

FundFlow must keep its honest account-balance fallback.
It must also provide a clear action when a reconnect or expanded product consent can make holdings available.

### DAT-004: Budget and goal configuration is not aligned

Monarch had a configured budget and a differently configured emergency goal.
FundFlow's Budget page was structurally complete but had no configured budget.
FundFlow's goal target and linked balance differed from Monarch.

These are migration and configuration differences, not demonstrated arithmetic defects.
Any import must use preview, explicit conflict decisions, idempotency, and a no-overwrite default.

### DAT-005: Connected-account coverage differs

Monarch included additional credit and cash accounts that were not present in FundFlow.
This contributes to account totals, transaction counts, recurring bills, and cash-flow differences.

FundFlow should explain unsupported or missing connections by institution and account.
It must not synthesize balances for accounts it cannot access.

### DAT-006: Weekly report delivery has gaps

Notification history showed consecutive weeks with no recorded weekly-report run between successful deliveries.
The UI accurately exposed the missing state, so this is an operational reliability finding rather than a rendering defect.

The scheduler, eligibility query, idempotency key, and delivery log need investigation.

## Monarch feature comparison

| Capability | FundFlow | Monarch | Classification | Recommendation |
| --- | --- | --- | --- | --- |
| Account and net-worth overview | Implemented with history and sync transparency | Implemented with polished account cards | Parity with different freshness | Keep FundFlow's diagnostic advantage and fix stale sources |
| Transaction ledger | Search, filters, receipts, schedules, saved views, notes, splits, rules | Search, filters, receipts, bulk actions, direct field editing, retail sync | Partial parity | Add faster inline correction only after canonical override semantics are preserved |
| Cash Flow | Multiple horizons and dimensions with accessible data tables | Comparable flow reporting with richer consumer taxonomy | Partial parity | Reconcile source coverage and category mapping before changing presentation |
| Reports | Cash Flow, Spending, Income, trends, sort, CSV, PDF, saved reports | Similar reports plus Ask AI | Strong parity | Retain current reporting and treat AI as a separate decision |
| Budget | Month, year, decade, templates, history creation, rollover-oriented architecture | Fully configured flex budget in the reviewed account | Feature exists, configuration missing | Build a safe configuration import and clearer onboarding |
| Recurring list | List, calendar, review, manual items, occurrence status | Rich recurring schedule, merchant names, bills, paychecks, review queue | Capability exists, live data materially weaker | Fix canonical totals, inferred inflows, names, and bill availability first |
| Credit-card bills | Schema and sync path exist, but the live summary hides a zero or unavailable bucket | Explicit credit-card bill row sourced from credit reporting | Data and presentation gap | Show availability state and validate Liabilities consent and jobs |
| Goals | Linked-account progress, allocation, status, target | Allocation, reorder, target tracking | Parity with different configuration | Support previewed import without assuming Monarch's values are correct |
| Investments | Holdings, allocation, performance, and fallback UI exist, but live holdings unavailable | Current holdings, quantities, allocation, and benchmarks | Provider and freshness gap | Repair or reconnect where supported and keep unavailable states honest |
| Debt payoff | Avalanche, snowball, APR assumptions, and payoff plan | Less prominent in reviewed surfaces | FundFlow strength | Reuse its payment budget in Forecasting |
| Forecasting | Active net-worth scenarios, life events, FIRE simulator, what-if controls | Forecasting onboarding was not configured in the reviewed account | FundFlow feature lead with correctness defects | Unify assumptions and remove invented data before promoting this advantage |
| Weekly recap | Available through Plan and Notifications | Prominent dashboard recap | Discoverability and reliability gap | Surface recent delivery status and repair missing scheduled runs |
| Advice | Educational topics and priority manager | Prioritized advice and future-change messaging | Near parity with a labeling defect | Separate recommendations from saved priorities |
| Institution health and reconciliation | Detailed product health, coverage, repair, and ledger reconciliation | Less diagnostic detail in reviewed UI | FundFlow strength | Preserve and extend to clear recovery actions |
| Credit utilization and limits | Not shown in reviewed account views | Shown for credit cards | Missing capability | Add only from authoritative liability data and show freshness |
| Credit score | Deliberately excluded by ADR-001 | Shown on dashboard | Intentional exclusion | Do not implement without a new consent, provider, threat-model, pricing, and deletion decision |
| AI assistant | No general consumer assistant in reviewed UI | Ask AI entry points across surfaces | Product choice | Require a separate privacy, data-minimization, consent, and evaluation decision |
| Retail data sync | Not present | Present | Optional ecosystem feature | Defer unless product strategy requires receipt-level purchase intelligence |

## FundFlow strengths worth preserving

- FundFlow exposes sync health and reconciliation evidence instead of hiding uncertainty.
- FundFlow has a stronger dedicated debt-payoff workflow than the reviewed Monarch surfaces.
- FundFlow supports schedules, notes, splits, merchant rules, category overrides, and saved transaction views.
- FundFlow offers accessible chart-table alternatives and unusually broad report export options.
- FundFlow has a capable recurring calendar and life-event architecture even though current data paths need unification.
- FundFlow explicitly avoids inventing investment holdings when a provider does not supply them.
- FundFlow has a broader privacy and data-management surface in Settings.

## False positives and non-findings

- Saved transaction views are implemented and were not shown to be broken.
- Report sort controls are present.
- Dashboard query state survived reload.
- Different Monarch and FundFlow goal values are configuration differences.
- Different budget values are configuration differences.
- Credit score is intentionally out of scope under `docs/adr/ADR-001-credit-score-scope-classification.md`.
- A green institution transaction status does not imply that Investments data is available.
- A balanced reconciliation row does not prove complete investment holdings.
- Monarch's output must not be copied blindly, because the reviewed Monarch goal page produced an implausible months-behind value.

## Prioritized outcome

### Fix before trusting planning outputs

1. Make Recurring, Dashboard Plan, bill calendar, safe-to-spend, and forecasts consume one canonical recurring projection.
2. Keep unreviewed inferred inflows out of expected-income totals.
3. Replace the historical loan-transfer forecast default with the current debt plan or an explicit user assumption.
4. Remove invented FIRE values and duplicate hard-coded life events.

### Fix next for data confidence

1. Reconcile the transaction coverage gap without mutating production data.
2. Recover holdings where product support and consent allow it.
3. Show an explicit credit-card-bill availability state.
4. Investigate missing weekly-report runs.

### Fix for UX consistency

1. Separate contextual advice from user priorities.
2. Exclude partial months from Year in Money superlatives.
3. Humanize provider outcome codes.
4. Normalize blank or corrupted external display text everywhere.
5. Remove internal phase language from Budget.

### Fix for interaction confidence

1. Add pending feedback to top-level navigation and Dashboard view tabs.
2. Add route loading coverage for every data-heavy page.
3. Standardize `Button loading`, `aria-busy`, disabled behavior, and live status text across every async action.
4. Add duplicate-click protection and error recovery to handlers that currently have no busy state.

## Final assessment

FundFlow is not broadly broken.
Its core browsing, search, reporting, account, goal, and debt experiences worked in the reviewed desktop session.
The app has several valuable capabilities that equal or exceed Monarch.

The remaining problems are concentrated in financial consistency and data provenance rather than general navigation or visual collapse.
Those problems are important because polished UI can make an incorrect planning assumption look authoritative.
The implementation plan in `docs/superpowers/plans/2026-09-03-fundflow-ui-and-monarch-parity-remediation.md` treats those trust defects as the first delivery gate.

## Implementation status after PR #151

The first remediation slice from this audit was merged into `main` by PR #151
on 2026-09-04.
The source branch and commit below are retained only for traceability.

The first remediation slice is implemented and covered by focused regression tests.

- Top-level navigation, Dashboard view tabs, and Forecasting presets now show an inline pending indicator while an unprefetched route transition is in flight.
- Forecasting assumption submission now disables the submit action and shows the shared Button spinner immediately.
- Goals, Investments, Debt payoff, Forecasting, Advice, and Notifications now have route-level skeleton fallbacks that preserve the application shell.
- Async Save, Refresh, Add, and Demo actions audited in this slice now use the shared loading contract with disabled duplicate activation and `aria-busy`.
- Fabricated FIRE scenarios were removed from the live Forecasting page, and the standalone simulator no longer seeds fictional events or fallback dollar values.
- Recurring provider labels now fall back from blank merchant names to a description or `Unknown`.
- The recurring month summary always reserves a Credit cards column and states when bill data is unavailable.
- Reconciliation account labels are normalized before display, and investment sync outcomes are presented as user-readable states.
- Year in Money can exclude future rows from a current partial year, and the page applies the current date cutoff.
- Account visibility and ordering now use one authenticated JSONB merge function, so saving `accountsPage` cannot clobber sibling dashboard preferences.
- Advice now labels contextual recommendations separately from saved priorities, and Budget no longer exposes internal phase language.

The following findings remain provider, consent, configuration, or larger data-model work and were not silently fabricated in this branch.

- Canonical recurring projection unification across Dashboard Plan, Cash Flow, Safe to spend, and Forecasting still requires a shared projection contract.
- Current debt-plan defaults still need to replace the historical transfer median in Forecasting.
- Investment holdings recovery, credit-card liability availability, transaction coverage reconciliation, weekly-report scheduler reliability, and Monarch configuration import require integration and operational verification.
