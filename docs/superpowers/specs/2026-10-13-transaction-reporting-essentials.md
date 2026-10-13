# Transaction and reporting essentials

## Intent

Deliver 15 useful, non-AI additions to the existing personal-finance application in one reviewable PR. Extend the existing ledger and Reports workflows rather than introduce duplicate financial subsystems. No model calls, new services, production data changes, deployments, or database migrations are required.

## Feature acceptance

1. **Custom ledger dates:** inclusive start/end dates, calendar-valid, with an explicit invalid-range error and clear/reset behavior.
2. **Tag filtering:** exact tag selection plus tagged/untagged states, including effective rule tags.
3. **Note search:** case-insensitive literal search of saved notes.
4. **Cleared filter:** cleared and uncleared transactions, with absent annotations treated as uncleared.
5. **Source filter:** bank-synced, imported, or manually entered transactions.
6. **Receipt filter:** attached or missing receipts, using existing receipt records.
7. **Split filter:** split or unsplit transactions, using existing split records.
8. **Report presets:** viewer-relative common calendar and rolling date ranges.
9. **Adjacent report periods:** previous/next navigation preserving the remaining filters.
10. **Report selectors:** account, category, and merchant selection using owner-visible projected data; clear individual or all selections.
11. **Period comparison:** optional prior-period or prior-year income, spending, and net comparisons with visible reference dates and undefined zero-baseline percentages.
12. **Category variance:** signed spending changes by stable category key, including categories appearing in only one period and net refunds.
13. **Trend interval:** daily, weekly, or monthly buckets, URL-addressable and saved with reports.
14. **Spending habits:** weekday spending, calendar-day average, and no-spend days through the viewer's current date; no future days counted as no-spend days.
15. **Print-friendly report:** print/save-to-PDF action and scoped print layout with date, currency, filter context, visible warnings, and explicit paginated transaction-table scope.

## Design and invariants

Ledger metadata filters operate before sorting, totals, pagination, and calendar grouping. Reuse the bounded full-projection path only when necessary; read metadata in owner-scoped batches and fail closed on incomplete input. Preserve saved-view and URL round trips. Keep calendar/month/day precedence explicit. Gate controls that require an existing optional subsystem with its existing flag.

Reports consume `loadCanonicalProjection` through `loadReportData`, preserving scope and pending filters. Partition every computed report by currency; never sum currencies or guess FX. Positive amounts mean money out. Canonical flow excludes transfers, and refunds reduce expenses. Reference ranges get the same filters; comparisons are unavailable if either input is truncated or missing that currency. New optional report settings preserve legacy saved-report compatibility and are validated on read.

Use existing Tailwind tokens, labeled native controls, tables for exact values, keyboard focus, and mobile layouts. No financial data in localStorage or telemetry. No auth or RLS changes, privileged reads, new provider calls, or live database operations.

## Validation

Unit tests cover boundary dates/leap years, malformed and inverted filters, effective tags, metadata failures, multi-page filtering, stable sort, refunds/transfers, empty and zero baselines, missing currencies, truncation, future days, and saved-report compatibility. Synthetic browser tests exercise actual controls at mobile and desktop widths, back/clear navigation, print behavior, and accessibility. Run lint, typecheck, production build with placeholder public configuration, full unit suite, coverage gates, and hosted PR checks. Live database acceptance requires a disposable environment and is not implied by synthetic checks.
