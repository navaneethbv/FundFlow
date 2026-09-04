# FundFlow Deferred Features Completion Design

## Scope

This design completes persistent receipts, the deferred Dashboard widget content, institution logos, and OFX or QFX imports inside PR #99.
The eight goal-template illustrations are already implemented, bundled, allowlisted, and tested, so the old C5 item is removed from the pending program without changing that code.

## Persistent receipts

### Security model

The existing `receipts` table and private Storage bucket remain the sources of truth.
A new migration will revoke direct authenticated insert, update, and delete access from `receipts`.
The migration will replace the table's all-operations policy with an owner-only select policy.
It will remove the authenticated Storage mutation policy because receipt objects will be written and signed only by server routes using the service client.

Every service-client table operation will include an explicit `user_id` predicate.
Every attachment will first prove that the candidate transaction belongs to the same user as the receipt.
Household visibility will not permit attaching a receipt to another member's transaction.
No receipt image, OCR text, signed URL, or storage path will enter ordinary logs, exports, weekly reports, backups, or Ask AI without a separately reviewed consent flow.

### Image handling

Uploads accept JPEG, PNG, WebP, and GIF up to 5 MB.
The server will validate both the declared MIME type and the decoded image format.
The server will re-encode the image to remove metadata before storage.
The stored object path will be `<user_id>/<receipt_id>.<normalized-extension>` inside the existing `receipts` bucket.

### API contract

`POST /api/receipts` accepts multipart form data with one image and optional extracted merchant, purchase date, and total fields.
It returns the created receipt and ranked transaction candidates.
`GET /api/receipts` returns the caller's receipts and short-lived signed image URLs.
`PATCH /api/receipts/[id]` accepts exactly one action: attach to an owned transaction, ignore, or restore to unmatched.
`DELETE /api/receipts/[id]` removes the database row and its private object, and reports a failure if either operation cannot be completed safely.

The pure matcher will move to `lib/receipts.ts` and will be shared by persistent receipts and the existing ephemeral AI scanner.
Candidates must fall within three calendar days and within one percent of the extracted total.
Merchant similarity is a ranking signal, not a requirement, because abbreviated receipt names often differ from normalized ledger merchants.
No attachment occurs without explicit user confirmation.

### User experience

Persistent receipts will live at `/transactions/receipts` so the inbox does not force the full ledger query to run and the ledger does not run while only receipts are being managed.
Transactions will expose a visible Receipts action that links to the inbox.
The inbox will show unmatched receipts first, provide signed-image viewing, show ranked candidate transactions, and provide attach, ignore, restore, and delete actions.
The existing ephemeral scanner in Settings remains available and gains an explicit Save to receipt inbox action after a successful scan.

### Verification

Unit tests will cover image validation, candidate ranking, state transitions, and ownership checks.
Route tests will cover malformed uploads, oversized images, unsupported formats, missing rows, and object cleanup failures.
The live RLS suite will prove that user B cannot read, sign, mutate, attach, or delete user A's receipt row or object.

## Budget Dashboard widget

The Dashboard's existing budgets query will add `group_name` and will not add a second Budget-page query.
The dashboard aggregation will produce three expense groups: Fixed, Flexible, and Non-monthly.
Income is excluded because the widget is an expense-budget summary.

Each group row contains planned, spent, remaining, percent used, and the worst contained status.
The widget displays every non-empty group instead of ranking four individual envelopes.
The total header remains the sum of current expense spending.
The existing `ProgressBar` component will carry status tone and accessible text.

## Investments Dashboard widget

Investment data will be loaded only for the overview view and only when the Investments widget is visible in normalized preferences.
The loader will fetch visible holdings and holding snapshots through existing RLS-scoped loaders.
It will retain only the latest two distinct snapshot dates before calling the existing investments-page aggregation.
This makes both same-day change and top movers describe the same comparison window.

The widget receives total value, day-change amount and percentage, and at most three top movers.
It will keep the existing honest empty state when no holdings exist.
It will not display a zero day change when fewer than two valuation dates exist.

## Institution logos

### Storage decision

`plaid_items` will gain nullable `institution_logo` and `institution_brand_color` columns.
The logo column stores Plaid's base64 PNG payload without a data-URI prefix.
Per-item storage is chosen over a global cache table because the payload is small, the item already owns institution identity, and this avoids a new cross-user cache access model.

### Capture and refresh

The shared Plaid institution helper will call `institutionsGetById` with `include_optional_metadata: true`.
New connections will persist institution id, name, logo, and brand color through `storeItem`.
Reconnect will best-effort refresh the same metadata without failing reconnection when the Institutions endpoint is unavailable.
The one-time backfill script will fetch each distinct institution id once and update every matching owned item through the service client.

The migration must be applied to the live project before exchange, reconnect, backfill, or UI code reads the new columns.
The backfill will be rate-limited and resumable.

### Rendering

`InstitutionAvatar` will accept the stored base64 logo and render a local data URI.
Malformed or absent logo data falls back to the deterministic initial disc.
No third-party favicon or logo lookup service will be introduced.
Account and institution surfaces that already render `InstitutionAvatar` will pass the stored logo without changing merchant-avatar behavior.

## OFX and QFX import

The existing `looksLikeOfx` and `parseOfx` functions remain the only statement parser for OFX and QFX.
The preview route will sniff the file contents before CSV column handling.
OFX rows will be adapted to the existing normalized import-row contract and then enter the same duplicate review, batch persistence, selection, and commit pipeline as CSV rows.

CSV manual column mapping will never appear for OFX or QFX files.
The positive-amount convention checkbox applies only to CSV because OFX carries an explicit sign convention.
The file input and copy will advertise CSV, OFX, and QFX.
Route and UI tests will prove both SGML-style OFX 1.x and XML-style OFX 2.x reach the existing review queue.

