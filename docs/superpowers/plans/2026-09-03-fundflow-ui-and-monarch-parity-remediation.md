# FundFlow UI and Monarch Parity Remediation Plan

## Purpose

This plan converts the September 3, 2026 authenticated UI audit into a sequential implementation handoff.
It is written so another LLM can reproduce the evidence, implement each fix, and prove the result without relying on conversation history.

The companion findings document is `docs/FundFlow-UI-and-Monarch-Parity-Findings-2026-09-03.md`.
Read it before modifying code.

As of 2026-09-04, the initial interaction-confidence and low-risk trust-fix
slice is merged in PR #151.
The remaining phases below are still an implementation handoff and are not
evidence that those follow-up phases have shipped.

## Non-negotiable constraints

- Treat production FundFlow and Monarch data as read-only unless the user separately authorizes a specific mutation.
- Never seed demo data into the user's live account.
- Never copy balances, transactions, categories, budgets, goals, or holdings from Monarch without an explicit preview and confirmation workflow.
- Never invent a balance, holding, bill, income stream, life event, age, return, or spending assumption.
- Keep provider source facts immutable and layer user overrides through the existing canonical projection.
- Preserve user scoping, household scoping, RLS, authorization, audit logging, idempotency, and pagination.
- Do not add credit-score functionality under this plan.
- Preserve unrelated work and never modify generated `graphify-out/` files by hand.
- Do not implement from the audit branch blindly.
- Resolve the current `origin/main`, active pull requests, dirty worktree, and exact production deployment commit before coding.
- Use a dedicated `codex/` branch from the agreed base unless the user names another branch.
- Use the repository's installed Next.js documentation before changing framework APIs.
- Run `npx npm-check-updates` at the start of the implementation task and record safe skips or updates in the pull-request description.

## Audit baseline

- Audit branch: `feat/ledger-strip-account-picker`.
- Audit commit: `329c853c63c8d7c133f5e594d5ea1410e83a5d11`.
- Production deployment commit: not proven during the UI review.
- Current dependency check at audit time found safe minor candidates for `@supabase/supabase-js` and `lucide-react` and major candidates for Vitest coverage, Vitest, ESLint, Plaid, and TypeScript.
- Dependency changes are not part of this remediation unless they are separately validated and kept out of feature-risk debugging.

## Delivery verdict and order

The target state is not visual similarity to Monarch.
The target state is one internally consistent FundFlow financial model with honest availability states and user-controlled imports.

Implement the phases in this order.

1. Establish reproducible fixtures and contracts.
2. Repair recurring and forecast financial correctness.
3. Repair provider availability, coverage, and operational reliability.
4. Repair misleading copy and external-text presentation.
5. Add approved parity improvements and safe configuration migration.
6. Complete end-to-end, accessibility, performance, and production verification.

Do not start optional parity work while a financial-trust gate is failing.

## Phase 0: Establish a trustworthy baseline

### Goal

Reproduce the confirmed failures without writing to production and make the intended financial contracts explicit.

### Tasks

1. Fetch `origin` and record the exact proposed base commit.
2. Resolve the production deployment commit through the Vercel deployment metadata or the application's release marker.
3. Compare that deployment commit with the local source paths named in the findings document.
4. Run `graphify query` for recurring totals, forecast defaults, life events, investment sync, advice priorities, and annual highlights.
5. Read the relevant Next.js guides under `node_modules/next/dist/docs/` before modifying App Router pages or server data loading.
6. Create sanitized, disposable test fixtures that reproduce each financial relationship without using the user's values.
7. Add a shared test vocabulary for as-of date, selected month, pending policy, stream source, review state, product availability, and data freshness.
8. Record RED tests before implementation for every Phase 1 defect.

### Required RED tests

- A paired loan-payment transfer must not double the forecast payment default.
- A default debt payment must not exceed remaining projected liabilities.
- A refund-like repeated inflow must not contribute to expected income before review.
- An empty provider merchant string must render a nonempty safe label and accessible action name.
- A slow navigation must expose a pending state before the destination page commits.
- A slow projection submit must disable the submit control and expose a loading status.
- Every asynchronous button must prevent duplicate activation and expose `aria-busy` while pending.
- The Recurring page and Dashboard Plan must return identical totals for the same canonical fixture and month.
- A zero credit-card-bill total with unavailable Liabilities data must render an unavailable state.
- A user with no persisted life events must not receive default life events.
- A missing income or spend assumption must render as missing or request input instead of using a fabricated value.

### Candidate test files

- `tests/unit/forecasting.test.ts`.
- `tests/unit/recurring-detection.test.ts`.
- `tests/unit/recurring-page.test.ts`.
- `tests/unit/recurring-data.test.ts`.
- `tests/unit/dashboard.test.ts`.
- `tests/unit/fire-simulator.test.ts`.
- `tests/e2e/recurring.spec.ts`.
- `tests/e2e/forecasting.spec.ts`.
- `tests/e2e/navigation-feedback.spec.ts`.
- `tests/unit/button.test.tsx` or the repository's existing UI primitive test file.

Use existing test files when their scope matches.
Create a new focused file only when the repository has no appropriate home.

### Exit gate

Every confirmed financial-correctness issue has a deterministic failing test or a written reason why it requires an integration or browser fixture.
Every confirmed interaction issue has a browser or component test that observes the pending state, completion state, failure state, and duplicate-click behavior.
The production deployment commit and implementation base are recorded.

## Phase 1: Unify recurring financial truth

### Goal

Make every FundFlow planning surface consume the same recurring month projection.

### Relevant files

- `lib/recurring-page.ts`.
- `lib/recurring-data.ts`.
- `lib/recurring-detection.ts`.
- `lib/recurring-inference.ts`.
- `lib/dashboard.ts`.
- `lib/planning.ts`.
- `components/recurring/MonthSummary.tsx`.
- `components/recurring/RecurringList.tsx`.
- `components/recurring/RecurringCalendar.tsx`.
- `components/dashboard/PlanView.tsx`.

### Task 1.1: Define the canonical projection contract

Introduce or extract one pure projection contract that receives normalized recurring streams, manual items, credit-card bills, scheduled one-offs, a timezone-aware as-of date, and a selected month.
Return occurrences, source provenance, review state, matched state, totals by income, expense, and credit-card bill, and an explicit availability state for each provider-dependent bucket.

Prefer adapting `expandStreamsForMonth` and its existing types over creating a second abstraction.
The Dashboard must consume this contract or an adapter over the same output.
Do not maintain separate date expansion and total logic in `lib/dashboard.ts` and `lib/recurring-page.ts`.

### Task 1.2: Normalize names before projection

Normalize merchant and description strings with trimming and `normalizeExternalDisplayText` before choosing a label.
Use the first nonempty normalized merchant, nonempty normalized description, or a user-safe fallback such as `Unknown recurring item`.
Use the same label in list rows, calendar cells, action accessible names, exports, and notifications.

Add tests for null, empty, whitespace-only, Unicode replacement characters, and control whitespace.

### Task 1.3: Gate inferred inflows

Extend recurring detection input with the minimum authoritative context needed to evaluate an inflow.
At minimum, include account type, primary financial category, detailed financial category, and pending state.

Provider-declared recurring income may keep its current provider provenance.
Locally inferred inflows must remain `needs_review` unless they originate from a depository account and match an allowlisted income signal such as payroll, benefit, interest, or a user-confirmed rule.
Repeated merchant refunds, card credits, reimbursements, and transfer-like rows must not enter expected-income totals automatically.

Do not silently delete rejected candidates.
Keep them reviewable with a reason code so the user can confirm a legitimate income pattern.

### Task 1.4: Make credit-card-bill availability explicit

Replace `showCreditCards` in `components/recurring/MonthSummary.tsx` with a status-aware presentation.
Always show the Credit cards column.
Distinguish `available_with_bills`, `available_no_bills`, `not_enabled`, `provider_unavailable`, `stale`, and `sync_failed` if the existing sync-health vocabulary supports those states.

Do not label unavailable data as zero due.
Link to the relevant institution repair or consent action only when that action can change the state.

### Task 1.5: Reconcile Dashboard consumers

Make Dashboard Plan bill calendar, recurring status, cash-flow forecast, next-paycheck logic, and safe-to-spend calculations use the canonical projected occurrences.
Keep scheduled one-offs as explicit provenance rather than merging them into provider streams invisibly.
Verify that the selected account, household scope, month, timezone, and pending policy are identical across the Recurring page and Dashboard adapters.

### Acceptance criteria

- Recurring list, recurring calendar, Recurring summary, Dashboard Plan, bill calendar, safe-to-spend, and forecast inputs agree at the occurrence level for the same month and scope.
- Every total can be traced to included occurrence identifiers and provenance.
- Unreviewed inferred inflows contribute zero to expected-income totals.
- Empty external names never produce blank visible labels or blank accessible names.
- Credit-card-bill availability is always visible and honest.
- Existing purchase-versus-credit-card-bill classification remains correct.

### Verification

- Run all recurring, dashboard, planning, and credit-card-bill unit and integration tests.
- Run the signed-in recurring E2E suite with disposable test data.
- Compare Recurring and Dashboard Plan totals through a test-only fixture endpoint or shared page fixture, not through production mutations.

## Phase 2: Repair forecasting assumptions and life events

### Goal

Ensure that every projection is based on persisted facts or clearly entered assumptions.

### Relevant files

- `lib/forecasting.ts`.
- `lib/forecasting-data.ts`.
- `lib/debt-data.ts`.
- `lib/life-events.ts`.
- `lib/fire-simulator.ts`.
- `app/forecasting/page.tsx`.
- `components/forecasting/AssumptionsPanel.tsx`.
- `components/forecasting/LifeEventsPanel.tsx`.
- `components/forecasting/FireSimulator.tsx`.

### Task 2.1: Replace the historical loan-transfer default

Stop using the median absolute sum of `LOAN_PAYMENTS` rows as the default future debt payment.
Use `DebtPlannerData.totalMonthlyBudget`, which already derives the current minimum-payment plan, or a persisted user override.
Pass the debt-planner value into the forecast page data boundary rather than making `lib/forecasting.ts` query or infer it independently.

If no liabilities exist, default the payment to zero.
If liabilities exist but a minimum cannot be calculated, show that the assumption needs input.
During projection, cap each month's aggregate debt payment at the remaining liability balance.

Keep historical payment cash flow available as explanatory evidence only.
Do not use it as the default plan.

### Task 2.2: Use one life-event model

Remove `DEFAULT_EVENTS` from `components/forecasting/FireSimulator.tsx`.
Map the existing persisted `life_events` rows into every scenario that needs life events.
Prefer one life-event editor and one projection pipeline.
If two visualizations remain, they must consume the same persisted event list and semantics.

### Task 2.3: Remove fabricated FIRE inputs

Delete the income and spend multipliers in `app/forecasting/page.tsx`.
Delete fixed fallback values for age, savings, spend, income, and events from the calculation path.

Derive trailing income and spending from the canonical finance projection only when coverage is complete enough to do so.
Label the exact period, pending policy, and source.
Otherwise require an explicit user input and persist it through the existing secure user-scoped model or a narrowly scoped new table.

Do not treat zero as missing.

### Task 2.4: Clarify scenario provenance

Every scenario result must identify whether each input is linked data, a saved user assumption, a current form edit, or unavailable.
Keep the existing projection disclaimer.
Add an `as of` date and a data-freshness warning when source accounts or holdings are stale.

### Acceptance criteria

- The default monthly debt payment matches the Debt page for the same user and scope.
- The payment never exceeds remaining projected liabilities.
- A paired transfer fixture cannot double the payment.
- A user with no persisted events sees no events.
- A persisted event appears exactly once in every relevant projection.
- No FIRE date is produced from hidden fallback income, spend, savings, age, or life events.
- Zero remains a valid explicit value.

### Verification

- Run forecasting, debt, planning-depth, life-events, and FIRE simulator unit tests.
- Run signed-in Forecasting E2E at desktop and 390-pixel widths using disposable data.
- Verify URL assumptions, saved assumptions, back-button behavior, empty state, stale-data state, and event add, edit, and remove flows outside production.

## Phase 3: Repair data availability and operational confidence

### Goal

Explain and reduce the current transaction, investment, bill, and scheduled-report gaps without inventing data.

### Task 3.1: Build a read-only source-coverage reconciliation

Extend the existing institution observability rather than adding a separate opaque dashboard.
Provide counts by institution, account, source, date range, pending state, and canonical inclusion state.
Include oldest and newest dates, last successful sync, cursor health, and whether the account exists only in one imported source.

Use bounded pagination or a database aggregate.
Never rely on a default PostgREST row limit for completeness.
Never expose raw transaction descriptions in logs or committed fixtures.

Use the report to explain the observed 220-transaction coverage gap.
Do not force aggregate equality with Monarch.

### Task 3.2: Reconcile same-period Cash Flow

Add a deterministic internal reconciliation function that groups differences by missing account, missing source row, pending policy, transfer exclusion, category override, and date boundary.
The function must operate on sanitized imports or user-authorized data.
It must not scrape or mutate the live Monarch account.

Provide a preview-only comparison in the existing import workflow if Monarch exports are supplied by the user.

### Task 3.3: Improve investment recovery and status copy

Map investment job outcomes to typed domain states in `lib/investments-data.ts` or a shared sync-status module.
Render user-facing copy in `app/investments/page.tsx` without leaking raw outcome strings.

For every institution, determine whether Investments is unsupported, was not included in consent, needs reconnect, is rate limited, is stale, or failed.
Offer reconnect or expanded-consent actions only when supported by Plaid and authorized by the user.
Run holding sync after consent and verify `holdings`, `securities`, snapshots, and account coverage are complete and user-scoped.

Retain account-balance fallback when holdings remain unavailable.
Never manufacture security allocation from the aggregate balance.

### Task 3.4: Diagnose credit-card-bill availability

Trace Plaid Liabilities consent, item product state, sync job, `credit_card_bills` persistence, account mapping, due-date freshness, and recurring month projection.
Preserve known values when an otherwise successful response omits an optional field.
Keep the product opt-in if it adds billed provider requests.

### Task 3.5: Repair weekly-report gaps

Trace Vercel cron configuration, authentication, eligible-user selection, timezone/week boundary, idempotency key, report generation, email delivery, and delivery-history persistence.
Add an integration test for consecutive scheduled weeks and a retry after partial failure.
Do not emit duplicate emails when a retry occurs.

### Acceptance criteria

- Coverage reports state why totals differ without exposing private transaction text.
- Every investment institution has a friendly typed state and a valid recovery path or an honest unavailable explanation.
- Holdings are shown only when provider or manual records support them.
- Credit-card bills show freshness and availability independently of recurring purchases.
- Weekly scheduled runs either record a terminal outcome or a retriable failure for every eligible week.

## Phase 4: Repair misleading copy and display boundaries

### Goal

Remove contradictions, stale roadmap language, raw codes, and corrupt external text.

### Task 4.1: Advice semantics

Change `lib/advice.ts` or its view model so saved user priorities and contextual recommendations are separate arrays.
In `app/advice/page.tsx`, render `Prioritized by you` only for saved priorities.
Render fallback items under `Recommended for you`.
Keep `components/advice/AdvicePriorities.tsx` consistent with the heading and count.

### Task 4.2: Completed-month annual comparisons

Pass an as-of date into the annual summary logic.
In `lib/annual.ts`, exclude the current partial month from highest, lowest, quietest, and similar comparative labels.
Allow the current month in a separately labeled partial-period summary if useful.

### Task 4.3: External display text

Apply `normalizeExternalDisplayText` at ingestion and at every defensive render boundary for provider account, merchant, institution, and security names.
Update `app/settings/page.tsx`, `components/settings/ReconciliationSection.tsx`, and `components/settings/CardAprSection.tsx` as needed.
Add render tests for replacement characters and whitespace-only input.

### Task 4.4: Product copy cleanup

Remove the Phase 7 sentence from `components/budget/BudgetPlanner.tsx`.
Replace it with current behavior and any real limitation.
Humanize investment outcome codes through the typed mapping from Phase 3.
Clean next-paycheck names through the same canonical merchant label used by transactions.
Rename unsupported personal-inflation claims to merchant amount change unless the calculation proves comparable recurring goods or services.

### Task 4.5: Add navigation pending feedback

Read the current Next.js 16 navigation and loading-boundary guidance under `node_modules/next/dist/docs/` before choosing the implementation.
Use the framework-supported link pending API if it is available in this installed version.
Otherwise add a small client navigation-link wrapper that preserves normal link semantics, starts one transition, marks the selected link `aria-busy`, and exposes a stable spinner or progress bar.

Apply the wrapper to `components/ui/Tabs.tsx`, `components/shell/AppSidebar.tsx`, `components/shell/MobileNavigation.tsx`, and other shared navigation components only after verifying that keyboard activation, modified-click behavior, prefetching, focus, and back-button behavior remain correct.
Do not block the whole shell or trap focus during a route transition.
Do not show a spinner for an action that was prevented by validation or a disabled state.

Add `app/loading.tsx` or route-specific loading boundaries for Goals, Investments, Debt, Forecasting, Advice, and Notifications where the root boundary does not provide an equivalent shell-preserving fallback.
Keep the existing `RouteSkeleton` contract and destination-specific labels.

### Task 4.6: Add pending feedback to query-driven tabs and forms

Dashboard Overview, Monitor, Plan, and Wealth are same-route query transitions.
Give their tab navigation a component-level pending state because a segment loading file may not render for every search-parameter change.
Ensure the active underline does not jump to the destination before content is committed, or clearly mark the requested destination as pending.

Convert the Forecasting assumptions submit control to a pending-aware client control or use the framework's supported form pending mechanism.
On submit, disable the control, show the spinner, preserve the entered values, announce `Updating projection`, and restore the control with an error message on failure.

### Task 4.7: Standardize asynchronous button behavior

Audit every `fetch`, `router.refresh`, `router.push`, async Supabase mutation, download preparation, and browser-permission handler reachable from a user-facing button.
Use the existing `Button` `loading` prop wherever the control is a `Button`.
For native buttons or links, provide equivalent `aria-busy`, disabled or guarded behavior, a spinner, stable label text, and an `aria-live` status.

At minimum, cover `components/accounts/AccountPreferences.tsx`, `components/settings/AuditLogSection.tsx`, `components/settings/CardAprSection.tsx`, `components/notifications/EmailPreferences.tsx`, `components/investments/AddManualHoldingForm.tsx`, `components/transactions/AddTransactionModal.tsx`, `components/settings/DemoDataSection.tsx`, `components/reports/SavedReportsSection.tsx`, `components/settings/ExportSection.tsx`, `components/notifications/PushSection.tsx`, and any newly discovered async handler.

Handlers with no busy state must gain one before the request starts.
Handlers with a busy state but no spinner must pass it through the shared loading contract.
Use one in-flight guard per action or per entity so two unrelated rows do not block each other.
Keep error status visible until the user takes another action or retries.

### Acceptance criteria

- A navigation click exposes a pending state within the same interaction frame on desktop and mobile.
- The old page remains usable and visually stable while the new page loads, but the user can tell that navigation is in progress.
- Goals, Investments, Debt, Forecasting, Advice, and Notifications have a shell-preserving loading boundary.
- Dashboard query tabs show pending feedback even when the route segment does not remount.
- Forecasting `Update projection` disables and announces progress until the response commits or fails.
- Every async button has a visible loading affordance, `aria-busy`, duplicate-click protection, and an error recovery path.
- No loading state causes layout shift, traps focus, changes source data, or prevents normal modified-click link behavior.

### Acceptance criteria

- No screen claims a recommendation was user-prioritized when it was not.
- Partial months cannot win completed-period superlatives.
- Raw provider error or outcome codes do not appear in customer-facing UI.
- External replacement characters and blank names do not appear in reviewed surfaces.
- User-facing copy contains no internal delivery-phase language.

## Phase 5: Add approved parity improvements

### Goal

Close high-value Monarch gaps only after financial consistency is green.

### Task 5.1: Configuration import and onboarding

Use the existing Monarch configuration import surface rather than creating another importer.
Support budget and goal preview with stable identity matching, explicit conflict decisions, dry-run counts, and idempotent writes.
Default to preserving FundFlow edits.
Require separate explicit confirmation before replacing any existing configuration.
Write audit records that contain identifiers and decisions but no unnecessary financial payload.

### Task 5.2: Faster transaction correction

Evaluate an inline merchant and category editor over the existing transaction override APIs.
Do not write provider source fields.
Keep transfer-like overrides behind explicit confirmation.
Ensure Dashboard, Cash Flow, Reports, Budget, Year in Money, weekly report, CSV, JSON, and AI-safe export consume the same projection immediately after a successful override.

### Task 5.3: Credit limits and utilization

Add credit limits and utilization only when authoritative and fresh liability data is available.
Show the source and as-of date.
Display unavailable rather than estimating a limit.

### Explicit exclusions

Credit score remains out of scope under `docs/adr/ADR-001-credit-score-scope-classification.md`.
A general AI assistant is not part of this remediation.
Before adding one, create a separate ADR covering consent, data minimization, prompt-injection boundaries, provider retention, deletion, evaluation, cost, and failure behavior.
Retail purchase sync is optional and needs its own product case.

### Acceptance criteria

- Imports are previewed, idempotent, user-scoped, and non-destructive by default.
- Transaction corrections preserve source facts and propagate through every projection consumer.
- Credit utilization never appears without an authoritative limit and freshness state.
- No excluded feature is smuggled into this scope.

## Phase 6: Verification and delivery gate

### Local verification

Run the focused tests after each RED and GREEN checkpoint.
Before handoff, run all repository-required checks.

At minimum, run:

```text
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
git diff --check
```

Use the actual scripts in `package.json` if names differ.
Do not claim a command passed unless its current run completed successfully.

Run `graphify update .` after source changes.
Do not commit generated `graphify-out/` content.

### Browser verification

Use disposable or sandbox data for every mutating flow.
Use the authenticated production account only for a final read-only comparison.

Verify at least:

- Desktop width near the audit viewport.
- Mobile width at 390 pixels.
- Keyboard-only navigation and visible focus.
- Automated accessibility scan with no new serious or critical violations.
- Browser console with no new errors.
- Network requests with no failed required data loads.
- Loading, empty, stale, unavailable, error, repair-required, and success states.
- Pending navigation and button states under an intentionally delayed test response.
- Double-click and rapid-tab activation behavior.
- Confirmation that a visible loading state clears on both success and failure.
- Reduced-motion behavior.
- Long merchant and account names.
- Currency formatting and negative values.
- Timezone boundaries at the start and end of a month.
- Back, forward, reload, and shareable query-state behavior.

Re-run the side-by-side read-only checks for Accounts, Transactions, Cash Flow, Budget, Recurring, Goals, Investments, Forecasting, Advice, Reports, and Settings.
Document valid residual differences as provider, configuration, freshness, or intentional product choices.

### Remote verification

Push only after local checks are green and the diff is scoped.
Open or update one pull request for the implementation branch.
Record the exact pushed SHA.
Wait for fresh CI, E2E, security, quality, and deployment checks.
Inspect annotations as well as green conclusions.
Treat approval policy separately from test failures.
Verify the deployed SHA before the final production read-only audit.

### Final evidence packet

The implementing agent must leave:

- A pull request with a scoped summary and explicit non-goals.
- A mapping from each finding ID to code, tests, and verification evidence.
- RED and GREEN test evidence for every financial-trust fix.
- Migration and RLS verification for any schema change.
- A production deployment SHA.
- A current read-only browser comparison.
- A list of remaining provider, consent, configuration, or policy blockers.

## Suggested implementation batches

Keep pull requests reviewable and avoid mixing dependency upgrades with financial logic.

### Batch A: Financial correctness

- FND-001 through FND-006.
- Canonical recurring projection.
- Inferred-inflow review gate.
- Debt-payment default.
- Unified life events and explicit FIRE assumptions.

### Batch B: Availability and operations

- DAT-001 through DAT-006.
- Source-coverage report.
- Investment and liability state mapping.
- Weekly-report reliability.

### Batch C: UX consistency

- FND-007 through FND-012.
- Advice headings.
- Completed-month annual comparisons.
- External-text normalization.
- Product-copy cleanup.

### Batch D: Approved parity

- Configuration import.
- Optional inline transaction correction.
- Authoritative credit utilization.

Each batch must be independently releasable.
Do not stack an optional parity batch on an unmerged financial-correctness branch unless the user explicitly accepts that coordination cost.

## Definition of done

This initiative is complete only when all of the following are true.

- The same FundFlow month and scope produce one traceable recurring occurrence set across every surface.
- Refund-like inferred inflows cannot silently raise expected income.
- Forecast debt assumptions align with the current debt plan and never overpay projected liabilities.
- No projection uses hidden fictional inputs or life events.
- Investment, liability, and credit-card-bill availability is explicit and user-readable.
- Known transaction and Cash Flow gaps are explained at the source level or recorded as an external blocker.
- Advice, annual highlights, Budget, and sync status no longer make misleading claims.
- Imports preserve existing user configuration unless replacement is explicitly approved.
- Focused tests, full tests, lint, typecheck, build, E2E, accessibility, and fresh remote checks pass.
- The final production comparison is read-only and tied to a verified deployment SHA.
- Remaining differences are documented without claiming complete Monarch parity.

## Initial implementation slice delivered

The first branch slice delivers the interaction-confidence and low-risk trust fixes that can be verified locally without provider mutations.

- Shared `useLinkStatus` indicators were added to primary navigation, mobile navigation, Dashboard tabs, and Forecasting preset links.
- Missing route loading boundaries were added for every currently data-heavy planning and notification route.
- Forecasting assumption submission and audited async actions now use the shared Button loading contract.
- Fictional FIRE defaults were removed from the live Forecasting page and the standalone simulator.
- Account preference persistence now uses a row-atomic JSONB merge RPC, with an integration test that verifies sibling preference preservation.
- Recurring labels, credit-card empty state, reconciliation names, investment outcomes, annual partial-year filtering, advice headings, and Budget copy were corrected.
- Focused RED tests were committed before the implementation checkpoint, and the GREEN suite now covers the new behavior.

The remaining financial correctness tasks in this plan are intentionally still open because they require broader canonical projection changes, provider product support, consent state, or operational evidence.
