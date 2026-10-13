# Transaction and reporting essentials implementation plan

**Goal:** Ship the 15 additions specified in `../specs/2026-10-13-transaction-reporting-essentials.md`.

**Architecture:** Extend existing query, projection, and report components. Ledger, report controls, and report analytics can be implemented independently; integrate them at the Reports page and validate as one branch.

**Stack:** Next.js 16, React 19, TypeScript, Tailwind, Supabase, Vitest, Playwright.

## Global constraints

- Follow AGENTS.md and CLAUDE.md; no new AI behavior, production mutations, or schema changes.
- Reuse owner-scoped cookie reads and canonical financial projections.
- Positive amounts mean money out; refunds net expenses; currencies stay separate.
- Date strings are calendar keys; viewer-relative today comes from resolveViewerToday.
- Preserve saved filters and disclose every bounded/incomplete result.

## Review focus

- Metadata matches beyond page one must appear with correct counts and stable ordering.
- Failures and truncated reads must never appear as complete negative matches or comparisons.
- Leap-day and end-of-month ranges must remain valid and future days cannot become no-spend days.
- Existing saved reports and views must keep their meaning after round trips.
- Filters, currency, sorting, and pending state must survive links, GET forms, and print rendering.

## Task 1: Ledger filters (features 1–7)

Files: `lib/ledger-query.ts`, new focused metadata-filter helpers, `app/transactions/_lib/ledger-page-data.ts`, `app/transactions/page.tsx`, `components/transactions/TransactionQueryControls.tsx`, focused unit/browser tests.

- [x] Add failing query, metadata, pagination, owner-scope, failure, and rendered-control tests.
- [x] Implement validated filter parsing and saved-view serialization.
- [x] Attach owner-scoped annotation/receipt/split metadata before filtering the bounded projected scope.
- [x] Add accessible filter and date controls, chips, clear behavior, and page/calendar wiring.
- [x] Run focused tests, lint, and typecheck.

## Task 2: Report controls (features 8–10 and 13)

Files: `lib/reports.ts`, new `lib/report-explorer.ts`, `components/reports/ReportControls.tsx`, new focused controls component as needed, unit/browser tests.

- [x] Add failing range, preset, comparison-window, round-trip, and form-preservation tests.
- [x] Implement pure date helpers and validated optional comparison/interval/currency settings, preserving old saved reports.
- [x] Add presets, range navigation, interval and comparison choices, and named filter selectors with supplied facets.
- [x] Run focused tests, lint, and typecheck; document interfaces for page integration.

## Task 3: Report analytics (features 11, 12, 14)

Files: new `lib/report-analysis.ts`, `components/reports/ReportComparison.tsx`, `components/reports/ReportSpendingHabits.tsx`, focused tests.

- [x] Add failing tests for signed totals, refunds/transfers, zero baseline, category identity, calendar-day denominators, and future periods.
- [x] Implement pure analytics over single-currency canonical rows with explicit input ranges.
- [x] Render comparison cards, category-variance table, and spending-habits table with labels and privacy markers.
- [x] Run focused tests, lint, and typecheck; document exported interfaces.

## Task 4: Integration and print (feature 15)

Files: `lib/reports-data.ts`, `app/reports/page.tsx`, print component/styles, page unit and synthetic browser tests.

- [x] Add failing tests for same-scope comparison loads, currency/truncation handling, facets, and print behavior.
- [x] Wire report controls and analytics to shared canonical loads and selected currency.
- [x] Add scoped print styles and print action preserving visible privacy state and warnings.
- [x] Run final full tests/coverage, lint, typecheck, build, browser checks and review the diff.
- [x] Update canonical docs and prepare the topic branch for publication with the feature checklist and verification limits.

Publication and hosted-check status are tracked by the associated pull request.
