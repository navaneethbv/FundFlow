# Post-merge functionality and Sure comparison

## Scope and evidence

Reviewed from `origin/main` at `dcedce4` on October 3, 2026.
The original checkout contained unrelated edits, so main was checked out and pulled in an isolated worktree before creating `fix/post-merge-functionality-review`.
Those original edits were not changed or included.

Production Chrome checks used the existing signed-in FundFlow session and did not create, edit, delete, upload, reconnect, revoke, or import financial data.
Calculators and query controls were exercised through their non-persisting navigation paths.
Save, retry, keyboard, accessibility, and responsive regression checks used synthetic browser fixtures, not production credentials or financial records.
These fixtures verify the real components with controlled responses; they do not prove Supabase persistence, RLS, or real provider delivery.

The Sure browser approval was declined by the browser control, so its live account was not inspected and no alternate access mechanism was attempted.
The comparison instead uses the public [Sure repository at 14638a7](https://github.com/we-promise/sure/tree/14638a70181d9adadc75e7d47d5b2975ee18bf46).
Sure is AGPL-3.0; no Sure implementation, assets, or translations were copied.
The ledger filter implementation below is independent and follows FundFlow's existing query and component contracts.

## Confirmed issues fixed in this branch

| Issue | Evidence and correction |
| --- | --- |
| Recurring price-change history opened an unfiltered ledger | Reproduced in live Chrome: the link used `search`, but the ledger parser consumes `q`. The link now uses `q`, with a rendered-link regression. |
| Clearing annotations could remove unrelated metadata | Route reproduction showed empty notes/tags or a split-only request could delete the entire annotation row, including classifications, goal links, and reconciliation state. Writes now update only supplied fields and never delete the row as a side effect of clearing notes. |
| Clearing the last note while supplying reconciliation state retained old text | The old cleared-only branch dropped explicit note/tag clears. A regression asserts both the cleared timestamp and explicit empty metadata in the write. |
| Mobile reconciliation state was omitted | The mobile row adapter did not forward the saved cleared flag to its editor. It now forwards it, with a component regression. |
| Cancelled reconciliation drafts resurfaced | Closing an editor without saving did not reset its cleared checkbox on reopening. Browser tests now assert the saved value is restored. |
| Closed editors retained global listeners | Two detail event listeners were registered per mounted editor, including hidden responsive copies. They now exist only while open. Browser instrumentation verifies zero closed, two open, and zero after close; this is a listener-lifetime result, not a measured page-speed or heap-size claim. |
| Calendar query could blank a disabled calendar surface | `view=calendar` was parsed even when the calendar flag was off. The page now falls back to the list, with a page-level regression. |
| Day/year filters were invisible and survived Clear filters | The page omitted these fields from query controls and the clear patch omitted them. They now have chips, clear together, and are removed when a new month is applied. |
| Mobile date/filter popovers extended off the left edge | Visual inspection of the synthetic mobile screenshot exposed clipped controls despite the page-width assertion passing. Narrow-screen popovers now use a viewport-contained position, and tests assert both dialog edges. |
| Manual holding fields lacked accessible names and network recovery | Confirmed unnamed controls in live Chrome. Explicit label associations and a recoverable connection error now preserve the draft and allow retry. Synthetic browser checks cover labels, failure, retry, and accessibility. |
| Hidden receipt picker caused horizontal overflow | Live Settings at 375px had a 424px document width; the hidden file input inherited full-width visual-input styles. A plain screen-reader-accessible file input fixes the cause. The synthetic regression failed at both widths before the fix and passed after it. |
| Receipt request failures were unhandled | Scan, attachment, and inbox-save requests now report recoverable errors, release busy state, and retain the selected file or scan result. Synthetic offline/retry tests verify all three paths without uploading real receipts. |

## First parity feature implemented

The transaction filter panel now supports inclusive minimum and maximum absolute amounts, plus pending-only or posted-only status.
Equal bounds represent an exact amount.
The controls describe that amounts use each transaction's original currency, not an invented cross-currency conversion.
They compose with money direction, account, date, search, sorting, and existing review filters.
Bounds are decimal-only and validated before interpolation into PostgREST syntax; invalid or injected URL values are discarded.
Reversed bounds are rejected by the panel.
Zero is a valid bound.

Filtering happens in the owner-scoped database query before direct pagination, projected sorting/calendar selection, and facet scans.
The query codec carries the new filters through navigation and saved view parameters.
No database migration, provider, feature-flag override, or additional dependency is needed for these controls.

## Remaining Sure feature differences

These are observed product differences, not a commitment to clone every Sure feature.

| Capability | Sure evidence | FundFlow status and next step |
| --- | --- | --- |
| Amount and posting-status search | [Transaction search](https://github.com/we-promise/sure/blob/14638a70181d9adadc75e7d47d5b2975ee18bf46/app/models/transaction/search.rb) | Implemented in this branch. |
| Tag and untagged ledger filters | Same search model includes tag and untagged matching without duplicate result rows. | Tags can be edited, but the ledger query has no tag predicate. Add an owner-scoped query contract before UI work; preserve pagination and avoid double-counting multi-tag rows. |
| Report period shortcuts and section layout | [Reports view](https://github.com/we-promise/sure/blob/14638a70181d9adadc75e7d47d5b2975ee18bf46/app/views/reports/index.html.erb) includes monthly, quarterly, YTD, last-six-months, custom, print, and section reorder/collapse. | FundFlow has date ranges, saved reports, charts/table twins, and PDF output. Report-specific period presets and persisted section reorder/collapse remain gaps; dashboard layout controls are a different surface. |
| Historical currency conversion | [Exchange-rate controller](https://github.com/we-promise/sure/blob/14638a70181d9adadc75e7d47d5b2975ee18bf46/app/controllers/exchange_rates_controller.rb) performs date-specific rate lookup. | FundFlow separates currency-sensitive totals and has a static reference-rate helper in `lib/currency.ts`, not a verified historical FX service. Provider rights, source date, freshness, and missing-rate semantics must be decided before consolidated FX reporting. |
| Alternative financial connectors | [Routes](https://github.com/we-promise/sure/blob/14638a70181d9adadc75e7d47d5b2975ee18bf46/config/routes.rb) expose additional bank, brokerage, and crypto integrations. | FundFlow's live banking boundary is Plaid, with manual accounts and imports. Extra providers require credentials, provisioning, security review, reconciliation contracts, and an explicit product priority. |
| Native clients and device ingestion | [Client guide](https://github.com/we-promise/sure/blob/14638a70181d9adadc75e7d47d5b2975ee18bf46/docs/clients.md) describes desktop/mobile companions and a FinanceKit publisher; mobile does not expose the complete web feature set. | FundFlow is a responsive web/PWA app. Native distribution and FinanceKit ingestion are separate platform work, not a small web parity patch. |
| General integration API | The client guide and `docs/api/openapi.yaml` expose broader client contracts. | FundFlow has scoped exports and a feature-gated read-only MCP endpoint, not equivalent general-purpose third-party CRUD. Any broader API needs capability scopes and privacy boundaries before implementation. |

Do not list import profiles/preflight/history/undo, compound rules/run history/suggestions, ledger details/bulk edits/undo, portfolio basis/tax buckets/look-through, or goal detail visuals as entirely missing.
These have implementation and tests on current main, but their defaults in `lib/feature-flags.ts` remain off.
This review did not enable them in production.

## Live acceptance matrix

| Surface | Read-only evidence |
| --- | --- |
| Dashboard | Overview and Monitor render. Income/outflow agrees with the corresponding current-month Cash Flow, Reports, and Budget views. Navigation waits for server rendering; the initial stale snapshot was not a broken Monitor link. |
| Accounts | Account list, balance-sheet totals, and percentage view render. Net worth agrees with the dashboard. |
| Transactions | Ledger loads, nonsense search returns the expected empty state, filter panel opens/cancels, and the recurring history-link defect is reproduced. |
| Cash Flow and Reports | Current-period charts, breakdowns, and filters render. No report was saved or emailed. |
| Budget | Empty configuration state and actual-income/outflow summary render. No budgets were seeded, copied, or changed. |
| Recurring | Active/upcoming/overdue and price-change surfaces render. No stream was dismissed, restored, or edited. |
| Goals | Existing goal and linked-balance progress render. No contribution or goal mutation was submitted. |
| Investments | Provider-unavailable holdings are explicitly labeled and account balances remain visible. Manual-holding dialog opens and cancels; form defects are covered synthetically. |
| Debt | Extra-payment projection and Avalanche/Snowball navigation work without persisted writes. Assumed APRs remain visibly identified. |
| Forecasting | Scenario navigation changes the monthly-savings input; projected milestones and assumption controls render. No persistent financial record was changed. |
| Advice | Recommendations and topic navigation render. No priority was saved and no external AI request was made. |
| Notifications | Preferences, recent notifications, and delivery history render. No preference or acknowledgement was changed. |
| Settings | Profile, security/session, integration, and data tools render. Mobile data settings exposed the receipt-picker overflow fixed here. No credential, session, token, consent, or setting was changed. |
| Mobile entry and receipts | The ledger and receipt inbox fit 375px. The transaction dialog supports debit/credit selection and Escape dismissal without submission; the receipt inbox has a clear empty state. |
| Year in Money | Current-year totals, categories, merchant links, and year navigation render. |

## Open risks and acceptance limits

- Split replacement in `app/api/transactions/annotate/route.ts` still deletes old splits and then inserts new ones in separate requests.
  An insert failure after deletion can lose the prior split set; goal-event and annotation writes also do not share one database transaction.
  Follow up with an atomic, owner-validated database operation and disposable-database rollback/concurrency tests.
  This branch fixes annotation field preservation, not transaction-wide atomicity.
- Previously recorded merge-review follow-ups remain: statement objects after bank unlink, reports-only household navigation, MCP scope selection in Settings, and undisclosed MCP projection truncation.
  See `docs/TODO.md`; these were not retested through destructive production operations.
- Production create/update/delete, import undo, bank reconnection, MFA enrollment/removal, token minting/revocation, uploads, backups, email delivery, and private sharing were not exercised.
  Their end-to-end persistence and authorization acceptance still require an approved disposable `TEST_SUPABASE_URL` environment.
- Empty or provider-unavailable live states do not establish populated-state correctness.
  Synthetic coverage is reported separately from live browser evidence.
- The full application cannot honestly be certified bug-free by this review.
  This document records the tested surface and residual risk instead of claiming every flow passed.

## Verification and release

Baseline main: 6,210 unit tests and lint passed.
The final synthetic browser suite passed 54 tests covering mobile/desktop, light/dark in existing suites, receipt recovery, and date/filter bounds at 375px, 640px, 768px, and 1440px.
The new ledger and manual-holding browser regressions passed at their tested sizes with zero configured WCAG A/AA violations.
Production build using placeholder public environment values passed; it does not establish production service configuration.
Typecheck and palette validation passed.
Palette validation retains the repository's documented color-distance/contrast exceptions.
The graph was refreshed; SQL extraction remains unavailable because the optional SQL parser is not installed.

Read-only remote migration inventory matches all 112 migration versions on the reviewed main.
No migration was applied and no release flag was changed.
Dependency freshness checked with `npx npm-check-updates`: updated nodemailer to 10.0.14 and lucide-react to 1.51.0.
ESLint 10 and TypeScript 7 are deferred major toolchain upgrades, not verified compatible in this functionality patch.
Full coverage passed 6,233 tests with 99.31% lines and 94.96% branches, above the unchanged repository gates; 22 integration files and three tests were skipped without disposable service configuration.
The future-clock run passed 6,228 unit tests with the clock set to January 15, 2030.
Final lint, typecheck, production build, and dependency audit passed; the audit reported zero vulnerabilities.
Hosted results are tracked on the new PR and reported separately from these local checks.
This branch is not a production deployment or authorization to merge.

## Post-merge production verification

On October 3, 2026, signed-in Google Chrome verification resumed after the owner dismissed the extension panel that had blocked automation.
The production alias was verified against READY deployment `dpl_G9EkbmNL3ahaiDFBLrU2tQgesdoz`, serving main `27d951a0371687436013b68871ccdf7bc414941b` after PRs #221 and #220 merged.
The deployed tree equals tested review head `16af6b78e9011d508ab8943e89173068bfff14c8`.
This is deployment evidence, separate from the browser observations below.

- All primary navigation pages loaded: Dashboard, Accounts, Transactions, Cash Flow, Reports, Budget, Recurring, Goals, Investments, Debt Payoff, Forecasting, Advice, Notifications, Settings, and Year in Money.
  Dashboard Monitor, monthly review, report Trends, and the receipt inbox also rendered.
- Transaction amount bounds rejected a reversed range.
  Equal bounds returned one matching pending row and four matching posted rows; every visible result had the requested amount and status.
  Clearing filters removed their query state.
  Native keyboard month selection produced the month query and chip.
  Programmatic month filling did not commit the React draft in this Chrome automation session, so it was not treated as an application defect.
- Opening an annotation editor, toggling its cleared checkbox locally, canceling, and reopening restored the saved checked state.
  No Save or classification action was submitted.
- Recurring View history used the `q` search parameter and returned only matching merchant rows.
  The recurring calendar rendered its grid and occurrences.
  Disabled-calendar fallback was not exercised in production because the calendar is enabled there.
- Filter and Date panels stayed within the 375px viewport.
  Settings Data measured document widths equal to viewport widths at 375px and 768px.
  The receipt scan input was disabled with the expected instruction to enable AI insights; consent was not changed.
- The dashboard and investments showed an existing Fidelity connection/sync warning and unavailable individual holdings.
  The app labels the balance fallback explicitly; provider freshness and reconnect behavior remain unverified.
- Browser logs contained extension-style message-channel errors and Grammarly warnings.
  No application exception was identified from these entries.
  Deployment-scoped runtime queries covering the verification window returned 118 HTTP 200 log entries and no 5xx or error/fatal entries; log coverage is not a proof that every route is healthy.

The visual check also found a real regression: the inactive Sort button remained at the popover z-index and painted above the open Filters panel.
Earlier isolated filter fixtures did not mount the neighboring toolbar, so all 54 synthetic tests passed without detecting it.
The follow-up mounts the real toolbar and sort component beside query controls and uses hit testing to assert that inactive sorting cannot intercept a popover or its backdrop.
Both 375px and 1440px regressions failed before the fix and passed when the Sort trigger was raised only while its own menu is open.
The follow-up is not deployed until its separate PR is approved and merged.

Production acceptance was read-only, apart from temporary unsaved form drafts and URL filters.
Saved annotations, imports, uploads, provider reconnects, security/token changes, backups, and database rollback/concurrency remain outside this live run.
Synthetic component fixtures with controlled responses do not establish real database persistence or service delivery.
