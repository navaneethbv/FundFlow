# Persistent transaction review: implementation plan

Status: proposed implementation contract; no application code or migration has been written for this feature.
Prepared 2026-09-07 against `origin/main` at `74efddd6655a6e929c584425e33b27c1a3e31d82`, including merged PR #165.
The current checkout has the same tracked content as that baseline.
The user selected transaction review from the feature-gap review and requested a detailed implementation plan.

## 1. Outcome and release scope

A user can open Transactions, find entries that need attention, inspect or edit them using the existing editor, explicitly mark individual or selected entries as reviewed, and later return without losing that progress.
A material change to a transaction's stored bank facts makes it require review again.
Review status never changes balances, spending calculations, categories, tags, split amounts, cleared flags, transfer links, or duplicate exclusions.

Deliver the complete first version in one feature PR with the sequential commits described below.
Do not release a status badge without persistent state, correct whole-result filtering, and reversible actions.

Included:

- Persistent, owner-specific review state for Plaid, imported, manually entered, and promoted scheduled transactions.
- All / Needs review / Reviewed views inside the existing Transactions page.
- Individual Mark reviewed and Mark as needs review actions.
- Explicit row selection and atomic bulk actions for the current page.
- Review status and identical actions on desktop and mobile.
- URL state, existing filter/sort behavior, saved views, exact result counts, and pagination.
- Protection against stale actions, provider changes, partial batch writes, and cross-user access.
- Archive coverage, migration verification, isolated database tests, and browser acceptance.

Deferred from this release:

- A separate review inbox page, household assignment, approval roles, comments, or review collaboration.
- Automatic approval by merchant rules, categorization, AI, reconciliation, receipt matching, or import confirmation.
- Mark every matching transaction across unseen pages, scheduled review reminders, and bulk classification changes.
- A combined Save and review operation spanning the existing metadata editor and review state.
- A permanent event-history UI, custom keyboard shortcuts, or a new application-wide state library.
- Enabling backup restore or implementing the separate recovery redesign.

## 2. Product decisions

The user confirmed that all existing transactions must enter review.
The remaining behavior below defines the proposed first-release contract.

| Decision | Proposed first-release behavior | Rationale |
| --- | --- | --- |
| Existing history | Backfill every existing transaction as `needs_review`; pending and excluded duplicates retain the eligibility rules below. | The user explicitly chose all history for review; no historical entry is silently approved. |
| New arrivals | Every newly inserted transaction receives `needs_review`, irrespective of its transaction date or source. | Old-dated imports and first bank-history imports are newly received data too. |
| Pending transactions | Visible in All with Pending and Review after posting; excluded from the actionable queue and bulk selection. | The posted amount and merchant may change. |
| Manual entries | Require explicit review like other new entries. | Creating an entry and checking its final ledger representation are distinct actions. |
| Reconciliation adjustments | Require review like other newly created manual entries. | Reconciliation is not general transaction approval. |
| Default Transactions view | Keep All as the default; Needs review is an explicit URL-backed view. | Preserve existing navigation, bookmarks, and saved views. |
| Review order | Retain existing date-descending order and every current sort option. | Avoid introducing a second ledger ordering model. |
| Edits by the user | Editing notes, tags, splits, overrides, or rules does not automatically approve or reopen entries. | Review records an explicit acknowledgement, not an immutable certification of every presentation rule. |
| Changes to stored transaction facts | Reopen the entry and invalidate stale review requests when the specified material fields change. | A previously checked bank amount or date must not remain silently approved after replacement. |
| Bulk scope | Only explicitly selected, eligible entries on the current 50-row page; API accepts at most 100 unique targets. | The user can see the scope before approving it. |
| Reversibility | Mark as needs review is always available for eligible reviewed entries, including immediately after success. | A clear reverse action is sufficient without an operation-history subsystem. |

The history decision is resolved: use only `needs_review` and `reviewed`, with all existing rows initialized to `needs_review`.
Do not introduce a historical bypass state or bulk-mark old entries reviewed.

## 3. Verified foundations and integration hazards

| Current location | Verified behavior | Required integration |
| --- | --- | --- |
| `app/transactions/page.tsx:61`, `:117`, `:179`, `:258` | The ledger uses 50-row pages, explicit owner filters, direct database pagination, and a separate full projection path for display-based filtering/sorting. | Apply review eligibility and status in both query paths before counting, sorting, and pagination. |
| `app/transactions/page.tsx:416` | Notes, tags, splits, and duplicate exclusions are loaded for visible IDs after choosing the page. | Review cannot be implemented only in this post-pagination detail loader. |
| `lib/ledger-query.ts` | One parser and serializer own URL state and saved-view parameters. | Extend the existing contract rather than inventing client-only filters. |
| `lib/ledger-data.ts`, `lib/ledger-projection.ts` | Sorting uses complete projected results where needed and suppresses misleading partial-day totals. | Preserve those guarantees when the queue shrinks. |
| `components/transactions/TransactionQueryControls.tsx` | Filter changes are staged, then applied through client navigation. | Keep review filtering explicit and preserve other committed controls. |
| `components/transactions/SavedViewsBar.tsx` | Saved views write generic parameter objects to `saved_views` through the browser client. | No new saved-view endpoint or schema is needed. |
| `components/transactions/BulkTagBar.tsx` | Bulk tagging currently applies to every shown ID, not a selected subset. | Keep that existing label and behavior separate from the new selection-based review action. |
| `app/api/transactions/annotate/route.ts:70` | Saving empty metadata can delete an annotation row. | Store review state in its own table so clearing notes cannot erase review progress. |
| `supabase/migrations/20260708040000_roadmap_completion.sql:40` | `transaction_review_decisions` represents specialized candidate decisions keyed by kind and subject, not a general transaction checklist. | Do not overload this table or infer general review from its decisions. |
| `lib/sync.ts:43`, `:214` | Sync upserts stored transaction facts and deletes explicit provider removals; `updated_at` can change on every upsert. | Compare material fields, not generic timestamps; handle inserts, updates, and deletes at the database boundary. |
| `lib/user-data.ts` | A shared table registry feeds takeout and encrypted backups. | Add review metadata deliberately with a stable ordering key. |
| `lib/feature-flags.ts` | Feature flags gate reachability; auth and access controls remain independent. | Add a rollout flag without putting security behind it. |

Additional boundary: `/review` is the monthly review page, and the ledger already mounts RefundReview, TransferReview, and DuplicateReview.
This feature stays inside `/transactions`; it must not replace those workflows or conflate their meanings.

## 4. User experience

### 4.1 Entry and views

Place the review view control near the existing ledger filters, before the table toolbar.
Use link-like segmented controls labelled All, Needs review, and Reviewed, with `aria-current` on the active view.
Use `/transactions?review=needs_review` for a direct queue entry.
Selecting a view commits immediately because it is an explicit navigation action, preserves the other filters and sort, and resets `page` to 1.
Existing editable filter fields retain their Apply behavior.

Show a small owner-wide summary, such as “18 transactions need review across all dates and accounts.”
Label it explicitly as a global queue count; the existing result count below filters describes the currently filtered results.
Do not display owner-wide counts as if they were the selected account/month count.
Only expose this summary on Transactions in the first release; a shell-wide badge can follow without making every application page load review data.

Empty states:

- Needs review, no remaining global work: “You're all caught up.”
- Needs review, active filters hide remaining work: “No transactions need review with these filters,” with Clear filters.
- Reviewed, no matching rows: “No reviewed transactions match these filters.”
- Data or count query failed: show an error and retry action; never convert the failure into zero outstanding work.
- Feature disabled: retain the current ledger, ignore review-specific URL filtering, and issue no queries against the new schema.

### 4.2 Row behavior

Add a compact textual status near the merchant/category information instead of relying on a color or an unlabeled check icon.
Retain the existing financial columns and monetary formatting.
Use Needs review and Reviewed for posted, non-excluded entries.
Pending and excluded duplicates keep their existing labels and cannot be reviewed until eligible.
An excluded duplicate can retain a prior review record internally; exclusion controls eligibility without rewriting that record.

Each eligible row offers Mark reviewed or Mark as needs review as appropriate.
The existing transaction editor remains the place to change categories, notes, tags, and splits.
Saving that editor alone never marks the entry reviewed.
After edits, the user explicitly chooses the review action; do not implement this as a chain of two partially successful API calls labelled Save and review.

For single-row success in Needs review, remove the row after server confirmation, announce the result, and place keyboard focus on the next actionable row or the queue heading if empty.
Use a native `<output>` for status feedback.
A success affordance labelled Review again invokes the reverse action using the returned version.

### 4.3 Selection and bulk actions

Add labelled selection checkboxes for eligible rows and a Select shown checkbox with an indeterminate state.
The accessible label identifies the transaction using merchant, date, and account, without depending on amount visibility.
Place the bulk action strip beside the existing toolbar, showing the selected count and the exact action, for example “Mark 12 selected as reviewed.”
Do not use “Mark all reviewed” for a page-limited operation.
Existing bulk tagging continues to say “Tag all N shown” unless it is separately migrated to selected IDs.

Selection is scoped to the current page and committed query.
Clear it on navigation, filter/sort changes, successful mutation, or a changed server row/version set.
Do not silently carry selection into a hidden page or across a background refresh that changes the facts the user selected.
Use the existing periodic refresh behavior, and reset stale selections rather than changing the global refresh interval.

Render desktop and mobile controls from one selection model so changing viewport width does not select a different set.
Give the two rendered copies distinct IDs using the existing desktop/mobile prefix convention.
On narrow screens, the action strip wraps and remains within the card width; no horizontal page overflow or hidden primary action.

### 4.4 Request feedback

Use a pessimistic write flow: disable the affected controls during submission and update the queue only after the server confirms success.
On a validation or server failure, preserve visible rows and selection so the user can correct or retry.
On a stale-state response, clear stale selection, refresh the affected page, and explain: “These transactions changed. Review the updated entries before trying again.”
On a network failure with an unknown commit outcome, refresh authoritative status before enabling another submission; do not blindly reverse or replay the action.
No success toast should imply that unseen entries, the full filter result, or a partially failed batch was reviewed.

## 5. State model and lifecycle

Persist one row per transaction in `public.transaction_review_states`.
Persisted state is `needs_review | reviewed`.
Pending and excluded are eligibility conditions derived from the transaction and existing duplicate link, not additional persisted review states.

| Starting condition and trigger | Stored outcome | Queue behavior |
| --- | --- | --- |
| Existing transaction at backfill | `needs_review` | Every posted, non-excluded entry enters the queue. |
| New posted transaction from any source | `needs_review` | Enters queue. |
| New pending transaction | `needs_review` | Not actionable until posted. |
| Pending becomes posted on the same ID | `needs_review`, version advances | Enters queue with final facts. |
| Provider replaces a pending ID with a posted ID | Old review row cascades away; new ID receives `needs_review` | No merchant/date heuristic transfers approval to the new ID. |
| User marks an eligible entry reviewed | `reviewed`, server review timestamp, version advances | Leaves Needs review; appears in Reviewed. |
| User requests review again | `needs_review`, review timestamp cleared, version advances | Enters queue. |
| Same requested state with the current version | No-op; preserve timestamp and version | No duplicated update or success count. |
| Material stored facts change | `needs_review`, timestamp cleared, version advances | Reopens even if previously reviewed or predating the feature. |
| Sync repeats identical material facts | Preserve status, timestamp, and version | No phantom review work. |
| User edits notes, tags, splits, override, or merchant rules | Preserve review state | Existing editing semantics remain independent. |
| Duplicate is excluded | Preserve stored state; eligibility becomes false | Leaves queue. |
| Duplicate exclusion is undone | Preserve stored state; eligibility becomes true | Returns if its stored state needs review. |
| Provider removal, manual transaction deletion, or account deletion | Cascade review row deletion | No orphan badge or count. |

Material facts are a null-safe tuple of `amount`, `date`, `account_id`, `manual_account_id`, `iso_currency_code`, `merchant_name`, `name`, `pfc_primary`, `pfc_detailed`, `pending`, and `source`.
Use `IS DISTINCT FROM` semantics so null transitions are handled consistently.
Do not compare `updated_at`, authorized date, payment channel, access-token metadata, or account balance snapshots.
Treat changing transaction ownership as invalid rather than moving a user's review state to another user.
Automatic reopening must happen in the same transaction as the fact change; never add a second best-effort HTTP call after sync.

## 6. Database design

### 6.1 Additive migration

Create a new migration timestamp later than the current latest migration at implementation time, named with the suffix `_transaction_review_state.sql`.
Do not edit any migration already deployed by PR #165.

Proposed table:

| Column | Type / rule | Purpose |
| --- | --- | --- |
| `transaction_id` | UUID primary key | Exactly one current review state per transaction. |
| `user_id` | UUID, not null, FK to `auth.users` with delete cascade | Explicit ownership and user deletion. |
| `status` | Text, not null, constrained to the two persisted states | Explicit pending review versus completed review. |
| `version` | Bigint, not null, positive, initially 1 | Compare-and-set token for every material change and review mutation. |
| `reviewed_at` | Timestamptz, nullable | Server time of current review; non-null if and only if status is reviewed. |
| `created_at` | Timestamptz, not null, server default | State creation. |
| `updated_at` | Timestamptz, not null, server-managed | State maintenance, distinct from transaction sync time. |

Add a unique constraint on `transactions(user_id, id)` and a composite FK from the review table to those columns with delete cascade.
This prevents mismatched owner/transaction pairs independently of route validation.
Keep the existing provider-ID conflict target unchanged.
Add an index on review state `(user_id, status, transaction_id)` and use the existing transaction owner/date index.
Measure actual plans before adding further indexes.

Enable RLS and add an authenticated SELECT policy requiring `user_id = auth.uid()`, `private.session_not_revoked()`, and `private.mfa_satisfied()`.
Explicitly revoke all privileges from `anon` and direct INSERT/UPDATE/DELETE from `authenticated`.
Do not rely on project-level default grants, which differed between the linked database and a clean local stack in PR #165.
Grant only the required read access and service-role write access.

### 6.2 Initialization and source updates

Use a database trigger on transaction insertion to create `needs_review` state for every new row, including inserts made by cron, import, manual-entry RPCs, demo fixtures, and reconciliation adjustments.
Use a private trigger function with a fixed empty search path, fully qualified relations, and no callable grant for browser roles.
An upsert conflict must preserve existing state; an actual material UPDATE follows the reopening rule instead.

Within the migration transaction, prevent concurrent transaction writes while installing the trigger and backfilling existing IDs so that no row falls between initialization and trigger activation.
Use a consistent table-lock order and bounded lock timeout; if the lock cannot be obtained, abort and retry the deployment later rather than partially initializing.
Backfill via set-based insertion, not an application loop, and assert that every transaction has exactly one matching owner/state row before committing.
Seed existing pending entries as `needs_review`; they become actionable when posted.
The schema deployment is the new-arrival cutover; transactions inserted after it count as new even if their date is older.

The update trigger increments version and reopens state only when the material tuple changes.
It preserves state for no-op provider upserts and timestamp-only updates.
A material source update that fails to update review state must roll back; the sync cursor must not advance past a failed write.

### 6.3 Read view

Create `public.transaction_review_ledger` as a read-only view using `security_invoker = true`.
Expose an explicit list of existing ledger transaction columns plus `review_status`, `review_version`, `reviewed_at`, `review_eligible`, and `review_state_missing`.
Join state on both transaction ID and owner, and derive duplicate exclusion with owner-scoped `EXISTS` against `linked_duplicates` so one transaction cannot expand into multiple view rows.
Keep transaction ownership as an explicit predicate in the application query even though RLS also applies.

Use a LEFT JOIN so a missing state cannot silently remove a transaction from All.
Treat missing state as unavailable review data: show the transaction, disable review actions, and surface an operational error instead of assuming it was reviewed.
If an integrity check finds a missing state in the user's scope, do not present an all-caught-up summary.

Grant authenticated SELECT on the view and its required underlying columns; grant no write privilege on the view.
Include the exact transaction columns used by filters, sorting, and projection, including manual-account and source fields.
The security-invoker requirement is deliberate: PostgreSQL otherwise evaluates underlying permissions using the view owner by default; see [PostgreSQL 17 CREATE VIEW](https://www.postgresql.org/docs/17/sql-createview.html).

### 6.4 Atomic mutation RPC

Add `public.set_transaction_review_state_atomic(p_user_id uuid, p_status text, p_items jsonb)` returning JSON.
Allow only the service role to execute it; the HTTP route supplies the authenticated owner rather than accepting a user ID from the body.
Accept only the targets `needs_review` and `reviewed`; no third state can suppress review work.
Each item carries a transaction UUID and its expected review version.

Algorithm:

1. Validate a nonempty array of at most 100 unique, well-formed items and a permitted target state.
2. Lock the requested transaction rows in ascending UUID order, with an explicit owner filter, before locking their review rows in the same order.
3. Verify that every requested transaction exists, belongs to the owner, has initialized state, is posted, and is not an excluded duplicate.
4. Verify every expected version before changing any row.
5. Update only entries whose stored status differs from the target, increment their versions, and set or clear `reviewed_at` using server time.
6. Return authoritative state/version for every target, together with `updated` and `unchanged` counts.

Any invalid, unavailable, or stale target aborts the entire batch; do not silently filter unauthorized IDs or return partial success.
Locking transaction parents also coordinates with source updates, deletion, and foreign-key inserts for duplicate exclusion.
Verify the real lock behavior and competing duplicate-confirmation function in two-session database tests; do not infer it from mocks.
Use the same parent-before-child order as existing financial operations, avoiding a review-row-before-transaction lock cycle.
PostgreSQL's [row-locking and deadlock guidance](https://www.postgresql.org/docs/17/explicit-locking.html) is the reference for this verification.

Use strict compare-and-set semantics, not a toggle endpoint.
A repeat request based on an old version returns a stale response; the client refreshes rather than overwriting newer intent.
A fresh request for the already-current state is a no-op and does not replace the original review timestamp.
An operation journal and permanent history table are unnecessary for this assignment-only first version.

## 7. API and application contracts

### 7.1 Mutation route

Create `PATCH /api/transactions/review` in `app/api/transactions/review/route.ts`.

Request example:

```json
{
  "status": "reviewed",
  "items": [
    { "transaction_id": "11111111-1111-4111-8111-111111111111", "expected_version": "3" }
  ]
}
```

Return versions as decimal strings end to end to avoid bigint precision loss in JavaScript.
Validate UUIDs, positive integer version strings, duplicate targets, supported keys, target status, and batch size before calling the RPC.
Reject malformed JSON and unexpected ownership/timestamp fields.
Set a small explicit body-size limit, proposed 32 KiB, before parsing an unbounded payload.

Success example:

```json
{
  "updated": 1,
  "unchanged": 0,
  "items": [
    {
      "transaction_id": "11111111-1111-4111-8111-111111111111",
      "status": "reviewed",
      "version": "4",
      "reviewed_at": "2026-09-08T01:00:00Z"
    }
  ]
}
```

| Outcome | HTTP behavior | Client behavior |
| --- | --- | --- |
| Invalid payload | 400 with a bounded validation message | Preserve selection; allow correction. |
| Missing session, MFA step-up, or revoked session | Existing `requireUser()` response | Follow the existing auth flow; no service write. |
| Foreign or missing ID | One indistinguishable 404, no IDs disclosed | Refresh and explain that selected entries are unavailable. |
| Stale version, newly pending entry, or new exclusion | 409 with `REVIEW_STATE_CHANGED` | Refresh; require a new explicit review action. |
| Per-user write limit exceeded | 429 using the existing limiter | Preserve state and explain that the user should retry later. |
| Database or integrity failure | 500 with a generic public message | Show failure; no local success state. |
| Successful batch | 200 with authoritative items and counts | Refresh rows/count, clear selection, announce result. |

Follow the repository route order: `requireUser()`, rate limit, feature reachability check, validation, service RPC, bounded audit, response.
Proposed write limit: 120 requests per user per hour; this is a configurable implementation constant, not a business entitlement.
Add `transaction_reviewed` and `transaction_review_reopened` to `AuditAction`, recording counts and action only, not merchant names, notes, amounts, or transaction payloads.
Use existing audit error handling so a logging failure after commit does not present a false financial-write failure.
Mark responses `Cache-Control: no-store`.

### 7.2 URL and loader changes

Extend `LedgerRawSearchParams` and `LedgerQueryState` with `review`.
Canonical values are `all | needs_review | reviewed`, with absent/invalid values normalized to All and omitted when serialized.
Persist nondefault review state through `ledgerQueryEntries()`, `savedLedgerViewParams()`, pagination, column controls, and saved-view restore.
Changing review resets the page; paging preserves review.
Clear filters clears review too, while switching only review preserves the other filters.

With the feature on, `buildLedgerFilterQuery()` reads the new view and applies the review predicate before pagination.
Needs review means stored status needs_review AND eligible; Reviewed means stored status reviewed AND eligible.
All remains inclusive of pending and excluded duplicate entries.
Use the same predicate for both direct and full-projection scans, preserving rule-applied merchant/category behavior.
Do not fetch 50 ordinary rows and then discard reviewed entries in the browser.
Do not add an arbitrary scan cap or one query per transaction.

Keep exact filtered totals and deterministic sort tie-breakers.
When mutations shrink the last page, navigate to the last valid page with the same filter/sort/column state rather than displaying a misleading empty page.
Maintain the existing incomplete-day handling for totals at page boundaries.
Extend projection and mobile row types to carry review fields without applying them to financial calculations.

### 7.3 Client components

Use a small transaction-review context around the existing server-rendered ledger subtree, with client controls as leaves.
Do not convert the entire Transactions page into a client-fetched page.

Proposed additions:

- `lib/transaction-review.ts`: state and response types, payload parsing helpers where appropriate, and eligible-row/selection helpers.
- `components/transactions/TransactionReviewProvider.tsx`: shared current-page selection, request state, authoritative refresh, and stale-state handling.
- `components/transactions/TransactionReviewControls.tsx`: row selection, row actions, select-shown, and bulk action controls.
- `components/transactions/TransactionReviewStatus.tsx`: accessible state display and pending/excluded explanation.

Extend `TableToolbar.tsx` with a review-controls slot instead of replacing its existing tag, sort, and column panels.
Extend the existing `LedgerTableRow` function inside `app/transactions/page.tsx`; there is no separate LedgerTableRow file at this baseline.
Recompute table header/day-group colspans when adding the selection column.
Extend `MobileLedgerList.tsx` and `LedgerCardRow` with the same status/version contract.
The existing editor can remain unchanged if review controls sit beside it; avoid altering its save semantics merely to add a review button.

## 8. Data lifecycle, compatibility, and privacy

The insert/update triggers cover every existing transaction writer rather than requiring each producer to remember a separate review call.
Regression coverage must exercise `lib/sync.ts`, `app/api/import/commit/route.ts`, `lib/scheduled-promotion.ts`, the manual-entry RPC, and reconciliation adjustments.
An identical import retry or scheduled promotion retry must preserve review state.
Backdated data arriving after rollout enters review based on insertion, not the historical transaction date.

Register review state in `lib/user-data.ts` for both takeout and encrypted backup.
Use `transaction_id` as the deterministic primary paging key because this table has no standalone `id` column.
Include the semantic state and timestamps and a documented version field for archive compatibility; do not expose auth/session credentials or reviewer IPs.
Validate owner scoping and inclusion beyond a single export page.
Account and transaction deletion cascade through the new foreign keys, including demo cleanup and bank-data removal.

Backup restore remains disabled under its existing feature gate.
Do not let the generic restore table loop silently start deleting/reinserting review state just because the archive registry now includes it.
Add an explicit restore capability guard for this section and tests that older archives without review metadata remain accepted by the existing parser.
Future safe restore must either verify restored transaction facts before reinstating a reviewed state or conservatively reopen it; archived version numbers cannot certify a newly restored database revision.
Implementing that recovery engine is outside this feature's release, and the plan makes no claim that review metadata is currently restorable in the application.

Review metadata is owner-private even when the underlying Plaid account is household-shared.
The service RPC must reject shared-but-not-owned IDs.
Normal financial reports, privacy-safe CSV columns, calendar feeds, and in-app AI payloads remain unchanged.

## 9. Sequential implementation work packages

### Commit 1: database contract and regression harness

Files: a new migration under `supabase/migrations/`, new `scripts/check-transaction-review.sql`, and `.github/workflows/migration-check.yml`.
Add table, constraints, grants, RLS, source triggers, complete backfill, read view, and atomic mutation RPC.
Run the script only against a clean isolated Supabase database and roll fixtures back.
Assert that all existing rows initialize as `needs_review`, including older history and pending entries.
Add a separate two-session concurrency test for review versus sync/duplicate confirmation.
Exit: schema installs from scratch, all current RLS checks pass, and new SQL assertions prove persisted state after failures.

### Commit 2: API and pure contracts

Files: new `app/api/transactions/review/route.ts`, new `lib/transaction-review.ts`, `lib/audit.ts`, and focused unit tests.
Implement explicit-state writes, strict input validation, rate limiting, response mapping, and server ownership derivation.
Test no-op, stale, unauthorized, missing, pending, excluded, and failing requests.
Exit: the route cannot partially approve a batch or trust browser ownership/timestamps.

### Commit 3: ledger queries and saved state

Files: `lib/ledger-query.ts`, `lib/ledger-data.ts`, `lib/ledger-projection.ts`, `app/transactions/page.tsx`, `lib/feature-flags.ts`, and loader/query tests.
Integrate the view in both query paths, review URL state, owner-wide queue summary, saved-view parameters, exact totals, page recovery, and errors.
Existing filters and display-value sorts remain the source of truth.
Exit: a dataset with more than 1,000 rows returns the same selected IDs, totals, and ordering in direct and projected paths under review filtering.

### Commit 4: desktop and mobile workflow

Files: the three proposed review components, `TransactionQueryControls.tsx`, `TableToolbar.tsx`, `MobileLedgerList.tsx`, and the page's existing table-row rendering.
Add review views, labels, row actions, shared selection, bulk actions, server-confirmed refresh, and accessible feedback/focus restoration.
Add focused render assertions and browser tests as part of this commit.
Exit: a user can review, reopen, filter, reload, and resume the queue on desktop and a phone without losing or acting on stale selection.

### Commit 5: lifecycle and release closure

Files: `lib/user-data.ts`, explicit handling in `lib/restore.ts`, lifecycle tests, feature flag tests, `docs/ARCHITECTURE.md`, `docs/TODO.md`, `docs/HANDOFF.md`, and `docs/QA.md` where needed.
Verify archive inclusion, parser compatibility, deletion cascades, flag-off behavior, and every producer path.
Record schema rollout and actual verification evidence separately from application deployment.
Exit: all acceptance criteria below have evidence, all exact-head hosted checks pass, and the deployment checklist is complete.

## 10. Acceptance criteria and tests

All criteria below are required for the first release.
Use synthetic fixtures only in an isolated environment for write tests.

| ID | Starting condition and trigger | Required observable result and prohibited side effect | Evidence |
| --- | --- | --- | --- |
| AC-01 | Existing transactions; apply migration | Each has one owner-matching `needs_review` state; none is silently approved. | Fresh-stack SQL assertions and backfill count comparison. |
| AC-02 | New rows arrive through Plaid, import, manual creation, scheduled promotion, or adjustment | Every posted row enters Needs review; pending rows wait; replaying identical writes does not reopen reviewed rows. | SQL trigger tests plus producer regression suites. |
| AC-03 | User marks one eligible row reviewed, reloads, then reopens it | State survives navigation and becomes Needs review again on explicit reversal; all financial and annotation fields remain unchanged. | Browser flow plus database before/after assertions. |
| AC-04 | User clears all notes/tags or changes splits/override | Review state remains intact and distinct from cleared status. | Existing editor/annotation tests extended with persisted review assertions. |
| AC-05 | Bank amount/date/account/name/category changes after review | Entry reopens atomically with a new version; timestamp-only sync does not reopen it. | Material-field matrix including null changes and no-op upserts. |
| AC-06 | Pending row is posted or replaced by a new posted ID | Posted row requires review, with no copied approval based on similar merchant/amount. | Sync and SQL lifecycle fixtures. |
| AC-07 | User selects a subset and marks it reviewed | Only selected eligible IDs change, every change commits together, and returned counts reflect changed versus unchanged rows. | API test plus SQL fault injection and persisted row assertions. |
| AC-08 | Batch includes foreign/missing/pending/excluded ID | Entire batch fails without disclosure or changes to valid IDs. | Owner A/owner B/household-shared role tests. |
| AC-09 | Two tabs submit different actions or bank sync changes a selected row | One consistent committed result; stale write gets 409 and cannot overwrite newer state. | Two-session integration test and two-page browser test. |
| AC-10 | At least 1,205 rows, remapping rules, two accounts, mixed review states | Review filter applies to the complete scope before pagination; all sorts, totals, saved views, and page links remain consistent. | Loader fixtures crossing 50 and 1,000 rows plus saved-view browser round trip. |
| AC-11 | Last item on the last Needs review page is approved | Navigate to a valid page or caught-up state, preserving other controls; no empty page with remaining matching work. | Browser pagination journey. |
| AC-12 | Selected rows change during auto-refresh or navigation | Stale selection clears; no unseen target is submitted after changing page, view, sort, or viewport. | Client interaction tests and desktop/mobile browser journey. |
| AC-13 | Anonymous, revoked, MFA-insufficient, or another user's session accesses table/view/RPC | Read/write denied; a household's visibility does not confer review ownership; service route cannot trust body `user_id`. | Actual RLS/privilege tests with auth claims, not only mocked route tests. |
| AC-14 | Request fails, response is lost after commit, or a source row lacks review state | No false success or caught-up state; refresh reconciles authoritative state before another action. | Fault injection, network interruption, and explicit missing-state fixture. |
| AC-15 | User exports data or deletes an account/transaction/user | Archive includes all owner review records beyond one page; deletion removes matching state; other users remain untouched. | Export pagination tests and real-FK deletion assertions. |
| AC-16 | Feature disabled, old saved view, or old archive | Current ledger works without new-schema queries; existing bookmarks and archive parsing remain compatible; restore is not enabled. | Feature-off page/route tests and historical archive fixtures. |
| AC-17 | Keyboard or phone user reviews a queue | Labelled controls, visible focus, meaningful announcements, distinct responsive IDs, accessible empty/error states, and no page overflow at 390px. | Browser tests, automated accessibility checks, and manual visual review at 390px and 1440px. |

Suggested new tests:

- `tests/unit/transaction-review.test.ts`: payload/state/selection helpers.
- `tests/unit/transaction-review-route.test.ts`: complete route contract and errors.
- `tests/unit/transaction-review-ledger.test.ts`: full-scope filters, missing state, counts, and page recovery.
- `tests/unit/transaction-review-render.test.ts`: labels, row actions, selection state, and both responsive surfaces.
- `tests/integration/transaction-review-concurrency.test.ts`: opposing sessions, sync changes, duplicate confirmation, and rollback.
- `tests/e2e/transaction-review.spec.ts`: complete user journey using the authenticated fixture with an explicit isolated URL gate.

Extend rather than replace the existing tests for ledger-query, ledger-data, transactions-page-sort, mobile-ledger-list, transaction-query-controls, manual-transaction-route, scheduled-promotion, user-data, restore, and feature flags.
Before running existing transaction E2E suites, strengthen their credential-only gating to require `TEST_SUPABASE_URL` to match the actual isolated app URL; the current `tests/e2e/transactions.spec.ts` checks only whether credentials exist.
Credentialed E2E must never run against the linked project containing real financial data.

## 11. Performance and operational verification

Use a reproducible isolated benchmark with 10,000 transactions across multiple accounts and a mix of pending, excluded, reviewed, and needs-review entries.
Record database query count and `EXPLAIN (ANALYZE, BUFFERS)` for default date sort, Needs review, owner count, and a rule-aware merchant sort.
Treat 50-row date-sorted loading with review enabled staying within 20% of the same-fixture baseline as a proposed regression budget, not a guaranteed production latency.
Investigate a failure through query plans before adding indexes or relaxing the budget.
Do not introduce per-row requests, an unconditional all-ledger scan for the default date path, or an all-time scan on every unrelated application page.
The existing full projection path may still scan matching rows for display-based sorting; this plan does not claim to replace that architecture.

Log bounded error codes and counts for failed review actions, missing state, and automatic reopen failures.
Do not add a notification to the user for each reopened transaction in the first release.
Compare review count and row-state invariants after simulated source sync, import retry, and deletion.

## 12. Release and rollback

1. Refresh the default branch, read the current repo instructions, check dependency freshness, and revalidate affected interfaces before implementation.
2. Preserve the confirmed all-history policy and verify the backfill covers every existing transaction.
3. Build and validate the additive migration in a clean isolated Supabase stack, including the new financial write tests and existing `scripts/check-rls.sql`.
4. Keep the new `transactionReview` flag off by default while the schema is absent; tests must prove flag-off compatibility with the old schema.
5. Apply the new migration only within the then-current deployment authorization, verify the exact linked project and migration ledger, and confirm row/state counts and grants with read-only checks.
6. Deploy the application with the feature off, verify the existing ledger, then enable the feature after isolated full Auth browser acceptance.
7. Check real-user screens read-only at desktop and phone widths; do not insert dummy financial records into production to test this workflow.
8. Run lint, typecheck, build, palette validation, and the complete unit coverage gate, preserving the repository's 95% branch threshold.
9. Inspect the exact remote-head CI, migration, E2E smoke, security, code-quality annotations, and preview results before merge/release claims.
10. Update canonical status documents with what was actually deployed and tested, including any remaining Auth/browser gate.

Rollback of the UI uses the feature flag and must preserve review records.
The flag does not remove the source triggers, so it is not a remedy for a faulty trigger blocking ingestion.
If a source-trigger defect occurs, use a reviewed additive repair migration; if emergency trigger suspension is necessary, record the affected ingestion interval and conservatively enqueue affected rows when restoring the trigger.
Do not drop the review table, rewrite deployed migrations, reset the whole queue, or claim old reviewed records remain reliable after untracked source changes.

## 13. Definition of done

The feature is complete when a user can empty a deliberately seeded review queue, reload without losing progress, reopen a reviewed row, and see a bank-modified row reappear, with identical desktop/mobile behavior.
The exact filtered result, saved views, and batch targets must be correct beyond page boundaries.
All required acceptance criteria must have recorded evidence, while financial totals and specialized review workflows remain unchanged.
Documentation must clearly distinguish implemented, migrated, deployed, and verified states.
No new dependency is required by this design; the dependency check during planning found only major ESLint, TypeScript, and Nodemailer updates, which are outside this documentation-only task.
