# FundFlow UI review with large-data stress

## Verdict

**DO NOT SHIP.**
Every reviewed page returned HTTP 200 and rendered its main surface, but the large-data run exposed two high-severity correctness and workflow failures: Year in Money silently reports only 1,000 of 16,497 transactions, and the Review PDF export returns HTTP 500 and replaces the app with a raw JSON error page.
The current PR head also retains the previously reproduced Duplicate Review takeover and incomplete zero-amount rendering.

## Tested target

- Preview: `https://fund-flow-git-feat-register-visual-rollout-v2-navaneethbv.vercel.app`
- PR: `#134`, branch `feat/register-visual-rollout-v2`
- Exact tested head: `4d12f6bb3092837ac1e9b1aad8a4b8ba9f07f112`
- Vercel deployment: `dpl_GszAgHS17ZJAfmZcSa7kU6JY4HYb`
- Large-data run: `2026-08-28T20:20:16.622Z` through `2026-08-28T20:26:25.370Z`
- Dataset: 30,497 transactions total, 2,087 in August 2026, 16,497 in calendar year 2026, 12 goals, 8 budgets, 3 accounts, and one populated investment holding
- Responsive coverage: 36 authenticated surfaces at 1440px, 768px, and 390px in light and dark themes
- Auth coverage: Login and Signup at all three viewports
- Total authenticated route navigations: 108
- Total authenticated theme captures: 216
- Automated accessibility coverage: WCAG 2.2 AA axe scan on every desktop surface and both auth pages
- Raw results: [`results.json`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/results.json)
- Focused export reproduction: [`export-repro.json`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/export-repro.json)
- Desktop contact sheet: [`contact-desktop-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/contact-desktop-light.png)
- Mobile contact sheet: [`contact-mobile-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/contact-mobile-light.png)

The stress dataset deliberately exceeded the Supabase 1,000-row response cap and the app's 25,000-row bounded-query ceiling.
This was necessary because a small fixture cannot prove that annual totals, exports, filters, or derived finance pages remain correct at realistic long-term volume.

## Route review

`Pass` means the page loaded, exposed its expected main content, had no document-level overflow, and showed no visible broken or stuck state in that viewport.
The table references finding IDs where a route has a confirmed route-specific defect.
The systemic contrast finding F10 applies across most pages and is not repeated in every row.

| Surface | Desktop | Tablet | Mobile | Notes |
|---|---|---|---|---|
| Login | Pass | Pass | Pass | F10 contrast failure |
| Signup | Pass | Pass | Pass | F10 contrast failure |
| Dashboard Overview | Pass | Pass | Pass | Correctly rendered more than 2,000 current-month transactions |
| Dashboard Monitor | F11 | F11 | F11 | Nested interactive controls |
| Dashboard Plan | Pass | Pass | Pass | No layout or data failure |
| Dashboard Wealth | F11 | F11 | F11 | Nested interactive controls |
| Accounts | Pass | Pass | Pass | Populated checking, credit, and investment accounts rendered |
| Transactions | F3, F4 | F3, F4 | F3 | Large count and merchant sort were correct; known Duplicate Review and zero-format failures remain |
| Receipt inbox | Pass | Pass | Pass | Form and empty state rendered; prior same-head PATCH and DELETE flow passed |
| Cash Flow | F6, F11 | F6, F11 | F6, F11 | Correct page, but repeatably slow under load |
| Reports Cash Flow | F5, F8 | F5, F8 | F8 | Current-month count was exact |
| Reports Spending | F5, F8 | F5, F8 | F8 | Current-month count was exact |
| Reports Income | F5, F8 | F5, F8 | F8 | Current-month count was exact |
| Reports Trends | F5, F8 | F5, F8 | F8 | Current-month count was exact |
| Forecasting | Pass | Pass | F7 | 390px document overflow from the screen-reader table |
| Budget | Pass | Pass | Pass | Twelve-month stress data and budgets rendered |
| Debt payoff | F12 | F12 | F12 | Invalid description-list structure |
| Investments | Pass | Pass | Pass | Holding, allocation, and performance rendered |
| Recurring | Pass | Pass | Pass | Loaded without timeout or stuck state |
| Notifications | Pass | Pass | Pass | Populated notification cards remained usable |
| Review | F2 | F2 | F2 | PDF export fails under load |
| Year in Money | F1 | F1 | F1 | Silent 1,000-row cap corrupts every annual result |
| Goals | Pass | Pass | Pass | Twelve goal cards rendered responsively |
| Advice | Pass | Pass | Pass | All tasks rendered; one desktop cold navigation was slow but did not repeat |
| Admin boundary | Pass | Pass | Pass | Non-admin user correctly saw `Admin access required` |
| Settings Profile | F9 | F9 | F9 | Inputs lack accessible labels |
| Settings Display | F9 | F9 | F9 | Select controls lack accessible names |
| Settings Notifications | Pass | Pass | Pass | No route-specific failure |
| Settings Security | Pass | Pass | Pass | No route-specific failure |
| Settings Integrations | Pass | Pass | Pass | No route-specific failure |
| Settings Household | Pass | Pass | Pass | No route-specific failure |
| Settings Settle up | Pass | Pass | Pass | Correct empty state for a one-member household |
| Settings Institutions | F9 | F9 | F9 | Account-type select lacks an accessible name |
| Settings Categories | Pass | Pass | Pass | Eight budget rows rendered |
| Settings Merchants | Pass | Pass | Pass | No route-specific failure |
| Settings Rules | F9 | F9 | F9 | Match-type select lacks an accessible name |
| Settings Tags | F12 | F12 | F12 | Invalid list structure |
| Settings Data | F9 | F9 | F9 | File inputs lack accessible labels |

## Confirmed findings

### F1: Year in Money silently drops transactions above 1,000

- Severity: **High**
- Route: `/wrapped?year=2026`
- Viewports and themes: all tested combinations
- Database truth: 16,497 transactions in 2026
- UI result: exactly 1,000 transactions tracked
- Warning: none
- Evidence: [`finding-wrapped-large-count.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/finding-wrapped-large-count.png)

The annual totals, income, spending, savings rate, top categories, top merchants, biggest month, and largest purchase are all calculated from the same incomplete 1,000-row result.
The screenshot therefore looks polished but presents materially incorrect financial information.
Source inspection confirms that `app/wrapped/page.tsx:38` performs one unpaginated transaction query before computing the recap.

### F2: Review PDF export returns HTTP 500 under load

- Severity: **High**
- Route: `/review?month=2026-08`, action `Export PDF`
- Focused reproduction size: 3,018 transactions
- Response: HTTP 500, `application/json`
- Response body: `{"error":"Something went wrong. Please try again."}`
- Final browser URL: `/api/export/report?month=2026-08`
- Evidence: [`finding-pdf-export-500.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/finding-pdf-export-500.png)

The action leaves the FundFlow UI and replaces it with a raw JSON error page.
The broader 30,497-row run also observed the same endpoint returning 500 through page prefetches.
Source review points to two non-scalable reads in `lib/weekly-report-data.ts`: the weekly transaction query is not paginated, and all returned IDs are passed into one `transaction_splits.in(...)` request.

### F3: Duplicate Review can bury the transaction ledger

- Severity: **High**
- Route: `/transactions`
- Evidence source: immediately preceding live-data run on the same exact commit
- Evidence: [`transactions-mobile-dark.png`](qa-shots/pr134-2026-08-28T20-00-14-019Z/transactions-mobile-dark.png), [`interaction-transactions-filtered.png`](qa-shots/pr134-2026-08-28T20-00-14-019Z/interaction-transactions-filtered.png)

Many repeated Duplicate Review forms can render before the transaction controls and ledger.
The large dataset intentionally used unique amount and merchant combinations so duplicate generation would not dominate every other page test, but the current head has not changed since this defect was reproduced.

### F4: Zero amounts still carry direction semantics

- Severity: **Medium**
- Routes: `/transactions`, `/reports`
- Evidence source: immediately preceding live-data run on the same exact commit
- Evidence: [`target-zero-transactions-desktop.png`](qa-shots/pr134-2026-08-28T20-00-14-019Z/target-zero-transactions-desktop.png), [`finding-zero-reports-desktop.png`](qa-shots/pr134-2026-08-28T20-00-14-019Z/finding-zero-reports-desktop.png)

Desktop and tablet transaction rows render `-$0.00`, and Reports renders `$0.00 In` with a positive direction color.
The dashboard and visible mobile transaction card render neutral `$0.00`, so the formatter behavior is inconsistent across responsive surfaces.

### F5: Large report totals are clipped and hide digits

- Severity: **Medium**
- Route: `/reports`
- Directly observed at: 1440px desktop in both themes
- Evidence: [`finding-reports-all-time-limit.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/finding-reports-all-time-limit.png)

The Income and Spending tiles render values such as `$2,039,73...` and `$3,934,46...` rather than the complete amount.
The underlying values exceed the width of the five-column summary layout, and `components/reports/ReportSummaryPanel.tsx:59` explicitly truncates the monetary value.
Financial totals should remain readable, wrap safely, reduce type size, or expose the full value through an accessible detail mechanism.

### F6: Cash Flow takes about 9 to 10 seconds to load with 30,497 rows

- Severity: **Medium**
- Route: `/cash-flow?range=12`
- Desktop: 9,151ms
- Tablet: 10,082ms
- Mobile: 10,328ms
- Evidence: [`cash-flow-mobile-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/cash-flow-mobile-light.png), [`results.json`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/results.json)

The route eventually renders correct-looking content and does not time out, but the delay is repeatable at all three viewports and is well beyond a responsive interaction threshold.
Forecasting was the next consistent outlier at 5.5 to 7.5 seconds, while most other authenticated routes completed in roughly 1.2 to 4 seconds.

### F7: Forecasting creates document-level horizontal overflow on mobile

- Severity: **Medium**
- Route: `/forecasting`
- Viewport: 390px, both themes
- Document width: 399px against a 390px viewport
- Evidence: [`forecasting-mobile-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/forecasting-mobile-light.png), [`results.json`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/results.json)

The overflowing nodes are the screen-reader-only projection table and its Optimistic column.
The table begins at `components/forecasting/ForecastChart.tsx:89`.
Even visually hidden content must be constrained so it does not widen the document and create a horizontal pan region.

### F8: Reports exposes no requested sorting controls

- Severity: **Medium**
- Route: all Reports tabs and modes
- Viewports and themes: all tested combinations
- Evidence: [`reports-cash-flow-desktop-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/reports-cash-flow-desktop-light.png)

Date ranges, breakdown modes, dimensions, pending state, account filters, merchant filters, and category filters are available.
There is no date, merchant, or amount sort control for the report transaction table, so the requested sorting workflow cannot be performed.

### F9: Multiple Settings form controls have no accessible name

- Severity: **Medium**
- Routes: Settings Profile, Display, Institutions, Rules, and Data
- Axe impact: critical
- Evidence: [`settings-profile-desktop-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/settings-profile-desktop-light.png), [`settings-data-desktop-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/settings-data-desktop-light.png), [`results.json`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/results.json)

Affected controls include the Profile text and date inputs, Display selects, Institutions account-type select, Rules match-type select, and Data file inputs.
Visible nearby text does not programmatically label these controls, so assistive technology cannot reliably announce their purpose.

### F10: Color contrast fails WCAG AA across most of the product

- Severity: **Medium**
- Routes: Login, Signup, and 32 of 36 authenticated desktop surfaces
- Axe impact: serious
- Evidence: [`auth-login-desktop.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/auth-login-desktop.png), [`results.json`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/results.json)

Representative failures include white text on the orange `#ff6b2e` button at 2.83:1, light text on `#ff8a54` at 2.06:1 in dark mode, and secondary gray text at 3.15:1 on white.
Normal text requires 4.5:1 under WCAG AA.
The repeated failures indicate a token-level contrast problem rather than isolated component mistakes.

### F11: Interactive controls are nested on three finance views

- Severity: **Medium**
- Routes: Dashboard Monitor, Dashboard Wealth, and Cash Flow
- Axe impact: serious
- Evidence: [`dashboard-monitor-desktop-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/dashboard-monitor-desktop-light.png), [`cash-flow-desktop-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/cash-flow-desktop-light.png), [`results.json`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/results.json)

Focusable descendants are placed inside another interactive control.
This produces invalid focus and activation behavior for keyboard and assistive-technology users even though pointer interaction appears visually normal.

### F12: Debt and Settings Tags use invalid semantic list markup

- Severity: **Low**
- Routes: `/debt`, `/settings?section=tags`
- Axe impact: serious
- Evidence: [`debt-desktop-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/debt-desktop-light.png), [`settings-tags-desktop-light.png`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/settings-tags-desktop-light.png), [`results.json`](qa-shots/ui-review-large-2026-08-28T20-20-16-621Z/results.json)

Debt places `section` elements directly under a `dl` and leaves `dt` and `dd` elements without a direct `dl` parent.
Settings Tags places a `p` directly inside a `ul` instead of an `li`.

## Large-data behavior that passed

- Transactions displayed the exact current-month count of 2,087 at every viewport.
- Merchant sorting over those 2,087 rows completed in 2,583ms and preserved the exact count.
- All four current-month Reports surfaces displayed the exact count of 2,087 at every viewport.
- An all-time Report reached the intentional 25,000-row ceiling, displayed 25,000, and clearly warned that the range was truncated.
- The all-time Reports warning advised narrowing the date range for complete totals.
- No page remained on a Loading state.
- No route returned a non-200 main navigation response.
- No page showed an application error shell or uncaught page exception.
- No document-level horizontal overflow was found outside Forecasting at 390px.
- Admin authorization correctly blocked the disposable non-admin user.
- The investment account, holding, allocation, and performance chart remained usable with the large transaction history present.

Canceled `?_rsc=` prefetch requests were not classified as application failures because they were aborted when the sequential audit moved to the next route.
The PDF export 500 was retained because it reproduced through a direct real-user click without an RSC prefetch parameter.

## Cleanup

Cleanup completed after the 30,497-row run and after every focused reproduction attempt.
The main run returned `DELETE /api/demo` status 200, deleted the Supabase Auth user, and confirmed zero residual rows in every seeded table:

| Table | Residual rows |
|---|---:|
| `transactions` | 0 |
| `accounts` | 0 |
| `plaid_items` | 0 |
| `receipts` | 0 |
| `budgets` | 0 |
| `goals` | 0 |
| `securities` | 0 |
| `holdings` | 0 |
| `holding_snapshots` | 0 |

The focused 3,018-row PDF export reproduction also returned `DELETE /api/demo` status 200, deleted its Auth user, and left zero rows in transactions, accounts, Plaid items, receipts, budgets, and goals.
No production user data was accessed or modified.

## Environment note

The preview remains behind Vercel deployment protection and redirects a clean browser to Vercel SSO.
The automated review used the designated Vercel protection-bypass cookie without recording or exposing its value.
The installed Vercel CLI is `59.5.0`, while `59.9.1` is available; upgrade with `npm i -g vercel@latest` before the next deployment QA run.

## Accessibility limitation

The automated axe pass covers only the subset of WCAG that can be detected programmatically.
This review did not perform a full screen-reader journey, so the absence of additional automated findings is not proof of complete accessibility.
