# Prompt: Fix every confirmed FundFlow UI review issue

You are the implementation owner for the remediation of FundFlow PR #134.
Do not stop after producing a plan or a review.
Reproduce every confirmed issue in an end-user browser flow, implement the fixes, add regression coverage, run the complete verification gates, deploy or use the resulting preview when authorized, and repeat the large-data QA until every acceptance criterion below passes.

## Objective

Fix findings F1 through F12 in [`ui-review.md`](./ui-review.md) without regressing the PR-specific behavior that already passed.
The tested preview looked healthy with small fixtures but failed at realistic volume, so the finished work must be proven with a dataset that crosses both the Supabase 1,000-row response boundary and FundFlow's 25,000-row bounded-query ceiling.
Financial correctness takes priority over rendering a polished but incomplete number.
Accessibility, responsive layout, performance, and download behavior are release requirements, not optional polish.

## Repository and tested baseline

- Repository: `https://github.com/navaneethbv/FundFlow`
- Pull request: [`#134`](https://github.com/navaneethbv/FundFlow/pull/134)
- Branch used by the review: `feat/register-visual-rollout-v2`
- Preview alias used by the review: `https://fund-flow-git-feat-register-visual-rollout-v2-navaneethbv.vercel.app`
- Exact head tested by the review: `4d12f6bb3092837ac1e9b1aad8a4b8ba9f07f112`
- Exact Vercel deployment tested by the review: `dpl_GszAgHS17ZJAfmZcSa7kU6JY4HYb`
- Main review report: [`ui-review.md`](./ui-review.md)
- Large-run machine evidence: [`results.json`](./qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/results.json)
- Focused PDF reproduction: [`export-repro.json`](./qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/export-repro.json)
- Large-run desktop contact sheet: [`contact-desktop-light.png`](./qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/contact-desktop-light.png)
- Large-run mobile contact sheet: [`contact-mobile-light.png`](./qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/contact-mobile-light.png)
- Earlier same-head evidence: [`qa-shots/pr134-2026-08-28T20-00-14-019Z`](./qa-shots/pr134-2026-08-28T20-00-14-019Z)

Treat the tested SHA as historical evidence, not as a guarantee that the branch is still at that commit.
Before changing anything, fetch the current PR head and record the local SHA, remote PR SHA, preview deployment SHA, branch name, and working-tree status.
If those identities do not match, stop and resolve the target before implementing.

## Non-negotiable repository rules

Read the repository's `AGENTS.md`, `CLAUDE.md`, [`docs/HANDOFF.md`](./docs/HANDOFF.md), and [`ui-review.md`](./ui-review.md) before editing.
Read the Next.js guides shipped in the installed package before changing Next.js code because this repository uses a version with behavior that may differ from prior Next.js knowledge.
At minimum, read these installed guides:

- `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`
- `node_modules/next/dist/docs/03-architecture/accessibility.md`

Run `npx npm-check-updates` before implementation as required by the repository.
Only take safe dependency updates that remain within the repository rules and keep all gates green.
Do not force a major dependency bump through unrelated failures.
Record every skipped update and its reason in the final handoff or PR description.

When `graphify-out/graph.json` exists, begin codebase discovery with focused commands such as:

```bash
graphify query "Where are annual recap transactions loaded and bounded?"
graphify query "How does the Review PDF export load transactions and splits?"
graphify query "Where are report filters parsed, serialized, sorted, and paginated?"
graphify query "Which chart components render linked SVG elements?"
```

After code changes, run `graphify update .`.
Never commit `graphify-out/` or `lib/graphify-out/`.
Preserve unrelated dirty or untracked work.
Do not manually edit `CHANGELOG.md` or generated artifacts.
Do not add an agent name as a commit co-author.
Use the simplest robust solution that satisfies the contracts below.
Do not introduce a new framework, state library, database, queue, or external provider for these fixes.
Do not hide failures by swallowing exceptions, weakening tests, disabling accessibility rules, raising timeouts, or removing correctness warnings.
Use one complete sentence per physical line when writing or substantially editing long Markdown files.
Do not use the Unicode em dash character in output or committed text.

## Official documentation to use

Use the installed Next.js documentation as the version-specific source of truth and use these official links as supporting references:

- [Next.js Link component and `prefetch`](https://nextjs.org/docs/app/api-reference/components/link)
- [Next.js linking, navigation, loading UI, and slow routes](https://nextjs.org/docs/app/getting-started/linking-and-navigating)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js backend-for-frontend and file responses](https://nextjs.org/docs/app/guides/backend-for-frontend)
- [Supabase ordered `range()` pagination](https://supabase.com/docs/reference/javascript/using-modifiers-range)
- [Supabase `in()` filters](https://supabase.com/docs/reference/javascript/using-filters-in)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Playwright download testing](https://playwright.dev/docs/downloads)
- [Playwright accessibility testing with axe](https://playwright.dev/docs/accessibility-testing)
- [W3C WCAG 2.2 contrast minimum guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [W3C labels or instructions guidance](https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions.html)
- [MDN explicit form labels](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/label)
- [MDN description-list semantics](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dl)
- [Tailwind screen-reader-only utility](https://tailwindcss.com/docs/display#screen-reader-only)
- [Web performance guidance for diagnosing slow interactions](https://web.dev/articles/optimize-inp)
- [Vercel Preview deployments](https://vercel.com/docs/deployments/overview)
- [Vercel Runtime Logs](https://vercel.com/docs/logs/runtime)

Do not copy examples from a documentation page without checking them against the installed dependency version and the existing project architecture.

## Safety rules for live data

Use only a newly created throwaway Supabase Auth user.
The only permitted Supabase project ref is `zrxbmmtqqhlwtrinocww`.
Never access or mutate project `ofyyjzjjmopwvfqlhnyc`.
Never use an existing production user.
Never log, paste, commit, or include secrets, session cookies, passwords, service keys, or Vercel protection bypass values in screenshots or reports.
Use `.env.local` only for the required local credentials.
Keep all service-client queries explicitly scoped to the throwaway user's `user_id`.
For household data, preserve the application's signed-in owner and membership scoping rules.

Cleanup is mandatory in a `finally` path even when a test, browser run, or assertion fails.
Cleanup must:

1. Call `DELETE /api/demo` from the authenticated browser session.
2. Delete any additional stress rows created outside the demo endpoint, scoped by the disposable user ID.
3. Delete the disposable Auth user through the Supabase admin API.
4. Confirm zero residual rows for that user in `transactions`, `accounts`, `plaid_items`, `receipts`, `budgets`, `goals`, `securities`, `holdings`, and `holding_snapshots`.
5. Check any additional user-owned tables touched by a new test or fix.
6. Record the cleanup query results without recording secrets.

## Required data sets

Use at least three explicit dataset tiers.

### Tier 1: focused unit fixtures

Use minimal deterministic rows that prove sorting, zero normalization, complete labels, semantic markup, and pagination boundary behavior.

### Tier 2: normal end-user fixture

Create a disposable user, sign in through `/login`, and seed with `POST /api/demo` through the authenticated browser session.
This fixture must continue to prove the original PR-specific interactions, including the Ledger Strip, receipt workflow, and past-month navigation.

### Tier 3: large-data stress fixture

Create approximately 30,500 transactions for the same disposable user.
Match or exceed the reviewed shape of 30,497 total transactions, at least 2,087 transactions in one selected month, at least 16,497 in one calendar year, 12 goals, 8 budgets, 3 accounts, and a populated investment holding.
The fixture must include:

- More than 1,000 transactions in the Year in Money period.
- More than 1,000 transactions in the PDF export period.
- More than 25,000 transactions in an all-time report period.
- At least 50 duplicate-review candidates for the progressive-disclosure test.
- Exact `0`, `-0`, and values that round to zero at currency precision.
- Multi-million income and spending totals long enough to stress summary tiles.
- A mobile forecasting result with every scenario column present.
- Settings forms in each affected section.
- Debt rows and an empty Tags state.

Use deterministic IDs, dates, amounts, and merchants so expected totals can be calculated outside the UI.
Seed in bounded batches and verify inserted counts before browser assertions.
Do not change a production API contract merely to make seeding convenient.

## Execution method

For each finding, follow this loop before moving to the next workstream:

1. Reproduce the issue in the closest end-user E2E flow.
2. Save a focused before screenshot, relevant network response, console output, timing, and database truth.
3. Add the narrowest regression test that fails for the real cause.
4. Confirm the new test fails before the fix.
5. Implement the smallest robust fix.
6. Run the focused unit and E2E tests.
7. Re-run the same browser flow and save an after screenshot.
8. Confirm no new console errors, same-origin failures, layout overflow, inaccessible names, or axe violations were introduced.

Do not treat a passing unit test, build, screenshot, or HTTP 200 as proof of financial correctness.
Always compare large-data totals with an independently queried database count and independently computed expected totals.

## Workstream 1: F1, Year in Money silently drops rows after 1,000

### Confirmed behavior

The database contained 16,497 transactions in calendar year 2026.
`/wrapped?year=2026` displayed exactly 1,000 transactions and no warning.
Every annual statistic was derived from the incomplete result.

### Primary source files

- `app/wrapped/page.tsx`
- `lib/annual.ts`
- `lib/finance-query.ts`
- `lib/finance-domain.ts`
- `tests/unit/annual.test.ts`
- `tests/unit/wrapped-page-ui.test.ts`

### Required implementation

Replace the one-shot transaction query in `app/wrapped/page.tsx` with an ordered, explicitly paginated loader.
Prefer the existing `fetchFinanceTransactions` contract and its deterministic ordering over a second custom pagination loop.
Every `.range(from, to)` call must use an explicit stable order with an ID tie-breaker because Supabase ranges are inclusive and unordered ranges can duplicate or omit rows.
Preserve per-user or household scoping, refund handling, duplicate exclusion, splits, merchant rules, category overrides, and currency behavior used by other canonical finance views.
Do not use an unbounded select.
Do not silently exceed the existing bounded-query contract.

For an annual period below the configured maximum, the recap must use every matching transaction.
For an annual period above the configured maximum, the page must visibly state that the recap is truncated and must not present incomplete totals as complete financial facts.
The truncation state must be programmatically available to tests and assistive technology.
If a complete annual recap is a product requirement above the current ceiling, implement a scalable server-side aggregation with explicit scoping and tests instead of merely raising the cap.

### Required tests

- Add a loader test with at least 1,001 rows proving that the second range is requested and included.
- Add a stable-order test with duplicate dates proving that the ID tie-breaker prevents gaps or duplicates.
- Add a 16,497-row equivalent fixture or paginated mock proving the UI count and all derived totals use the full below-ceiling set.
- Add an above-ceiling test proving a visible warning is rendered and false complete totals are not claimed.
- Add a live E2E assertion comparing the displayed transaction count, income, spending, and largest purchase with direct database truth.

### Acceptance criteria

- The reviewed 16,497-row year no longer displays 1,000.
- All annual values match independently calculated database truth.
- A result over the bounded ceiling is clearly and accessibly identified as incomplete.
- Query failures reach the existing error boundary and are not converted to zero-valued financial summaries.

## Workstream 2: F2, Review PDF export fails and ignores the visible monthly contract

### Confirmed behavior

Clicking `Export PDF` on `/review?month=2026-08` with 3,018 relevant transactions navigated to `/api/export/report?month=2026-08` and returned HTTP 500 with `application/json`.
The raw JSON error replaced the FundFlow interface.
Source inspection found an unpaginated transaction query and one large `transaction_splits.in("transaction_id", transactionIds)` request in `lib/weekly-report-data.ts`.
The Review page describes a monthly snapshot, while the export route currently generates the weekly report period and does not use the visible month parameter.

### Primary source files

- `app/review/page.tsx`
- `app/api/export/report/route.ts`
- `lib/weekly-report-data.ts`
- `lib/report-period.ts`
- `lib/weekly-report.ts`
- `lib/report-pdf.ts`
- `components/ui/ButtonLink.tsx`
- `tests/unit/weekly-report-data.test.ts`
- `tests/unit/report-pdf.test.ts`
- `tests/unit/cron-weekly-report-route.test.ts`
- `tests/unit/export-formats.test.ts`

### Required implementation

Make the Review export contract honest.
Because the page is explicitly a selected-month review and sends `month=YYYY-MM`, the downloaded PDF must represent that selected month unless the visible action is renamed and redesigned to clearly request a weekly report.
Do not silently ignore the month query parameter.
Validate the month parameter using the repository's existing date helpers and return a user-safe `400` response for invalid input.
Keep the Monday cron's weekly report contract unchanged unless a shared internal loader can support both periods without changing its output.

Paginate every transaction read that can exceed the Supabase response limit.
Use a stable date and ID order.
Chunk transaction IDs before calling `.in()` for split rows.
The existing finance-query code uses 500-ID chunks as precedent, but confirm the generated request size and reduce the chunk size if UUID encoding still approaches URL limits.
Run chunk queries with bounded concurrency rather than firing an unbounded number of requests.
Preserve explicit `user_id` scoping on the service client.
Propagate all query errors with context and without leaking sensitive database details to the response body.

Return a successful PDF as `application/pdf` with a safe `Content-Disposition: attachment` filename that identifies the selected period.
Use a native download link or ensure `next/link` prefetch is disabled for the non-page API endpoint.
The click must trigger a browser download event and leave the Review page usable.
Do not render an API JSON document as the user's final page on ordinary failure.
Show an in-app error or preserve the page when a download fails.

### Required tests

- Add a pagination test with more than 1,000 transactions.
- Add a split-chunk test proving no `.in()` call receives the whole multi-thousand ID set.
- Add an error test for a failed page or failed split chunk.
- Add selected-month contract tests proving August data does not become a current-week report.
- Add an invalid-month test.
- Add a route test for `200`, `application/pdf`, attachment filename, and `Cache-Control: no-store`.
- Add a Playwright test that starts waiting for `page.waitForEvent("download")` before clicking `Export PDF`.
- Verify the downloaded file is non-empty, has a PDF signature, uses the expected filename, and contains the selected period's expected totals.
- Add a large-data live test with at least 3,018 relevant transactions and assert that no same-origin 5xx response occurs.

### Acceptance criteria

- The reviewed export produces a valid file instead of HTTP 500.
- The selected month in the UI matches the selected month in the document.
- The browser remains in a usable FundFlow flow.
- Weekly scheduled reports continue to produce the same weekly contract.
- No service-client query can cross user boundaries.

## Workstream 3: F3, Duplicate Review buries the ledger

### Confirmed behavior

Dozens of full Duplicate Review forms can render before the transaction filters and register.
On mobile, the user may scroll through a very long repeated form stack before reaching the ledger they opened.

### Primary source files

- `app/transactions/page.tsx`
- `components/transactions/DuplicateReview.tsx`
- Duplicate candidate loaders and routes found by graphify or `rg`
- `tests/e2e/duplicate-review.spec.ts`
- `tests/unit/duplicate-review-render.test.ts`
- `tests/unit/duplicate-routes.test.ts`

### Required implementation

Replace the unbounded stack with progressive disclosure.
Render a compact summary that states the candidate count and exposes one pair at a time, a deliberately capped first group, or a dedicated review workflow.
Keep the transaction controls and ledger immediately reachable on desktop and mobile.
Do not remove confirm, keep-both, dismiss, undo, keyboard, or focus behavior that already exists.
Do not discard candidates merely to shrink the DOM.
If pagination or a dedicated route is used, preserve candidate state and deterministic order between actions.
After a decision, move focus to the next candidate or a clear status message.
Announce result and remaining count through an accessible status region.

### Required tests

- Add a render test with at least 50 candidates proving the initial DOM contains only the allowed bounded number of full review forms.
- Test each decision action, result announcement, focus movement, and remaining count.
- Test that dismissed or resolved pairs do not reappear unexpectedly after refresh.
- Add a 390px E2E test proving the transaction controls and first ledger rows are above the unbounded candidate stack or one explicit action away.
- Assert that the page body height and DOM node count stay within a documented bound for the 50-candidate fixture.

### Acceptance criteria

- Fifty or more candidates cannot bury the ledger.
- Every candidate remains reviewable.
- Mouse, keyboard, and screen-reader workflows remain complete.
- No action can resolve a pair for another user.

## Workstream 4: F4, zero values carry false direction semantics

### Confirmed behavior

Some transaction rows displayed `-$0.00`.
Some report rows represented `$0.00` as money in with positive color.
Other surfaces already displayed neutral `$0.00`, so the application is inconsistent.

### Primary source files

- `lib/format.ts`
- `app/transactions/page.tsx`
- `components/transactions/MobileLedgerList.tsx`
- `components/dashboard/LedgerStrip.tsx`
- `components/reports/ReportTransactions.tsx`
- `tests/unit/format.test.ts`
- `tests/unit/report-transactions-render.test.ts`
- `tests/unit/report-transactions-responsive.test.ts`

### Required implementation

Define one small shared currency-direction rule if doing so removes duplicated inconsistent logic.
Normalize exact zero, JavaScript negative zero, and values that round to zero at the currency's display precision.
A displayed zero must have no leading plus or minus sign, no `In` or `Out` direction label, and no positive or negative color.
A zero day net must read `$0.00 net` in neutral text.
Keep non-zero Plaid sign semantics unchanged.
Do not use an arbitrary broad epsilon that turns a value which should round to one cent into zero.

### Required tests

- Test `0`, `-0`, `0.004`, `-0.004`, `0.005`, and `-0.005` for currencies used by the app.
- Test desktop transaction rows, mobile rows, report rows, Ledger Strip labels, and day-net rows.
- Use accessible-name assertions to confirm zero has no hidden `In`, `Out`, positive, or negative cue.
- Add a live browser assertion in both themes.

### Acceptance criteria

- Every visible and accessible zero is neutral.
- Values that round to a non-zero cent retain their correct sign and direction.
- Existing income, expense, transfer, refund, and split semantics do not regress.

## Workstream 5: F5, large report totals are clipped

### Confirmed behavior

At 1440px, multi-million Income and Spending values were truncated to strings such as `$2,039,73...`.
`components/reports/ReportSummaryPanel.tsx` applies `truncate` inside a five-column layout.

### Primary source files

- `components/reports/ReportSummaryPanel.tsx`
- `app/reports/page.tsx`
- `app/globals.css`
- `tests/unit/report-summary-render.test.ts`
- `tests/e2e/reports.spec.ts`

### Required implementation

Make the complete financial value visible at all supported widths.
Do not rely only on a tooltip, title attribute, or accessible name while hiding digits from sighted users.
Prefer a responsive grid, a bounded `clamp()` font size, sensible card wrapping, and tabular numerals over character truncation.
Do not split a currency value into visually ambiguous fragments.
Verify that labels and values do not collide when browser text zoom is 200 percent.

### Required tests

- Render positive and negative values with at least ten integer digits.
- Assert the component has no truncation class or clipped value contract.
- Add screenshots at 1440px, 768px, and 390px in light and dark themes.
- Test 200 percent zoom or an equivalent enlarged-font layout.

### Acceptance criteria

- Every digit is visible without horizontal document overflow.
- Summary cards retain a clear label-value hierarchy.
- The fix works for localized minus signs, currency codes, and long values already supported by the formatter.

## Workstream 6: F6, Cash Flow takes 9 to 10 seconds under load

### Confirmed behavior

`/cash-flow?range=12` took 9,151ms at desktop, 10,082ms at tablet, and 10,328ms at mobile with 30,497 total transactions.
The route eventually rendered, so the task is to remove measured bottlenecks without sacrificing correctness.

### Primary source files

- `app/cash-flow/page.tsx`
- `app/cash-flow/loading.tsx`
- `lib/cash-flow-data.ts`
- `lib/finance-query.ts`
- `lib/finance-domain.ts`
- `tests/unit/cash-flow-data.test.ts`
- `tests/unit/cash-flow-page-route.test.ts`
- `tests/unit/cash-flow-render.test.ts`
- `tests/e2e/cash-flow.spec.ts`

### Required implementation

Profile before changing the query plan.
Record server timing, query count, rows per query, split chunk count, bytes transferred, and browser navigation timing for the stress fixture.
Inspect Vercel Runtime Logs for the exact preview request when available.
Identify whether the dominant cost is serial pagination, split-query fan-out, over-fetching, projection work, cold execution, or rendering.

Parallelize only independent reads.
Avoid loading data outside the selected date window.
Avoid requesting split rows when there are no source transaction IDs.
Bound split-query concurrency and reuse an existing chunking helper only if the contract is truly shared.
Preserve deterministic pagination, refunds, duplicate exclusions, splits, merchant rules, category overrides, currencies, household scope, truncation warnings, and stale-sync warnings.
Do not cache user-specific financial results across users.
Do not hide the delay by increasing a timeout.
Keep or improve immediate loading feedback through the route's existing `loading.tsx` boundary.

### Performance target

On the same preview environment and approximately 30,500-row fixture, target a repeat navigation under 4 seconds at all three viewports.
If infrastructure cold start prevents that target on the first request, show meaningful loading feedback immediately and document separate cold and warm timings.
The optimized route must return the exact same financial values and truncation status as the pre-fix route.

### Required tests

- Add data-loader tests proving independent reads are parallel where intended.
- Add tests for no IDs, one split chunk, multiple chunks, failed chunks, and bounded concurrency.
- Compare the complete pre-fix and post-fix projected model for a deterministic fixture.
- Add a large-data E2E timing measurement with a documented threshold and enough tolerance to avoid ordinary CI flakiness.
- Keep a separate correctness assertion so a faster incomplete response cannot pass.

### Acceptance criteria

- Warm large-data navigation meets the target or a measured residual blocker is explicitly demonstrated.
- All totals match database truth.
- No cross-user cache or query behavior is introduced.
- The page gives immediate feedback during legitimate slow work.

## Workstream 7: F7, Forecasting widens the 390px document

### Confirmed behavior

At a 390px viewport, the document measured 399px wide.
The offending node was the screen-reader-only projection table in `components/forecasting/ForecastChart.tsx`.

### Primary source files

- `components/forecasting/ForecastChart.tsx`
- `app/forecasting/page.tsx`
- `tests/unit/forecasting-render.test.ts`
- `tests/e2e/responsive-interaction.spec.ts`

### Required implementation

Keep the projection data available to screen readers without allowing the table formatting context to affect document width.
Prefer applying `sr-only` to a normal wrapper around the table instead of applying it directly to the table formatting element, or use another native semantic representation that remains accessible.
Do not use `display: none`, `hidden`, `aria-hidden`, clipping of the whole page, or `overflow-x: hidden` on the document as the fix.
Constrain long column names and values inside the hidden representation.

### Required tests

- Assert the accessible tree still exposes the projection period and all scenario values.
- At 390px, assert `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
- Repeat the overflow assertion in both themes and after opening any chart details.
- Test a long localized value and the `Optimistic` column that previously caused the leak.

### Acceptance criteria

- The route has no document-level horizontal pan region.
- The accessible data equivalent remains complete and correctly associated with the chart.

## Workstream 8: F8, Reports has no date, merchant, or amount sorting

### Confirmed behavior

Reports exposes date ranges, modes, dimensions, pending state, scope, account filters, merchant filters, and category filters.
It does not expose the requested transaction sort controls.

### Primary source files

- `lib/reports.ts`
- `app/reports/page.tsx`
- `components/reports/ReportControls.tsx`
- `components/reports/ReportTransactions.tsx`
- Saved-report schemas and migrations if they persist the `ReportFilters` shape
- `tests/unit/reports.test.ts`
- `tests/unit/reports-data.test.ts`
- `tests/unit/report-transactions-render.test.ts`
- `tests/unit/report-transactions-responsive.test.ts`
- `tests/e2e/reports.spec.ts`

### Required implementation

Add an explicit sort field with `date`, `merchant`, and `amount` values and an explicit `asc` or `desc` direction.
Keep the sort state in URL search parameters so links are shareable and browser back and forward behavior remains correct.
Update `ReportFilters`, defaults, parsing, validation, serialization, saved-report handling, and any versioning contract that stores the shape.
If changing the persisted schema requires a filter-version bump, migrate or safely default old saved reports instead of breaking them.

Apply sorting after canonical projection and filtering but before URL pagination.
Use deterministic tie-breakers, ending with a unique transaction ID.
For merchant sorting, use the user-visible normalized merchant and a stable locale policy already used by the app.
For amount sorting, define whether signed amount or absolute magnitude is intended, label the UI honestly, and test the choice.
Preserve day grouping only when it remains semantically correct for the active order.
Non-date sorts must not display false day-group totals or headers that imply chronological order.
Keep every active filter and sort value when changing tabs, modes, date range, scope, or report page.
Reset pagination to page 1 when the sort changes.

### Required tests

- Test parser fallback for invalid sort values.
- Test query serialization and round-trip parsing.
- Test deterministic date, merchant, and amount order in both directions with ties.
- Test saved reports from the prior filter version.
- Test filtering plus sorting plus pagination together.
- Add keyboard-accessible E2E interactions for every sort option at desktop and mobile widths.
- Confirm direct URL navigation reproduces the selected order.

### Acceptance criteria

- Users can sort report transactions by date, merchant, and amount in both directions.
- The URL fully represents the state.
- Counts, totals, and breakdowns do not change when only row order changes.
- Page boundaries do not duplicate or omit rows.

## Workstream 9: F9, Settings controls lack accessible names

### Confirmed behavior

Axe reported critical unlabeled controls on Profile, Display, Institutions, Rules, and Data settings sections.
Affected controls include text inputs, a date input, selects, and file inputs.

### Primary source files

- `components/ui/Field.tsx`
- `components/settings/ProfileSection.tsx`
- `components/settings/DisplaySection.tsx`
- `components/settings/ManualAccountsSection.tsx`
- `components/settings/MerchantRulesSection.tsx`
- `components/settings/ImportSection.tsx`
- `components/settings/ReceiptScanSection.tsx`
- Settings route and render tests under `tests/unit`
- `tests/e2e/settings.spec.ts`

### Required implementation

Associate every visible label with exactly one control through a stable unique `id` and matching `htmlFor`.
Use explicit native labels for inputs, selects, and file controls.
Do not rely on placeholder text as the accessible name.
Use `aria-label` only where no visible label can reasonably exist.
If a shared component generates IDs, use deterministic React-supported ID behavior and permit callers to supply an ID when tests or forms require it.
Associate hint and error text through `aria-describedby` when appropriate.
Ensure repeated dynamic forms do not create duplicate IDs.

### Required tests

- Use `getByLabel` to locate and operate every affected control.
- Assert each visible label's `htmlFor` resolves to the intended control.
- Test repeated merchant-rule and manual-account forms for unique IDs.
- Run axe on each affected Settings section in light and dark themes.
- Manually verify keyboard order, file-picker activation from the label, error announcement, and focus visibility.

### Acceptance criteria

- Axe reports no `label` violation on any affected section.
- Every control has an accurate visible and programmatic name.
- Labels remain correct when multiple instances render.

## Workstream 10: F10, systemic WCAG contrast failures

### Confirmed behavior

The review found contrast failures on Login, Signup, and 32 of 36 authenticated desktop surfaces.
Representative failures were white on `#ff6b2e` at 2.83:1, light text on `#ff8a54` at 2.06:1 in dark mode, and secondary gray on white at 3.15:1.
The breadth indicates a token problem rather than isolated component defects.

### Primary source files

- `app/globals.css`
- `docs/PALETTE.md`
- `scripts/validate_palette.js`
- Shared Button, Link, text, chart, and navigation components using accent or muted tokens
- Existing palette and typography tests
- Authentication pages and shell navigation

### Required implementation

Inventory every semantic foreground-background token pair in light and dark themes.
Correct shared tokens and component variants at the narrowest central layer that fixes all affected uses.
Normal text must meet at least 4.5:1.
Large text and essential graphical or focus indicators must meet their applicable WCAG AA thresholds.
Check default, hover, active, selected, disabled, focus, and visited states.
Keep semantic distinctions between accent, muted, positive, negative, warning, danger, and chart data.
Do not solve the problem by making all text black or white, by increasing font weight alone when the calculated ratio still fails, or by exempting interactive brand colors as decorative.
Update the palette validator so future token changes fail when known text pairs fall below the required threshold.
Update `docs/PALETTE.md` with measured ratios if the repository's documented palette changes.

### Required tests

- Extend `npm run validate:palette` to validate the exact shared pairs used for text and controls.
- Run axe on Login, Signup, and all authenticated desktop surfaces in both themes.
- Sample tablet and mobile after token changes because responsive variants can change backgrounds.
- Verify focus outlines and selected controls manually with keyboard navigation.
- Use screenshots to inspect visual hierarchy, not merely numeric compliance.

### Acceptance criteria

- No axe `color-contrast` finding remains in the reviewed route matrix.
- Brand identity and semantic state remain visually distinct.
- The validator prevents regression of the exact failing token pairs.

## Workstream 11: F11, charts contain nested interactive controls

### Confirmed behavior

Axe reported `nested-interactive` on Dashboard Monitor, Dashboard Wealth, and Cash Flow.
Targets `.h-auto` and `.w-44` correspond to SVG chart roots that carry an interactive image role while also containing focusable SVG links.

### Primary source files

- `components/charts/TrendChart.tsx`
- `components/charts/DonutChart.tsx`
- Any bar-chart component used by Cash Flow with linked SVG marks
- `components/dashboard/MonitorView.tsx`
- `components/dashboard/WealthView.tsx`
- `app/cash-flow/page.tsx`
- Chart render tests and relevant browser tests

### Required implementation

Inspect the rendered DOM and accessible tree before choosing the fix.
Give each interaction one clear owner.
Do not place focusable chart links inside an element whose role makes it a single interactive or atomic image control.
For charts with linked marks, use a non-interactive group description plus separately focusable links with accurate names, or expose equivalent native links outside the SVG.
For non-linked charts, a single `role="img"` with an accessible name can remain appropriate.
Keep the visible chart, tooltips, data table, pointer behavior, keyboard navigation, and drill-down URLs.
Do not suppress axe, remove focusability from the only available drill-down, or add misleading ARIA roles.

### Required tests

- Add component tests for linked and non-linked chart variants.
- Assert there is no focusable descendant inside an atomic interactive or image role.
- Run axe on all three affected routes.
- Tab through every chart link and activate it with Enter.
- Confirm focus order and accessible names match the visual period or category.

### Acceptance criteria

- No `nested-interactive` violation remains.
- Every existing drill-down remains available to pointer and keyboard users.
- Screen readers receive a useful chart summary and useful link names.

## Workstream 12: F12, invalid Debt and Tags list semantics

### Confirmed behavior

Debt renders `Panel` sections directly under a `dl`, which leaves `dt` and `dd` elements without the required description-list relationship.
The empty Tags state renders a `p` directly under a `ul`.

### Primary source files

- `components/debt/DebtPlannerView.tsx`
- `components/ui/Panel.tsx`
- `components/settings/TagsSection.tsx`
- `tests/unit/debt-page-render.test.ts`
- `tests/unit/tags-route.test.ts`
- `tests/unit/tags.test.ts`
- `tests/e2e/debt.spec.ts`
- `tests/e2e/settings.spec.ts`

### Required implementation

Use native valid structures rather than ARIA patches.
For the Debt metrics, ensure each name-value group is a valid child group of the `dl`, such as a neutral wrapper containing its `dt` and `dd`, or use another appropriate semantic structure if the cards cannot preserve `dl` semantics.
Do not change `Panel` globally merely to repair one caller unless every caller benefits and tests prove the contract.
For Tags, render the empty message outside the `ul` or inside an `li` when it is legitimately list content.
Also label the tag rename and new-tag inputs if F9's control sweep finds they lack usable names.

### Required tests

- Assert valid direct-child structure for the Debt description list.
- Assert the Tags list contains only permitted list children.
- Run axe on both routes with populated and empty fixtures.
- Verify visual card styling remains unchanged at all three widths.

### Acceptance criteria

- Axe reports no `definition-list`, `dlitem`, or `list` violation.
- Native semantics remain meaningful without compensating ARIA.

## Regression gates for the five original PR fixes

The original PR-specific requirements that passed or partially passed must be rechecked after all remediation.

### Ledger Strip label threshold and density

Only major ticks or the current day-bucket contract may have permanent labels according to the current approved implementation.
A small coffee outflow must not receive a permanent label.
At 30 to 40 checking-account entries, labels must not overlap and the widget must not create an internal or document scrollbar at 390px.

### Zero rendering

Dashboard Recent Activity, mobile transactions, Reports, desktop transaction rows, day nets, and Ledger Strip values must all render display-zero neutrally.

### Recent Activity register styling

Rows must remain contiguous with alternating backgrounds and dividers.
Do not reintroduce individual rounded pill cards.

### Receipt workflow

Through the real UI, upload a receipt and exercise attach, ignore, restore, and delete.
Verify `PATCH` and `DELETE /api/receipts/{id}` return successfully and the UI state updates without reload errors.

### Past-month dashboard

Load `/dashboard?month=2026-07` and at least one older month.
Verify Ledger Strip balances and dashboard totals against database truth.
Confirm the prior parallel-read performance improvement remains intact.

## Full browser acceptance matrix

Run the final authenticated matrix at 1440px, 768px, and 390px in both light and dark themes.
Cover these surfaces:

- `/dashboard?month=2026-08`
- `/dashboard?month=2026-08&view=monitor`
- `/dashboard?month=2026-08&view=plan`
- `/dashboard?month=2026-08&view=wealth`
- `/accounts`
- `/transactions?month=2026-08`
- `/transactions/receipts`
- `/cash-flow?range=12`
- Every Reports tab and mode
- `/forecasting`
- `/budget`
- `/debt`
- `/investments`
- `/recurring`
- `/notifications`
- `/review?month=2026-08`
- `/wrapped?year=2026`
- `/goals`
- `/advice`
- `/admin`
- Every Settings section
- `/login`
- `/signup`

For Transactions and Reports, exercise every requested sort, month or date range, account filter, category filter, merchant filter, pending state, report tab, report mode, and pagination state.
Use direct URLs as well as control clicks to prove search-parameter round trips.

For every navigation, fail on:

- An application console error or warning, excluding documented browser-engine noise.
- An uncaught page exception.
- A failed same-origin request or any same-origin 5xx response.
- A stuck loading state.
- Document-level horizontal overflow.
- Content clipping that hides financial information.
- Overlapping labels or controls.
- False signed or colored zero values.
- Missing accessible names.
- Axe violations at the target WCAG 2.2 AA ruleset.
- Incorrect totals compared with database truth.

Do not report canceled `?_rsc=` prefetch requests as application failures when the test itself aborted them by navigating away.
Do report a request that fails during a direct user action or reproduces without an artificial abort.

## Required automated verification

Run focused tests during each workstream, then run the complete gates from a clean dependency install when practical.

```bash
npm run lint
npm run typecheck
npm run validate:palette
npm run test:unit
npm run build
npm run test:e2e
```

Do not update visual baselines merely to make a changed screenshot pass.
Inspect every intended difference first.
The original QA task said the previously committed dashboard baselines were deliberately stale, so do not misclassify their old diff as a new product bug.
If this remediation intentionally changes those surfaces and the operator authorizes baseline regeneration, record exactly which baselines changed and why.

If any unrelated lint failure, test failure, flaky test, or clearly broken UI appears, reproduce and fix it under the repository's fix-it-when-seen rule without broad unrelated refactoring.
Keep a record separating pre-existing failures, new failures, and verified fixes.

## Final delivery requirements

Do not claim completion until every F1 through F12 acceptance criterion is either proven passing or backed by a concrete blocker that cannot be resolved within the authorized scope.
Produce a final remediation report, preferably `ui-review-remediation.md`, containing:

1. The exact starting and ending commit SHA.
2. The exact preview deployment ID and URL used for final QA.
3. A finding-by-finding table for F1 through F12 with status, root cause, files changed, tests added, and evidence links.
4. Before and after screenshots for every visual issue.
5. Database truth and displayed values for Year in Money, Review PDF, Reports, and Cash Flow.
6. Cold and warm Cash Flow timings at all three viewports.
7. A route by viewport by theme pass or fail matrix.
8. Axe results for all reviewed routes.
9. The output of lint, typecheck, palette validation, unit tests, build, and E2E tests.
10. Confirmation that all disposable users and rows were removed, including residual row counts by table.
11. Any dependency update made or skipped after `npm-check-updates`.
12. Any residual uncertainty, explicitly labeled and never presented as a pass.

Keep [`ui-review.md`](./ui-review.md) as the immutable record of the original failing run unless the operator explicitly asks you to revise it.
Do not push, merge, promote a deployment, or mutate production data unless the operator explicitly authorizes that action.
If commit creation is authorized, use focused commits and never add an agent co-author.

## Definition of done

The work is done only when:

- Year in Money is correct above 1,000 rows and honest above any intentional ceiling.
- The selected-month Review PDF downloads successfully above 1,000 rows and represents the selected month.
- Duplicate Review cannot bury the transaction ledger.
- Every display-zero is direction-neutral.
- Large report totals show every digit.
- Cash Flow meets the measured performance target without losing correctness.
- Forecasting has no 390px overflow and retains accessible data.
- Reports supports deterministic URL-backed date, merchant, and amount sorting.
- Every Settings control has an accurate visible and programmatic label.
- All shared color pairs meet WCAG AA in both themes.
- Finance charts have no nested interactive controls and retain all drill-downs.
- Debt and Tags use valid native list semantics.
- The original PR-specific five workflows still pass.
- The full automated and live browser gates pass.
- Cleanup proves zero residual throwaway data.
