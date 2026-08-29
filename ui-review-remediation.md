# FundFlow PR #134 UI review remediation

## Scope and identities

- Starting commit SHA: `4d12f6bb3092837ac1e9b1aad8a4b8ba9f07f112` (the exact head the review tested).
- Ending commit SHA: `4d12f6bb3092837ac1e9b1aad8a4b8ba9f07f112`. All remediation work is present in the working tree as uncommitted changes on `feat/register-visual-rollout-v2`; no commit, push, merge, or deployment was performed because the operator did not authorize it.
- Local working-tree identity matched the remote PR head (`origin/feat/register-visual-rollout-v2`) before any change.
- Final QA environment: the local Next.js dev server (`http://localhost:3000`) against the permitted live Supabase project `zrxbmmtqqhlwtrinocww`, using disposable Auth users only.
- No Vercel preview deployment ID is available: deploying the branch to a preview was not authorized, so the full browser matrix was executed locally instead. A Vercel preview deploy of the head should reproduce the same results; the cold/warm Cash Flow numbers below were measured on the local dev server.
- Every disposable user and row was removed after each run (see Cleanup).

## Dependency check (`npx npm-check-updates`)

Applied safe patch updates: `next` 16.3.2 → 16.3.3, `eslint-config-next` 16.3.2 → 16.3.3, `@supabase/supabase-js` 2.112.3 → 2.112.4, `nodemailer` 9.0.5 → 9.0.6. Added `@axe-core/playwright` as a dev dependency for live accessibility verification.

Skipped, with reasons:
- `eslint` 9 → 10, `typescript` 6 → 7, `plaid` 43 → 46: major bumps that risk breaking the toolchain; not needed for these fixes.
- `@anthropic-ai/sdk` 0.120 → 0.122, `@supabase/ssr` 0.12.4 → 0.12.5, `sharp` 0.35.3 → 0.35.4: major-version-zero bumps with no benefit for this remediation.
- `lucide-react` 1.33 → 1.35: minor feature bump; skipped to avoid icon churn mid-task.

## Finding-by-finding table

| Finding | Status | Root cause | Files changed | Tests added / evidence |
|---|---|---|---|---|
| F1 Year in Money silently drops rows after 1,000 | **Fixed** | `app/wrapped/page.tsx` ran one unpaginated select capped at 1,000 rows; totals were derived from the incomplete set | `app/wrapped/page.tsx`, `lib/annual.ts`, `lib/finance-query.ts` | `annual.test.ts` (16,497-row fixture, transfer/refund/split handling), `wrapped-page-ui.test.ts` (loader + truncation hook), `finance-query.test.ts` (second-range, duplicate-date stability, truncation). Live QA: displayed count 16,606 equals DB count; income/spend match DB truth |
| F2 Review PDF export fails and ignores the visible monthly contract | **Fixed** | `/api/export/report` generated the current-week period, ignored `month`, and `lib/weekly-report-data.ts` used an unpaginated transaction read plus one giant `in()` splits call that overflowed Node's header limit | `app/api/export/report/route.ts`, `app/review/page.tsx`, `components/review/ExportReportButton.tsx`, `lib/weekly-report-data.ts`, `lib/report-period.ts` | `weekly-report-data.test.ts` (1,500-row pagination, split chunks ≤250, error propagation), `report-period.test.ts` (monthly period), `export-routes.test.ts` (200/pdf/attachment/no-store, 400 invalid month), `tests/e2e/review-export.spec.ts` (download + %PDF + filename). Live QA: 2026-08 PDF downloads, no 5xx |
| F3 Duplicate Review buries the ledger | **Fixed** | `components/transactions/DuplicateReview.tsx` rendered every candidate as a full form; the `/api/transactions/duplicates` loader also sampled only 1,000 unordered recent rows | `components/transactions/DuplicateReview.tsx`, `app/api/transactions/duplicates/route.ts` | `duplicate-review-render.test.ts` (50 candidates → 1 form, status region), `duplicate-routes.test.ts`, `tests/e2e/duplicate-review.spec.ts` (390px, 2 candidates, 1 form). Live QA: 67 candidates → 1 full form, ledger reachable |
| F4 zero values carry false direction semantics | **Fixed** | Signed-amount helpers and `formatCurrency` rendered `-0`/`0.004` as `-$0.00` or `$0.00 In`; inconsistent across surfaces | `lib/format.ts` (`roundsToZero`), `components/ui/RegisterRow.tsx`, `components/transactions/MobileLedgerList.tsx`, `components/reports/ReportTransactions.tsx`, `components/dashboard/LedgerStrip.tsx`, `app/transactions/page.tsx`, `app/review/page.tsx`, `app/investments/page.tsx`, `components/accounts/AccountRow.tsx`, `components/goals/GoalsManager.tsx` | `format.test.ts` (`0`, `-0`, `0.004`, `-0.004`, `0.005`, `-0.005`), render tests for mobile rows, report rows, RegisterRow, day nets. Live QA: no `-$0.00`/`+$0.00` and neutral `$0.00` present in both themes |
| F5 large report totals are clipped | **Fixed** | `ReportSummaryPanel.tsx` and `CashFlowSummary.tsx` applied `truncate` to `text-2xl/3xl` values in fixed grids | `components/reports/ReportSummaryPanel.tsx`, `components/cash-flow/CashFlowSummary.tsx` | `report-summary-render.test.ts` (no truncate class, ten-integer-digit values, EUR, negatives) |
| F6 Cash Flow takes 9–10s under load | **Fixed** | Serial 31-page pagination in `fetchFinanceTransactions`; unbounded split-chunk fan-out; 500-id chunks overflowed the request line | `lib/finance-query.ts` (parallel count + bounded page batches, `runBatched`, 250-id split chunks), `lib/cash-flow-data.ts`, `lib/weekly-report-data.ts` | `finance-query.test.ts` (parallel batches, truncation, bounded concurrency), `cash-flow-data.test.ts`, `runBatched` tests. Live QA warm timings below |
| F7 Forecasting widens the 390px document | **Fixed** | `sr-only` applied directly to the `<table>` let table layout widen the document | `components/forecasting/ForecastChart.tsx` | `forecasting-render.test.ts` (sr-only wrapper, overflow container, long values). Live QA: no 390px horizontal overflow |
| F8 Reports exposes no sorting controls | **Fixed** | No sort state existed in `ReportFilters` or the URL | `lib/reports.ts` (v2 schema, `applyReportSort`), `components/reports/ReportControls.tsx`, `app/reports/page.tsx`, `components/reports/ReportTransactions.tsx` | `reports.test.ts` (parse/round-trip/v1 migration/order determinism), `report-transactions-render.test.ts` (non-date sorts hide day headers), `tests/e2e/reports.spec.ts` (URL-driven sort at desktop) |
| F9 Settings controls lack accessible names | **Fixed** | `Field` rendered a label without `htmlFor` and controls had no `id`; file inputs were unlabeled | `components/settings/{ProfileSection,DisplaySection,ManualAccountsSection,MerchantRulesSection,ImportSection,ReceiptScanSection,TagsSection}.tsx` | `settings-controls-labels.test.ts` (every control linked by `htmlFor`/`id`), `tags-section-render.test.ts`. Axe clean on Profile, Display, Institutions, Rules, Data, Tags |
| F10 systemic WCAG contrast failures | **Fixed** | Token-level: white text on `#ff6b2e`, light text on `#ff8a54`, muted grays, tinted badges under 4.5:1 | `app/globals.css` (accent `#9a3412`, `--accent-foreground`, `--accent-strong-foreground`, darker muted/success/danger, lighter dark muted, warning foreground), `components/ui/{Button,Badge,Input}.tsx`, chart empty-state/header text, `scripts/validate_palette.js`, `docs/PALETTE.md` | `palette-validator.test.ts` (semantic text pairs gated at 4.5:1), `dashboard-command-center.test.ts` updated. Axe: zero color-contrast on 24 authenticated routes × 2 themes plus Login/Signup |
| F11 charts contain nested interactive controls | **Fixed** | `role="img"` on SVG charts that contained focusable links | `components/charts/{TrendChart,DonutChart,DivergingColumns}.tsx` | `charts-render.test.ts` (linked vs non-linked variants, no atomic role over links, drill-downs preserved) |
| F12 invalid Debt and Tags list semantics | **Fixed** | `dl` with `<section>` children; `p` directly inside `ul` | `components/debt/DebtPlannerView.tsx`, `components/settings/TagsSection.tsx` | `debt-page-render.test.ts` (valid dl children), `tags-section-render.test.ts` (empty message outside ul, unique ids). Axe clean on `/debt` and `/settings?section=tags` |

## Database truth vs displayed values

All from the final large-data QA run (30,606 transactions, 16,606 in 2026, 2,196 in August 2026).

| Surface | Displayed | Database truth | Match |
|---|---|---|---|
| Year in Money count (`/wrapped?year=2026`) | 16,606 | 16,606 | Yes |
| Year in Money income | $3,229,400.01 | $3,229,400.01 | Yes |
| Year in Money spend | $13,303,063.54 (varies per run with demo amount seeding) | identical to displayed | Yes |
| Year in Money largest purchase | Mega Income Co $2,000,000 | same | Yes |
| Reports 2026 income/spend | match DB truth | match | Yes |
| All-time Reports (2025–2026, 30,606 rows) | truncated warning shown; 25,000-row bounded read | 30,606 | Warning verified |

The database truth was computed independently in the QA script by paginating the year's rows and summing spend/income/largest under the same transfer-exclusion rule (`EXCLUDED_PFC` / `TRANSFER_GROUPS`) the canonical projection uses.

## Cash Flow timings (local dev server, 30,606 rows, range=12)

| Viewport | Cold | Warm |
|---|---|---|
| Desktop 1440 | 5,618 ms | 2,386 ms |
| Tablet 768 | 2,423 ms | 2,519 ms |
| Mobile 390 | 2,493 ms | 2,386 ms |

The reviewed head measured 9,151 ms / 10,082 ms / 10,328 ms. Warm navigations now meet the under-4s target at all three viewports; the desktop cold figure is a one-time compile/cold-start cost on the dev server and is reported separately. The pre-fix and post-fix routes return the same financial values (verified by DB-truth assertions).

## Route × viewport × theme matrix

The full 24-route matrix at 1440 px, 768 px, and 390 px in both themes was exercised via the E2E suite (35 passing functional tests) and the large-data QA (F1–F6 plus axe). No console errors, uncaught page exceptions, same-origin 5xx, stuck loading states, or document-level horizontal overflow were observed on the exercised routes. The dashboard visual-baseline spec shows expected diffs from the F10 token changes and is reported separately below.

## Axe results

`@axe-core/playwright` with the WCAG 2.0/2.1/2.2 A+AA tags, run on Login, Signup, and 24 authenticated routes in both light and dark themes:

- On the large-data fixture: zero WCAG AA violations.
- On a focused signed-in probe (24 routes × 2 themes): zero color-contrast violations.
- Auth pages (login/signup, unauthenticated): zero violations.

The palette validator now also gates the exact shared text pairs (foreground/muted/accent/accent-soft/accent-foreground/accent-strong-foreground/success/danger/warning/viz-pos/viz-neg/viz-muted and their fill foregrounds) at 4.5:1, so a future token change that reintroduces a failing pair fails the build.

## Gates

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm run validate:palette`: pass (light + dark, both the categorical and the semantic-text gates).
- `npm run test:unit`: 3,842 tests pass.
- `npm run build`: pass.
- `npm run test:e2e` (excluding visual baselines): 35 passed, 18 skipped (feature-flag/env-gated), 0 failed.

## Regression gates for the original PR fixes

- Ledger Strip label threshold and density: unchanged (the `lib/ledger-strip.ts` slot budgets and major-tick threshold remain); covered by `tests/unit/ledger-strip.test.ts`.
- Zero rendering: Dashboard Recent Activity (RegisterRow), mobile rows, Reports, desktop transaction rows, day nets, and Ledger Strip values all render display-zero neutrally via the shared `roundsToZero` rule.
- Recent Activity register styling: unchanged contiguous rows with alternating backgrounds and dividers.
- Receipt workflow: covered by `tests/e2e/receipts.spec.ts` (PATCH and DELETE `/api/receipts/{id}` return 200); the spec passes.
- Past-month dashboard: covered by `tests/e2e/dashboard.spec.ts` and the ledger-strip render tests; the parallel-read performance improvement in `lib/finance-query.ts` is intact.

## Residual uncertainty (explicitly not presented as a pass)

1. **Visual baselines.** `tests/e2e/visual-baseline.spec.ts` compares screenshots of 13 routes × 2 themes. The F10 token changes intentionally alter colors on every route, so this spec now diffs (dashboard was already flagged as deliberately stale by the review). Per the instructions, baselines were NOT regenerated without operator authorization. Operator decision needed: authorize `npx playwright test visual-baseline --update-snapshots` after inspecting the intended color diffs. All other functional E2E tests pass.
2. **Deployment QA.** No Vercel preview was created (deployment not authorized). The full matrix was verified against the local dev server and live Supabase. A production-build preview run is the remaining confirmation.
3. **Cold Cash Flow.** The desktop cold figure (5.6 s) exceeds the 4 s target on the dev server's first hit; warm navigations meet it. A production-build deployment may differ; document cold vs warm separately on the preview.
4. **`graphify-out/`** was regenerated with `graphify update .` and is not committed (it is gitignored by repo rule).

## Cleanup

After every large-data QA run and every focused probe, cleanup ran in a `finally` path: rows deleted by user id across all touched tables, the disposable Auth user deleted, and residual counts verified. Final residuals were zero for `transactions`, `accounts`, `plaid_items`, `receipts`, `budgets`, `goals`, `securities`, `holdings`, and `holding_snapshots`. One orphan user left by an externally aborted QA run was found and removed by a follow-up cleanup. No production user data was accessed or modified.

## Addendum: follow-up review fixes

A later review of this uncommitted work found two defects in the F2 fix and a few smaller items, all now fixed in the same working tree.

1. **Regression: the two other `/api/export/report` callers broke.** F2 made `month` mandatory, so the "Download weekly PDF report" link on `/reports` and "Export PDF report" on Settings (both parameterless) returned HTTP 400 with raw JSON. The route now treats `month` as optional: present is a monthly review, absent is the current week (matching the Monday cron). All three PDF buttons now go through `ExportReportButton` (fetch + blob), so a failure shows an in-app error rather than navigating to a JSON page.
2. **Correctness: the monthly PDF used weekly budget math and weekly copy.** `buildWeeklyReportModel` prorated every budget to `monthlyLimit * 12 / 52`, so a month of spend read as ~4x over on every budget, and the document said "Weekly insights" / "this week" / "VS LAST WEEK". `WeeklyReportPeriod` now carries `kind`; the model uses the full monthly limit for a monthly period and `generateWeeklyReportPdf` resolves its cadence copy from `kind`.
3. Smaller: `loadCanonicalProjection` no longer serializes its five dependency queries behind an awaited split-chunk batch; the receipt-scan picker shows the chosen filename; the `DuplicateReview` completion message no longer prints a stale count; two `app/globals.css` indentation slips fixed.

Gates re-run after these fixes: `lint`, `tsc --noEmit`, `validate:palette`, `test:unit` (333 files, 3,847 tests), and `build` all pass.
