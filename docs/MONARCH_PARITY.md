# Monarch workflow parity — active checklist

Status: **in progress, not accepted**. All remaining work belongs in the same
follow-up PR. Do not merge or deploy. Branch: `ui/monarch-workflow-parity`.

## Evidence and boundaries

Live signed-in browser inspection: November 17, 2026 (Pacific time).
Remote `main` was verified through the GitHub integration at
`1417272cbc7feaea1efb732ded58330e8106380e`; this is also the local branch base.
The first shared-style pass, PR #242, is merged. The old unmerged handoff is historical.

Observed means rendered live UI or an opened control, not an inference from source.
Both apps' primary pages were visited. This was a read-only comparison: no edits
were submitted to financial records, connections, consent, or account preferences.
Screenshots and private account values are not committed.

The desktop dashboard screenshot corroborates the existing dark-mode reference:
equal columns, 16px gaps, quiet header, per-card controls. Numeric computed-style
measurements in MONARCH_LOOK.md remain the November 16 capture; they were not all
remeasured. Monarch's light mode was not switched because that saves an account
setting. A viewport override applied to FundFlow, whose transaction page measured
375px with 375px document width. Monarch remained at 1920px, so this does **not**
establish Monarch mobile parity. The override was reset.

## Page and workflow checklist

| Area | Observed live difference | Implemented in working tree | Remaining in this same PR |
| --- | --- | --- | --- |
| Dashboard layout | Monarch has equal card stacks; FundFlow has chip rows, views/status strips and account activity before unequal columns | Equal columns and 16px gaps; secondary views/status/activity are native disclosures; native account/month selectors | Render and compare new layout at desktop/tablet/phone; refine toolbar placement and card ordering |
| Dashboard customization | Monarch modal lists reorder handles and widget switches | Existing FundFlow customization retained | Inspect FundFlow customization fully; synthetic order/hide/size save, reload, error and keyboard tests |
| Widget selectors | Monarch changes card content; FundFlow controls labeled as selections only navigate | Net-worth calendar range, recent-entry direction, and upcoming/overdue recurring views actually select content; other navigation is explicitly labeled as links | Add supported spending/budget selectors using real available data; decide URL/pref persistence consistently; verify no scope drift |
| Widget data | Monarch spending/recurring show larger data views | Budget planned/spent/remaining rows, recurring logo/row density, net-worth table twin | Today marker with correct viewer date and current-month gating; recurring windows and transaction detail links |
| Accounts | Both have grouped rows, history and balance sheet; FundFlow text is heavier | Account/group typography reduced and names/balances enlarged | Compare chart controls, filter/sort behavior, mobile rows, available utilization data, empty/stale states |
| Transactions layout | Monarch has 320px summary rail, compact toolbar and quiet date headers; FundFlow review cards dominate | Reviews behind disclosure, 320px rail, 16px desktop cells, sentence-case headings and raised date groups | Full canonical filtered financial summary with currency/truncation handling; summary toggle; match toolbar placement and table widths |
| Amount display | Monarch expenses are unsigned and neutral; money in has + | Desktop/mobile ledger and recent activity use this presentation; zero stays neutral | Verify screenshots, money masking and screen-reader clarity across these surfaces |
| Detail editing | Monarch has a right drawer and per-cell edit controls; live FundFlow opens a centered annotation modal | Existing annotation editor uses a 460px right drawer at desktop/full width on phones, scrim, focus trap, Escape and restoration; chevron trigger; unsaved annotation draft confirmation and pending-save dismissal lock | Inline merchant/category/date affordances where supported; previous/next navigation; execute synthetic save/cancel/reopen/error tests; authenticated reload persistence and classification-control draft protection |
| Filters/search/sort | Monarch filter panel has facet tabs; FundFlow has stacked selectors | Existing staged Apply logic retained; rectangular, lighter triggers | Test search, each sort, columns, filter cancellation, Back/Forward and reload; compare empty and error states |
| Budget | Monarch inline planned/actual/remaining groups and right rail; FundFlow adds exploration/scenario controls | Quieter table typography, 320px rail, exploration disclosure with visible category count, and retained existing save-on-blur API | Tune row/progress/remaining-chip anatomy, verify editable amounts and no-op blur |
| Recurring | Monarch Monthly/All recurring views, list/calendar and grouped rows; FundFlow uses occurrence tabs and price alerts | Row/control typography reduced; dashboard rows enlarged | Consolidate navigation while keeping review/history; list/calendar/overdue/empty layouts and disposable edit persistence |
| Cash Flow | Monarch Monthly/Quarterly/Yearly controls and category/group/merchant charts; FundFlow window/period selectors | Existing calculations and navigation retained | Align header/control placement and stat tiles; verify period/group controls and table twins |
| Reports | Monarch Cash flow/Spending/Income tabs with Date/Filters/Reports/Save; FundFlow has analysis controls and summary | Existing report functionality retained | Refine tabs, secondary analysis disclosure, summary layout, saved-report reload and print behavior |
| Goals | Monarch Save up/Pay down tabs and allocation rail; FundFlow shows cards and a scenario planner | Existing goal and debt paths retained; goal scenarios collapsed and Pay down links to debt strategies | Verify goal/debt navigation and compact scenario tools; allocation/editor save and errors |
| Investments | Monarch holdings/market/allocation; FundFlow reports provider holdings unavailable | Existing honest unavailable state retained; dashboard navigation explicitly says View holdings | Align supported tabs/controls and empty states; do not fabricate securities, licensed benchmarks or performance |
| Forecasting | Monarch shows a Try Forecasting onboarding screen; FundFlow shows its working projection form | Existing working projection retained | Inspect non-mutating onboarding continuation if possible; align scenario controls without inventing reference behavior |
| Advice | FundFlow has advice; no separate Monarch Advice destination observed | Preserved | Keep distinct and reachable; simplify typography; no inference that AI Assistant is equivalent |
| Notifications | Monarch utility opens a panel with Unread/Read; FundFlow uses a page with delivery settings and alerts | Preserved | Build read-only notification drawer/links with existing owner-scoped data; retain settings and explicit mark-read controls |
| Settings | Monarch has a settings subnav; FundFlow has section routing/mobile picker | Preserved | Compare all relevant sections, tune subnav and forms; test with synthetic preferences only |

## Cross-cutting acceptance

- [ ] Render edited app and compare with live reference. Production screenshots
  are baseline evidence, **not** evidence for working-tree changes.
- [ ] Light and dark desktop/tablet/phone screenshots, overflow and contrast.
  Current token validation passes both themes; light reference parity is unverified.
- [ ] Keyboard: native selectors, disclosures, menus, focus trap, Escape,
  focus restoration, no inaccessible controls after sidebar collapse.
- [ ] Empty/loading/error states for every changed data-dependent surface.
  Existing widget error/empty rendering is retained; loader failures were not
  intentionally induced in real accounts.
- [ ] Persistence: dashboard account/month remain URL-driven. New local card
  selections currently reset on remount; they are not claimed as saved preferences.
- [ ] Synthetic mutation checks and authenticated disposable-environment checks
  must be separately recorded. No real-record save testing.
- [ ] Finish all checklist gaps within one PR; remaining provider/brand/accessibility
  differences must be explicitly classified rather than silently called parity.

## Verification checkpoint

- Unit suite: 580 files / 6,474 tests passed before the final calendar-window
  regression addition; the final focused recheck passed 4 files / 45 tests.
- Typecheck passed. Lint has no errors; the existing unrelated graphify plugin
  file may emit an anonymous-default-export warning. Palette validation passed.
- Added synthetic browser tests for widget selection, calendar range, URL scope,
  and drawer keyboard/focus at 375px/1440px in both themes. **Not executed successfully.**
- Existing ledger browser suite could not launch: Playwright's expected Chromium
  executable is missing. A separate attempt with installed Chrome ended in
  SIGABRT/EPERM before tests ran. No application assertions passed in either run.
- Local `next dev --port 3001` failed with `listen EPERM` on `0.0.0.0:3001`.
- Production webpack build failed fetching Geist/Geist Mono: shell DNS cannot
  resolve `fonts.googleapis.com`. No passing production build is claimed.
- Required `npx npm-check-updates` failed resolving `registry.npmjs.org`.
  No dependency versions changed; freshness is unverified.
- Shell GitHub DNS failed; the GitHub integration successfully verified main.
- `graphify update .` completed; optional SQL parser remains unavailable.

Next prerequisite: run the development server outside this restricted execution
session and provide a reachable localhost URL. Browser inspection through the
existing browser connection works. Restore a usable test-browser/runtime path
before claiming interactive acceptance. Do not weaken authentication or copy
production credentials into fixtures.

### Continuation checkpoint

- Added annotation draft confirmation for close/backdrop/Escape and row-switch
  events; pending saves cannot be dismissed. Browser unload warns about active
  drafts. Independent classification controls retain their existing save flow.
- Added a synthetic browser case covering rejected dismissal, failed save,
  successful retry, reopening and discarding a subsequent edit. This does not
  establish backend persistence after reload; browser execution remains blocked.
- Recurring windows preserve distinct source occurrences even when merchant/date
  match. Available data covers seven days across a month boundary; no 30-day
  selector is offered without a complete source window.
- Focused continuation checks: six unit files / 74 tests passed; final recurring
  recheck passed all 11 tests, including the collision regression. Typecheck and
  targeted lint passed; graph update and diff whitespace checks passed. These are component
  and unit checks, not authenticated end-to-end verification.
- Retrying a loopback-only development server also failed with
  `listen EPERM 127.0.0.1:3001`; localhost:3001 still refuses connections.
  Browser inventory confirms the live apps remain available in Chrome, but there
  is no local app tab. No commit, push, or PR yet; acceptance remains incomplete.

### Authenticated local verification — query failure resolved

The user started localhost:3001 and completed Google sign-in. The first real
Dashboard load exposed oversized recurring `.in()` queries (500 UUIDs, roughly
19.6KB). Both stream-link and transaction lookups now use the shared 150-ID
PostgREST request-line budget. The regression fails before the change and passes
after it; all 36 tests in the three focused suites pass. Typecheck and targeted
lint pass. No authentication enforcement or financial data was changed.

The signed-in local Dashboard now renders and also loads after navigating away
and back. The Transactions page renders; its detail drawer measures 460px at the
right edge of a 1728px viewport and closes on Escape. Accounts renders at desktop
and 375px with document width 375px (no horizontal overflow). These are read-only
checks against the actual local working tree, not mutation/persistence tests.
Viewport override was reset. Earlier server/login blockers above are resolved;
remaining parity acceptance items still apply.

### Continued testing — 2026-11-17

- Manual synthetic browser verification: transaction direction selection changes
  content; drawer focus wraps between first/last controls; refusing the native
  discard prompt preserves the draft; a simulated failed save shows an error and
  preserves the note; retry succeeds, restores trigger focus, and reopening shows
  the saved client state. All fetches in the disposable fixture were intercepted.
  The fixture and its browser tab were removed afterward. This is **not** backend
  persistence or authenticated mutation verification.
- Authenticated read-only checks: dashboard month selection survives reload;
  transaction search produces a clear empty state, survives reload, and clears;
  merchant sort survives reload. Budget, Recurring (list and calendar), Cash Flow,
  Reports, Goals, Investments, Forecasting, Advice, and Settings render without
  a route error. Calendar view remains selected after reload. No real records,
  preferences, connections, or consent were changed.
- At 375px, Budget document width is 375px. Recurring calendar/table scroll
  containers are 301px wide and contain wider content; body width is 375px but
  root scroll width reports 544px. This discrepancy remains unresolved, so mobile
  calendar overflow acceptance is **not** claimed. Viewport reset afterward.
- Automated browser suite retried: all 16 cases failed at browser launch because
  the required Playwright Chromium executable is absent; no browser assertions ran.
- Typecheck passes. Lint passes with only the existing unrelated graphify plugin
  warning; diff whitespace check passes. Full unit rerun encountered audit network
  timeouts and was stopped. A rerun with the service credential disabled made no
  completion progress and was also stopped; neither is a passing full-suite result.
  The subsequent verbose run completed successfully (see below).
- Focused final regression run passes four files / 40 tests (recurring data,
  dashboard recurring parity, PostgREST limits, workflow parity), with the service
  credential disabled for the test process.

Remaining checklist items above still apply. No commit, push, PR, merge, or
deployment at this checkpoint.

Final full unit rerun: **580 files / 6,476 tests passed** (149.89s), using
`SUPABASE_SECRET_KEY='' npx vitest run tests/unit --reporter=verbose`. This
supersedes the interrupted attempts above. Palette validation passes light/dark
with the existing documented exceptions. Graph update completed (optional SQL
parser unavailable); generated graph outputs remain excluded from source changes.

### PR #243 check repairs

Initial remote CI passed production build, coverage, future-clock, lint,
typecheck and palette. Of 79 component browser cases, only the two budget
exploration cases failed: they expected controls inside a closed disclosure.
The test now opens the disclosure by keyboard before checking its contents.
Codacy callback/nullable-value findings and editor complexity were repaired.

The dependency audit blocks on GHSA-fc5q-39xc-vjpf, covering Picomatch through
4.0.7. npm latest and the official advisory were checked November 17: there is
no patched release; proposed upstream PR micromatch/picomatch#237 remains open.
Audit enforcement is unchanged. This upstream blocker is separate from parity.

Local focused workflow/widget checks passed 33 tests. Browser installation
succeeded under /tmp but process permission errors still prevented launch.
The local environment then disconnected; the same source repairs were prepared
from the verified PR head through GitHub. Follow-up CI owns final verification.
