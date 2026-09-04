# Transaction sorting and filter controls

Date: 2026-08-08
Status: approved

## Problem

The Transactions page exposes an always-open search, month, and account form while several existing ledger filters are reachable only through drill-down links.
The ledger is always ordered by newest date, so users cannot organize the full filtered result by amount, merchant, category, or account.
Sorting only the 50 visible rows would produce incorrect ordering across pagination boundaries.
Sorting raw merchant and category fields would also disagree with the cleaned values displayed after merchant rules run.

The approved scope is one transaction-focused pull request.
Dashboard widget upgrades and the recurring calendar are excluded from this work.

## Goals

- Let users stage filter changes and apply them explicitly.
- Expose every existing transaction filter through accessible controls.
- Sort the complete filtered result by date, amount, merchant, category, or account in either direction.
- Use the merchant, category, account, and signed amount values that users actually see.
- Preserve filters and sorting in the URL, pagination links, and saved views.
- Navigate through the Next.js router without a hard browser reload.
- Keep the same controls and behavior on desktop and mobile.

## Non-goals

- Dashboard budget or investment widget changes are not included.
- A recurring calendar is not included.
- New transaction schema, database migrations, or persisted derived sort columns are not included.
- Client-side sorting of only the visible page is not acceptable.
- Exchange-rate conversion is not included because this ledger is USD-only.
- Column visibility remains separate from saved views.

## Decisions

### One shared sorting control

Desktop and mobile use one Sort popover rather than duplicating sorting through clickable desktop table headers.
The popover contains a field selector, a direction selector, and an explicit Apply action.
The active trigger summarizes the committed state with text such as `Amount: high to low` or `Merchant: A to Z`.

### Explicit filter application

Search remains visible and applies on Enter or through its Search button.
Date opens a popover containing the existing month selector and an Apply action.
Filters opens a popover containing account, category, subcategory, merchant, money direction, and account type.
Changes inside Date, Filters, and Sort remain local until Apply is pressed.
Escape or an outside click closes a popover without changing the committed URL state.

### Hybrid server sorting

Date and amount use database ordering because their displayed values derive directly from stored transaction fields.
Merchant, category, and account use an application-side display projection because merchant rules and account labels determine the values users see.
This choice avoids a migration and does not duplicate merchant-rule semantics in SQL.

## URL contract

Create one parser and serializer for the complete ledger query state.

```ts
type LedgerSortField = "date" | "amount" | "merchant" | "category" | "account";
type LedgerSortDirection = "asc" | "desc";

interface LedgerQueryState {
  q: string;
  month: string;
  accountId: string;
  category: string;
  sub: string;
  merchant: string;
  flow: "" | "in" | "out";
  accountType: "" | "depository" | "credit";
  sort: LedgerSortField;
  direction: LedgerSortDirection;
  page: number;
  columns: Set<LedgerColumn>;
  columnsSubmitted: boolean;
}
```

The query parameters are `sort` and `direction`.
Missing or invalid sorting parameters fall back to `sort=date` and `direction=desc`.
Existing validation for month, account IDs, category keys, search text, flow, and account type remains authoritative and moves behind the shared parser.
Serialization preserves repeated `col` parameters and every unrelated committed control.

Applying search, date, filters, or sorting resets `page` to `1`.
Changing pages preserves filters, sorting, and visible columns.
Clear filters removes `q`, `month`, `accountId`, `category`, `sub`, `merchant`, `flow`, and `accountType` while preserving sorting and visible columns.
Removing one applied-filter chip preserves every other committed parameter and resets pagination.

Saved views continue to store filter parameters and additionally store non-default `sort` and `direction` values.
Opening a saved view restores the exact filter and sorting state while leaving column visibility at its normal default behavior.

## Sorting semantics

Every comparator is stable and receives an explicit final tie-breaker of date descending and transaction ID ascending.
The final tie-breaker prevents rows from moving between pages when primary values are equal.

| Field | Compared value |
| --- | --- |
| Date | Stored transaction date |
| Amount | Displayed signed amount, calculated as the negative of the Plaid amount |
| Merchant | Cleaned displayed merchant after merchant rules, compared case-insensitively |
| Category | Cleaned displayed primary category after merchant rules, compared case-insensitively |
| Account | Displayed account label, compared case-insensitively |

Missing merchant, category, or account labels sort after populated values in both directions.
Amount ascending moves from the most negative displayed spending value toward the largest positive income value.
Amount descending reverses that order.
No currency grouping or conversion is required because the user confirmed that transactions are always USD.

## Server data flow

`app/transactions/page.tsx` remains the server-rendered orchestration boundary.
The page parses one `LedgerQueryState`, loads user-owned accounts and merchant rules, and selects one of two execution paths.

### Direct database path

Date and amount sorting apply validated filters, database ordering, deterministic secondary ordering, and the existing 50-row range directly in Supabase.
Amount ordering reverses the stored Plaid sign so its ascending and descending labels match the signed value displayed in the ledger.

### Display-projection path

Merchant, category, and account sorting fetch only the lightweight transaction fields required for filtering, rule application, labels, and comparison.
The server fetches the matching user-owned scope in bounded chunks until the complete result is available.
It applies the existing canonical merchant-rule function, resolves account labels, sorts the complete projected result, and selects the IDs for the requested 50-row page.
It then loads or reuses the visible transaction rows in sorted ID order.
Annotations and splits remain limited to the final visible IDs.

Filters whose meaning depends on merchant rules continue to run against cleaned values.
The new projection helper replaces the existing silent 4,000-row rule-aware cap with complete chunked retrieval.
The implementation must not return partially filtered or partially sorted results if any chunk fails.

The projection and comparator logic live in focused pure helpers outside the page component.
The page retains orchestration responsibilities and does not gain a second implementation of merchant rules, filter validation, or account-label formatting.

## Filter option data

Account and account-type choices come from the existing owner-scoped Plaid and manual account reads.
Category and subcategory choices come from user-owned transaction metadata after applying current merchant rules where those rules affect the displayed primary category.
Subcategory choices narrow to the staged category selection.
Merchant uses a searchable combobox over cleaned merchant names so a long merchant list does not become an unwieldy select.
Money direction retains the existing Money in and Money out definitions based on Plaid sign conventions.

Options remain display aids rather than a new source of query truth.
Every committed value still passes through the server parser and validation before it reaches Supabase.

## Components and interaction

Add a focused client control component above the ledger results for search, date, and filter actions.
The component receives normalized committed values and server-loaded option data rather than fetching financial data from the browser.
It owns staged form values only while a control is open.

Add one Sort popover to the existing transaction toolbar beside Edit multiple and Columns.
The Sort popover receives the committed sort field and direction and uses the same staged-then-apply behavior as Filters.
Edit multiple and Columns retain their existing behavior and server-client composition.

Apply actions construct a URL from the committed query state, overlay the staged changes, remove `page`, and call the Next.js router.
The route transition keeps current results visible and marks the initiating control busy until the new server result arrives.
Repeated Apply actions are disabled during the active transition.

Applied filter chips cover search, date, account, category, subcategory, merchant, money direction, and account type.
Each chip has a descriptive accessible removal label.
The controls expose a Clear filters action whenever at least one filter is committed.

All triggers and actions retain the app's 44-pixel minimum target size.
Popover focus moves to the first control when opened, Escape returns focus to the trigger, and keyboard users can reach every selector and Apply action.
The same components render at phone and desktop widths.

## Loading, empty, and error states

Navigation retains the current rows while the next server result loads and shows a subtle pending state on the initiating control.
The page does not clear the ledger or rebuild the shell from scratch during client navigation.

An invalid URL value falls back to a safe normalized value and does not reach the database query builder.
A failure in any direct query or display-projection chunk produces an actionable ledger error state and sanitized server logging.
The page never presents a failed query as an empty successful result.
Controls remain available after an error so the user can change or clear the query.

The empty state distinguishes an account with no transactions from a query where no transactions match the committed filters.

## Security and privacy

Every transaction, account, manual-account, annotation, split, and option query remains explicitly scoped to the authenticated owner in addition to RLS.
Household-readable rows do not enter the personal ledger or its option lists.
Search text and identifiers retain their existing sanitization and allow-list validation.
No financial data moves into browser-managed caches beyond the option labels and visible rows already rendered for the page.
Privacy-blur hooks on displayed amounts remain unchanged.

## Testing

### Unit tests

- Parse all valid query values and reject malformed values.
- Serialize repeated column parameters without losing filters or sorting.
- Preserve unrelated query state when applying, clearing, removing a chip, or changing pages.
- Default missing and invalid sorting to Date, newest first.
- Compare every sort field in both directions.
- Sort Amount by the signed displayed value rather than the stored Plaid sign.
- Sort merchant and category by cleaned values after merchant rules.
- Sort account by the displayed account label.
- Place missing display values after populated values in both directions.
- Apply deterministic date and ID tie-breakers.
- Sort the complete filtered result correctly across a 50-row page boundary.
- Build category, subcategory, merchant, account, direction, and account-type options from owner-scoped data.
- Preserve sort and direction through saved-view serialization and restoration.

### Component tests

- Stage Date, Filters, and Sort values without changing the committed URL.
- Apply staged values and reset pagination.
- Close with Escape or outside click without applying staged values.
- Retain current results and show pending state during navigation.
- Remove individual chips and clear all filters while preserving sort and columns.
- Render readable active-sort labels.
- Meet keyboard focus and accessible-name expectations.

### Browser acceptance

- Apply multiple filters together and confirm the URL changes only after Apply.
- Sort by every field and direction and confirm ordering across at least two pages.
- Confirm merchant and category ordering follows visible merchant-rule-adjusted labels.
- Save a filtered and sorted view, reopen it, and confirm exact restoration.
- Confirm browser Back and Forward restore committed controls and results.
- Exercise the same Sort and Filters controls at desktop and phone widths.
- Verify light and dark presentation, focus states, popover placement, and 44-pixel targets.
- Confirm navigation does not perform a hard browser reload.

## Verification gate

The implementation is complete only after focused tests, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`, `git diff --check`, the targeted transaction E2E specification, and manual browser acceptance pass.
Any credential-dependent or environment-blocked E2E step must be reported separately rather than represented as completed.

## Delivery structure

The feature ships as one pull request with reviewable commits for query semantics, controls, and verification.
No dashboard or recurring files are part of this pull request.
