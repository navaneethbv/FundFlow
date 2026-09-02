# FundFlow — Missing Must-Have Features

Status of this document: a gap list, not a roadmap. Each feature below is
something a mature personal finance app is expected to have that FundFlow does
not yet ship, with the current state verified against the codebase (2026-08-20).
Features are ranked by how much of a hole they leave in a real deployment.
Multi-currency is explicitly out of scope and deliberately not listed.

This list has been triaged to the items actually worth implementing as code.
Two items that are fully coded already but gated behind an owner action (not a
dev task) are noted separately below the list. Two items that are excluded by
explicit product/legal decision have been folded into "Out of scope" at the
bottom, where the reasoning is recorded so they are not re-raised as gaps.

Every item carries its current state so the list does not silently rot: when an
item ships, update the status line and the Definition of Done at the end.

## Definition of Done (applies to every item)

- Data model has owner-scoped RLS where user data is involved.
- Server code never exposes Plaid tokens, Supabase secret keys, or raw sensitive
  payloads to the browser.
- Service-client queries always filter `user_id` explicitly.
- UI has empty, loading, error, and success states.
- Light and dark themes are checked.
- Mobile layout is checked.
- Tests cover core calculations and permissions.
- `npm run lint`, `npm test`, and `npm run build` pass.

---

## 1. One-off scheduled (future-dated) transactions

**Status: missing. Nothing schedules a future transaction.**

Plaid recurring streams model bills that repeat. FundFlow has a Recurring page
(`/recurring`, `app/recurring/`) and a manual-transaction path
(`app/api/manual-accounts/`, `lib/manual-transaction.ts`), but every manual
entry posts immediately. There is no way to enter "transfer $500 to savings on
the 1st" or "rent due on the 25th" as a future-dated entry that appears in a
projected balance today and materializes in the ledger on its date.

### Why it is a must-have
A core job of a money app is showing what your balance will look like after the
bills that are already committed. Without scheduled entries, the cash-flow
forecast (`lib/planning.ts`, `forecastCashFlow`) and the Bill calendar
(`components/dashboard/BillCalendar.tsx`) only know about Plaid-detected
recurring streams, so a planned one-off payment is invisible until it hits the
ledger.

### What is needed
- A `scheduled_transactions` table (owner-scoped RLS) with date, amount,
  merchant/description, category, and optional `account_id` or
  `manual_account_id`.
- Create/edit/cancel UI beside the existing Add Transaction modal
  (`components/transactions/AddTransactionModal.tsx`) plus a list of upcoming
  entries.
- The daily sync cron promotes entries whose date has passed into
  `transactions` (deterministic id so re-runs never duplicate, mirroring the
  `import-<hash>` convention) and removes them from the schedule.
- The cash-flow forecast and Bill calendar read scheduled entries as additional
  outflows so the projection is honest.

### Acceptance criteria
- A scheduled entry shows in the forecast before its date and in the ledger on
  or after it.
- Cron promotion is idempotent (re-running changes nothing).
- RLS integration test proves user B cannot read or write user A's scheduled
  entries.

---

## 2. Account reconciliation

**Status: missing. There is no reconcile workflow.**

The ledger (`app/transactions/`) is a raw list of synced and manual entries.
There is no concept of a transaction being cleared versus outstanding, no
statement-balance entry, and no "does my ledger match my bank statement"
check. Searching for reconcile, cleared, outstanding, statement balance, or
adjust balance across `app/`, `components/`, and `lib/` returns nothing.

### Why it is a must-have
Every serious budgeting app (Monarch, YNAB, Quicken) has a reconcile step. It
is the single best defense against a silently-missing transaction, a double
import, or a bank-side correction, and it is what gives the user confidence
that the numbers the app shows are real. Without it, a discrepancy is only
noticed when a balance looks wrong.

### What is needed
- A per-account statement workflow: enter the statement's ending balance and
  date, and the app computes cleared total + outstanding total versus that
  balance.
- A cleared/outstanding toggle on ledger rows (a `cleared_at` timestamp column
  on `transactions` and `transaction_annotations` is a natural fit; synced
  rows stay untouched, the flag lives in annotations).
- A discrepancy view listing exactly which transactions are outstanding so the
  difference is attributable.
- A manual balance-adjustment entry for cases where the bank is right and the
  ledger needs a correction (recorded in the audit log, never silent).

### Acceptance criteria
- Reconcile shows cleared, outstanding, and the difference to the entered
  statement balance.
- Marking cleared persists across syncs (annotation lives beside the synced
  row, never mutating it).
- An adjust-balance entry is audit-logged and reversible.

---

## 3. Transfer detection and linking between own accounts

**Status: partial. Transfers are excluded by category, not linked.**

`lib/dashboard.ts` exports `TRANSFER_GROUPS as EXCLUDED_PFC` and drops
transfer/loan-payment categories from every spend total. That stops a card
payment from double-counting as spending. What does not exist is the pair
itself: you cannot mark two transactions (the checking withdrawal and the card
credit) as the two sides of one transfer, so they appear twice in the ledger
and cash-flow views as separate events, and a transfer that lands in a
miscategorized bucket counts as spending with no way to relabel the pair.

### Why it is a must-have
Inter-account transfers are the most common "weird" transactions in a ledger.
Being able to link and net them is what makes Cash Flow (`/cash-flow`) and
Reports (`/reports`) tell a story instead of showing noise. It is also a
prerequisite for any future "spending is only what left the household" feature.

### What is needed
- A "mark as transfer" action on a ledger row plus a link step to select the
  matching entry on the other side (the reverse of the existing refund pair
  flow in `components/transactions/RefundReview.tsx`, reusing its pattern).
- A `transfers` table or a `transfer_pair_id` on annotations; linked pairs net
  out of spend, category, and cash-flow aggregation the same way linked refunds
  already do in `getDashboardData`.
- Auto-suggest candidate pairs (same amount, opposite sign, within a window,
  different accounts) and let the user confirm or dismiss; store decisions so
  a re-sync does not resurface dismissed pairs, mirroring
  `transaction_review_decisions`.
- Netted pairs still appear in the ledger (like refunds) but with a joined
  indicator.

### Acceptance criteria
- Linked transfer pairs are excluded from spend/income/cash-flow totals exactly
  once.
- Dismissals persist across syncs.
- Splits and transfer linking compose without double counting.

---

## 4. Budget templates and month-to-month copy

**Status: partial — copy-last-month shipped 2026-09-02; saved templates still missing.**

Shipped: "Copy last month" on the Budget page (`components/budget/CopyLastMonthButton.tsx`)
backs `POST /api/budget/copy` (`app/api/budget/copy/`, plan logic in
`lib/budget-copy.ts`), which upserts the previous month's `budget_periods`
planned amounts into the target month keyed by the same `budget_id`, leaving
rollover/group/category untouched. When the target month already has envelopes
the route answers 409 and the dialog forces an explicit merge (fill empty) or
overwrite choice — never a silent replace. Still missing: a *saved* budget
template that seeds a month without needing a populated previous month.

`lib/budget-page.ts` supports `rollover_enabled` per budget row, so an
underspent envelope can carry forward. There is no budget template, no "copy
last month's numbers", and no way to seed a new month from a saved plan. A
user sets every envelope from zero each month.

### Why it is a must-have
The Budget page (`/budget`, Phase 4) is the planning center of the app. The
most common budget chore is the monthly reset, and doing it by hand every time
is exactly the friction a templates feature removes. Monarch and YNAB both ship
templates or copy-forward because the recurring monthly cadence is the whole
point of envelope budgeting.

### What is needed
- A saved budget template (per group/category planned amounts) stored per user.
- "Apply template" and "copy last month" actions on the Budget page that write
  planned amounts for the current month, preserving the user's rollover
  choices.
- The existing per-row rollover stays; templates are the seed, rollover is the
  carry.
- Idempotency: applying a template to a month that already has envelopes must
  prompt (overwrite vs. merge), never silently replace.

### Acceptance criteria
- Template applies to a fresh month deterministically.
- Copy-last-month is exact (same planned values, same group assignments).
- Overwrite/merge choice is explicit and never destructive without confirmation.

---

## 5. Backup restore path

**Status: missing. Backups are produced; there is no restore.**

`/api/cron/backup` builds an encrypted, gzipped takeout archive per user and
emails it monthly (`lib/backup.ts`, `lib/user-data.ts`). `readBackupArchive`
exists to decrypt an archive, but nothing in `app/` or `components/` calls it,
and there is no route and no UI to bring that archive back into the app.

### Why it is a must-have
A backup with no restore path is not a backup; it is a file. If a user's
account is deleted, or a sync path corrupts data, the only recovery is manual
re-entry. The takeout route (`app/api/export/takeout/`) gives the user their
data out, and this closes the loop by letting them put it back.

### What is needed
- A `POST /api/backup/restore` route that accepts an archive, verifies the
  per-user envelope, decrypts it, validates the payload against the same
  `lib/user-data.ts` table list it was built from, and replays it.
- A restore flow in Settings under Data, with a clear warning that it replaces
  current data for the affected tables and an audit-log entry.
- Replace must be all-or-nothing per table (transaction-style, not partial
  writes), and must never overwrite Plaid-synced rows in a way that breaks the
  sync cursor. Re-imported Plaid rows keep their deterministic ids, so a
  restore followed by a sync converges instead of duplicating.
- A dry-run mode that reports what would change before anything is written.

### Acceptance criteria
- A freshly-created backup restores to a byte-equivalent dataset (minus ids
  that must be regenerated, which the validation explicitly reports).
- A tampered or wrong-user archive is rejected.
- Restore is audit-logged and the user is prompted to confirm the destructive
  nature.

---

## 6. Migration import from other personal finance apps

**Status: missing. Statement import only.**

`lib/import.ts`, `lib/import-ofx.ts`, and the Import flow
(`components/settings/ImportSection.tsx`, `/api/import/preview`,
`/api/import/commit`) ingest raw bank-statement CSV, OFX, and QFX. There is no
import path for the export files that users actually have sitting in their
inbox: Mint's CSV export, Monarch's CSV export, or YNAB's exports. Every one of
those is a different column shape with its own conventions (Mint uses a
"Transaction Type" column, Monarch uses "Transaction Date"/"Amount" with
separate debit and credit semantics, YNAB splits into "Outflow"/"Inflow").

### Why it is a must-have
The app's import story is "bring your bank statements". But the people most
likely to need FundFlow are people leaving Mint (which shut down) or Monarch.
For them, the natural entry point is their old app's full export, not a pile
of per-bank statements. A migration import that maps those exports to the
existing review-and-commit pipeline turns the hardest part of switching apps
into a ten-minute task.

### What is needed
- Sniffers for Mint, Monarch, and YNAB export formats that normalize into the
  existing import-row contract (same as OFX/QFX already feed the preview
  pipeline, per `docs/superpowers/specs/2026-08-09-deferred-features-design.md`).
- Account mapping: each source account maps to a FundFlow account (or creates a
  manual account), with the deterministic `import-<hash>` id convention so
  re-imports are idempotent and the Plaid-overlap guard still applies.
- Budget/goal/rule imports are out of scope for v1; transactions only, with the
  UI saying so.

### Acceptance criteria
- A Mint CSV, a Monarch CSV, and a YNAB export each preview and commit through
  the existing review queue without manual column mapping.
- Re-importing the same file does not duplicate (idempotency preserved).
- Source account mappings are persisted so a second import lands in the same
  accounts.

---

## 7. Tax-ready categorization and export

**Status: shipped 2026-09-02.**

Shipped: the yearly tax export lives at `GET /api/export/tax?year=YYYY`
(`app/api/export/tax/route.ts`) with its Settings entry in Export data
(`components/settings/TaxExportButton.tsx`). Tax line items come from a curated
set (`lib/tax-categories.ts`) resolved from the free-form tags users already
assign in the ledger editor — no new column, no new editor; the legacy bare
`tax` tag falls back to "Other tax-tagged". Rows run through the canonical
projection (overrides, merchant rules, refunds, duplicates, splits), so splits
are counted once by construction, and `toTaxCsv` is finally wired (resolving
F3) with a per-line-item summary block appended. Session-only, gated by
`ai_export_enabled`, same date/merchant/amount/category privacy contract, and
the export carries a "not tax advice" note in the UI.

`app/api/export/csv?scope=tax` exports only transactions the user manually
tagged `"tax"` (`app/api/export/csv/route.ts:26`), and `toTaxCsv` in
`lib/export-formats.ts` is a tested but unwired dead export
(`docs/Security-Review-2026-08-20.md` F3). There is no structured notion of
tax category (W-2 income, mortgage interest, charitable donations, capital
gains, deductible expenses) and no tax-oriented report.

### Why it is a must-have
For US users, tax time is when a year of transaction data becomes valuable.
The app already tracks everything needed; what is missing is the categorization
surface and a one-click export that groups a year's transactions into the line
items a preparer or tax software actually asks for. A tag named "tax" is not
that.

### What is needed
- A curated tax-category set applied through the existing annotation flow
  (notes/tags/splits already live in `transaction_annotations`), reusing the
  tag registry (`lib/tags.ts`) so renames merge cleanly.
- A yearly tax export (route + Settings entry) that groups transactions by tax
  line item, using split-safe aggregation, and honors the existing privacy
  contract (date/merchant/amount/category, gated by the same export gate).
- Wire the existing `toTaxCsv` format into that route rather than deleting it,
  resolving F3.
- No tax advice: the export is data only, with a one-line "not tax advice"
  disclosure consistent with the Advice page's language rules.

### Acceptance criteria
- A year of transactions with tax categories exports grouped by line item.
- Splits are counted once (split-safe aggregation), never double.
- The export never includes balances, account numbers, or Plaid tokens.

---

## 8. Merchant logos and brand enrichment

**Status: partial. Institution logos yes; merchant logos no.**

Phase 12 shipped `plaid_institution.ts` and the institution backfill, so banks
render real logos and brand colors. Merchant avatars still fall back to the
deterministic initial disc; there is no merchant-brand data at all. The
deferred-features spec explicitly ruled out a third-party favicon/logo lookup
service.

### Why it is a must-have
This is the most visible polish gap versus Monarch, where every merchant in the
ledger has a recognizable logo. It is not a data-correctness feature, but it
is a readability feature: a wall of initials is materially harder to scan than
a wall of logos, and the ledger is the page users live in. It also builds the
brand-enrichment foundation a future merchant-rule preview would want.

### What is needed
- A `merchant_logos` table (or a column on `merchant_rules`) keyed by merchant
  name, storing an image URL or data URI with an allowlist of sources so the
  CSP (`img-src 'self' data: https:`) stays intact and no unknown host is
  introduced.
- Populate from a curated dataset (not a live scraper), with a deterministic
  initial-disc fallback when absent, mirroring `InstitutionAvatar`.
- Rendered in the ledger, dashboard Recent Activity, and merchant drilldowns;
  merchant-avatar behavior for unmapped merchants is unchanged.

### Acceptance criteria
- Mapped merchants render logos; unmapped render the existing initial disc.
- No new external host is introduced without a CSP entry.
- A logo never breaks the row layout at 375px or with the compact density
  setting.

---

## Blocked on owner action, not implementation work

These two are fully coded and tested already. What's missing isn't code, it's
an owner/ops step (provisioning a Plaid product, generating and setting
secrets) plus a verification pass. Tracked here so they aren't lost, but they
don't belong on an implementation backlog.

- **Real card APRs from Plaid Liabilities.** `lib/liabilities.ts` writes real
  purchase APRs but is gated behind `PLAID_LIABILITIES_ENABLED=1`, which is
  unset. Debt Payoff (`/debt`, `lib/debt.ts`) falls back to a flat 22% APR
  until the owner enables the Liabilities product in the Plaid dashboard and
  sets the flag (`docs/TODO.md` Phase 3 item 3), after which it just needs a
  verification pass that `apr` populates and the "assumed APR" fallback label
  shows correctly when a card has none.
- **Web push notifications activation.** `lib/push.ts`,
  `/api/push/subscribe`, and `components/notifications/PushSection.tsx` are
  complete, but `isPushConfigured()` is false until fresh `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` are generated directly
  in the deployment environment and set (the prior keys were exposed in a PR
  and are burned; `docs/TODO.md` Phase 3 item 4), after which it needs an
  end-to-end verification pass: subscribe, trigger a real alert, confirm
  delivery, confirm dead subscriptions self-prune.

---

## Out of scope (recorded so they are not re-raised as gaps)

- **Multi-currency support.** Deliberately not pursued.
- **In-app AI assistant as a first-class nav surface.** Product decision:
  the gated Ask-AI link keeps its slot, no sparkle everywhere
  (`docs/superpowers/specs/2026-08-02-monarch-visual-parity-design.md` §8.1).
- **Household write access for members.** Shared rows are read-only for
  members everywhere by design; member writes are not a gap
  (`docs/TODO.md`).
- **Retail sync and bill pay.** No authorized data source or processor
  integration; would need a partnership, not a code change.
- **Investment performance benchmarks.** `lib/benchmark-provider.ts` and the
  TWR math in `lib/investment-performance.ts` are ready, but
  `docs/ARCHITECTURE.md` records the decision not to wire a real provider
  until a licensed market-data source is provisioned; that's a legal
  exposure, not a missing feature (per project rules).
- **Credit score monitoring.** No consented bureau integration exists; it
  needs a partnership (Plaid's credit products or a direct bureau API), which
  is an owner/business decision rather than a code gap
  (`docs/TODO.md`).
