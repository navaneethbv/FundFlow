# Sure live demo comparison, October 3, 2026

## Continuation and evidence boundaries

This continues [PR #220](https://github.com/navaneethbv/FundFlow/pull/220), whose fixes and previous acceptance remain separate.
The clean review worktree still points to `16af6b78e9011d508ab8943e89173068bfff14c8`.
Current fetched main is `dcedce46015d4e00b9d3af83e5149f4330afd804`.
The original checkout's unrelated changes were preserved.

Chrome opened the existing [Sure home page](https://sure.am/) and followed “Try it (sample data!)” to [the sample app](https://app.sure.am/).
This succeeded through normal browser controls in the desktop session, superseding the earlier live-demo access blocker only.
Inspection used the publicly offered sample account, navigation, filters, and unopened mutation forms.
No financial data was created, edited, deleted, imported, connected, or transmitted to the sample app.
No Sure code, assets, or translations were copied; Sure's AGPL source remains reference material only.

## Observations and comparison

| Capability | Live Sure evidence | Current FundFlow source and conclusion |
| --- | --- | --- |
| Report periods | Reports exposes Monthly, Quarterly, Year to Date, Last 6 Months, and Custom Range. Selecting Quarterly rendered Q4 2026 with October 1 through December 31 export links. | `components/reports/ReportControls.tsx` previously offered only From/To. This branch adds calendar shortcuts through the existing URL contract. |
| Report layout | The report has labeled sections with collapse and reorder controls, including keyboard instructions. | Dashboard layout controls exist behind `dashboardWidgetLayout`; they do not customize Reports. Report section persistence remains a gap. The demo controls were observed, but persistence was not tested by changing shared sample settings. |
| Tag search | Transactions > Filter > Tag offers named tags and Untagged. Applying Untagged changed the sample count from 7,301 to 7,300 and excluded the tagged payment row. | `ledger-page-data.ts` loads effective tags for display, including rule actions, but the query has no tag predicate. A future query must filter effective tags before pagination and avoid duplicate rows. |
| Report output | Reports includes Print Report, CSV, and Open in Google Sheets links. | FundFlow has filtered CSV and a separately labeled weekly PDF. The weekly PDF is not a custom-range report export. A custom-range printable report is a separate useful gap; do not describe the weekly download as equivalent. |
| Bills | Bills shows paid, unpaid, overdue, next-seven-day totals, calendar, income-plan navigation, and payment matching links. | Recurring occurrence expansion, payment links, and a default-off paycheck planner already exist. These are not entirely missing features. |
| Budget and goals | Plan shows budget progress, household/individual navigation, and goals with Behind/Reached labels. | Budget and goals exist; goal detail visuals and several planning enhancements are implemented behind flags. No reason to duplicate them. |
| Multi-currency | Demo accounts and investments show several original currencies alongside consolidated dashboard/report totals. | FundFlow deliberately separates totals by currency. This observation does not verify Sure's rate source, historical lookup accuracy, or licensing. Historical FX remains a provider/data-contract decision. |
| More providers and native/API clients | Earlier pinned public-source research documents them. The attempted New asset navigation did not produce a usable account-setup dialog in this sample session. | Plaid, manual accounts/imports, PWA, scoped exports, and default-off read-only MCP exist. Provider provisioning, API behavior, and native ingestion were not validated by this demo inspection. |

The demo's displayed date was October 4 while the user's local review date was October 3 PDT.
This reinforces the need to resolve FundFlow shortcuts from the viewer's configured timezone.
Sample data is shared and mutable; the observed counts are an interaction check, not a stable fixture or accounting benchmark.

## Bounded priorities and implementation

1. Report date shortcuts and navigation preservation: implemented here, without a migration or new dependency.
   This month and This quarter cover complete calendar periods; Last month covers the prior calendar month; Year to date ends today; Last 6 months includes the current month through today.
   Saving a report still stores concrete dates, with no incompatible saved-report format change.
   Date changes retain sorting, household, pending state, repeated account/category/merchant filters, and selected currency while resetting pagination.
   A failing render regression reproduced the prior custom-date sort reset.
   Browser testing reproduced stale form dates after Back; autocomplete restoration is disabled and the form is keyed by the applied range.
2. Tag/untagged ledger filters: next bounded product candidate, but effective rule tags and pagination need a single consistent query contract.
3. Atomic split/annotation/goal writes: higher correctness risk; requires a separate database change and actual rollback/concurrency acceptance before delivery.
4. Persisted report sections and custom-range printable output: useful follow-ups after the correctness work.
5. Historical FX, provider integrations, native distribution, and broader APIs: larger product and security decisions, not small parity patches.

## Split correctness investigation

At PR #220's head, `saveSplits` deletes `transaction_splits` and then inserts the replacement in separate awaited requests.
`saveAnnotation` and `saveGoalProgress` execute afterwards in further requests.
A later error returns failure but cannot roll back an earlier committed request.
Concurrent replacements can interleave; validation against a previously read transaction amount is also not a lock on the amount being modified.
Current route tests cover owner rejection, balanced/unbalanced input, clearing, and error responses, but mocked calls cannot prove committed rollback or lock behavior.

An acceptable fix must lock the owned transaction, validate the final split set against its locked amount, preserve omitted annotation fields, apply explicit clears, and update linked goal events within one transaction.
Tests must inject a failure after split deletion and after annotation writing and independently inspect that the old persisted state survives.
Concurrent saves must prove the final state is one complete request, with no mixed split set, and cross-owner attempts must fail without writes.
No split changes or production failure injection were performed in this branch.
A local PostgreSQL executable is available, but no disposable Supabase target with approved credentials was supplied for full Auth/RLS/Storage acceptance.

## Verification

The focused regressions and browser checks use synthetic data only.
The six browser cases cover 375px, 768px, and 1440px, each in light and dark modes, with actual report controls and the production CSS rendered into a local fixture.
They verify keyboard shortcut activation, inclusive dates, URL state, reload, Back, repeated filter retention, no horizontal overflow, and zero configured automated WCAG A/AA findings.
They do not establish live Supabase persistence, Next.js client navigation behavior, full assistive-technology acceptance, or production performance.
There is no screenshot baseline for this new fixture, so visual inspection is not a historical pixel-regression result.

Dependency freshness was checked: main's safe nodemailer/lucide updates are already in PR #220 and are not duplicated here.
ESLint 10 and TypeScript 7 remain separate, unverified major toolchain upgrades.
No page-speed, heap-size, or end-to-end performance improvement is claimed by this report-controls change.
Local whole-repository checks and exact-head hosted results are recorded in the PR delivery, separately from prior PR #220 evidence.
