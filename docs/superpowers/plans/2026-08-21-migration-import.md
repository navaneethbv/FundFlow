# Migration Import from Mint, Monarch, and YNAB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a Mint, Monarch, or YNAB CSV export and have it normalize into the exact same `ImportedRow` shape and review-and-commit pipeline the existing bank-statement importer already uses — no new UI paradigm, no new idempotency mechanism, just three new sniffers feeding the pipeline that already exists.

**Architecture:** Each source format gets a pure sniffer-plus-normalizer pair (`detectMintCsv`/`parseMintCsv`, and the Monarch/YNAB equivalents) that outputs `ImportedRow[]` — the identical shape `lib/import.ts::parseImportCsv` and `lib/import-ofx.ts::parseOfx` already produce. The existing `/api/import/preview` and `/api/import/commit` routes gain one new dispatch branch each (format sniffing happens before the existing OFX-vs-CSV branch) and otherwise need no changes: `makeImportId`, the fingerprint-duplicate flagging, and the deterministic-id upsert all already work format-agnostically.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres, Vitest.

**Spec:** `/Users/navaneethbv/Desktop/Projects/FundFlow/features.md` §6 ("Migration import from other personal finance apps").

## Global Constraints

- Every sniffer/normalizer is pure logic in `lib/`, unit-test priority, with the route only wiring it to the database — matching `lib/import.ts`'s own doc comment.
- Output must be the existing `ImportedRow { date: string; amount: number; merchant: string; category: string | null }` contract, Plaid sign convention (positive = money out) — each source format's own sign convention must be translated at the normalizer boundary, not leaked downstream.
- Re-importing the same file must not duplicate — this is already guaranteed by `makeImportId`/`onConflict: "plaid_transaction_id"` as long as normalizers produce stable, deterministic `ImportedRow`s from the same input file.
- Account mapping: reuse the existing account-selection UI (`ImportSection.tsx`'s `<Select>` of `accounts`) — do not build a new source-account-to-FundFlow-account mapping table for v1; if the user has no matching account, they create one via the existing `manual_accounts` create flow first, same as today's CSV importer requires.
- Budget/goal/rule imports are explicitly out of scope for v1 — transactions only, and the UI must say so.
- Route handlers: `requireUser()` → early-return the `NextResponse` → rate limit → `badRequest()` → work → `writeAudit()` → JSON, wrapped so failures hit `errorResponse(context, error)`.
- Tests mock with `vi.mock` and import route handlers directly, using `tests/fixtures/supabase-query.ts`.
- `npm run lint`, `npm test`, and `npm run build` must pass before this is done.

---

### Task 1: Implement the Mint CSV sniffer and normalizer

**Files:**

- Create: `lib/import-mint.ts`
- Create: `tests/unit/import-mint.test.ts`

**Interfaces:** `looksLikeMintCsv(headerRow: string[]): boolean` and `parseMintCsv(text: string): ImportParseResult` (same `ImportParseResult` shape `lib/import.ts` already exports).

Mint's export header is `"Date","Description","Original Description","Amount","Transaction Type","Category","Account Name","Labels","Notes"`. `Transaction Type` is `"debit"` or `"credit"`; `Amount` is always a positive magnitude regardless of type (Mint does not use a signed amount column), so the sign comes entirely from `Transaction Type`, not from the number's own sign — this is the one Mint-specific translation rule to get right; unlike a bank CSV, blindly trusting the amount's sign here is wrong even before accounting for `positiveIsIncome`.

- [ ] Write failing tests covering: `looksLikeMintCsv` returns `true` for a header containing `"Transaction Type"` and `"Original Description"` (Mint's two most distinctive column names — case-insensitive, matching `lib/import.ts::detectColumns`'s header-normalization style) and `false` for a plain bank CSV or a Monarch/YNAB header; `parseMintCsv` maps `Transaction Type: "debit"` to a positive `ImportedRow.amount` and `"credit"` to negative, regardless of the raw `Amount` column's own sign; `Description` (not `Original Description`) becomes `ImportedRow.merchant`; `Category` becomes `ImportedRow.category`; a malformed row (missing/unrecognized `Transaction Type`, unparseable `Amount`, or unparseable `Date`) is reported in `errors` with a 1-based line number, never silently dropped — mirror `parseImportCsv`'s per-line error accumulation exactly; dates parse via the existing `normalizeDate` from `lib/import.ts` (Mint dates are `MM/DD/YYYY`, already one of `normalizeDate`'s supported formats — reuse it, don't reimplement date parsing).
- [ ] Run `npx vitest run tests/unit/import-mint.test.ts` and confirm failure.
- [ ] Implement `looksLikeMintCsv`/`parseMintCsv` in `lib/import-mint.ts`, importing and reusing `parseCsv`, `normalizeDate`, and `parseAmount` from `lib/import.ts` rather than duplicating CSV/date/amount parsing.
- [ ] Run the test file again and confirm it passes.
- [ ] Commit with `feat(migration-import): add Mint CSV support`.

### Task 2: Implement the Monarch CSV sniffer and normalizer

**Files:**

- Create: `lib/import-monarch.ts`
- Create: `tests/unit/import-monarch.test.ts`

**Interfaces:** `looksLikeMonarchCsv(headerRow: string[]): boolean` and `parseMonarchCsv(text: string): ImportParseResult`.

Monarch's export header is `"Date","Merchant","Category","Account","Original Statement","Notes","Amount","Tags"`, with a **signed** `Amount` column (negative = expense in Monarch's own convention — the inverse of Plaid's) — Monarch does not split debit/credit into a separate column the way Mint does, so this format's translation rule is a sign flip, not a type-column lookup: `ImportedRow.amount = -monarchAmount`.

- [ ] Write failing tests covering: `looksLikeMonarchCsv` returns `true` for a header containing `"Merchant"` and `"Original Statement"` (distinctive Monarch columns not present in Mint or a plain bank CSV — `"Merchant"` alone is too generic, since a bank CSV can use that word too, so the sniffer must require the pairing) and `false` for Mint/YNAB/bank headers; `parseMonarchCsv` negates `Amount` (Monarch expense = negative → Plaid money-out = positive) and flags a row whose sign flip disagrees with common sense as **not** an error (there's no validation possible here beyond the sign flip itself — this is a translation rule, not a data-quality check); `Merchant` becomes `ImportedRow.merchant`, `Category` becomes `ImportedRow.category`; dates (`YYYY-MM-DD` in Monarch's export) parse via the existing `normalizeDate`.
- [ ] Run the test file and confirm failure.
- [ ] Implement, reusing `parseCsv`/`normalizeDate`/`parseAmount` from `lib/import.ts`.
- [ ] Run the test again and confirm it passes.
- [ ] Commit with `feat(migration-import): add Monarch CSV support`.

### Task 3: Implement the YNAB export sniffer and normalizer

**Files:**

- Create: `lib/import-ynab.ts`
- Create: `tests/unit/import-ynab.test.ts`

**Interfaces:** `looksLikeYnabCsv(headerRow: string[]): boolean` and `parseYnabCsv(text: string): ImportParseResult`.

YNAB's register export header is `"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"` — a two-column split like a bank CSV's debit/credit pair, so this format reuses that shape most directly. Note `Payee` (not `Description`/`Merchant`) is the merchant field, and `Category Group/Category` (the combined column) is generally more useful for `ImportedRow.category` than the bare `Category` column alone, since YNAB's categories are hierarchical.

- [ ] Write failing tests covering: `looksLikeYnabCsv` returns `true` for a header containing both `"Outflow"` and `"Inflow"` alongside `"Payee"` (this three-way combination is distinctive to YNAB — `Outflow`/`Inflow` alone could theoretically collide with a bank CSV's debit/credit-style headers, so require `Payee` too) and `false` for Mint/Monarch/bank headers; `parseYnabCsv` treats a nonzero `Outflow` as positive `ImportedRow.amount` and a nonzero `Inflow` as negative, matching `lib/import.ts::parseImportAmount`'s existing debit/credit-column logic exactly (in fact, factor this out: if `detectColumns`'s existing debit/credit branch and this YNAB normalizer end up implementing the identical two-column-to-signed-amount rule, extract a shared helper in `lib/import.ts` and have both call it, rather than a third copy of the same three lines); `Payee` becomes `ImportedRow.merchant`; `Category Group/Category` becomes `ImportedRow.category` when present, falling back to bare `Category`; YNAB amounts may be formatted with a thousands separator and no currency symbol (e.g. `"1,234.56"`) — reuse `parseAmount` from `lib/import.ts`, which already strips `$`/`,`/whitespace, rather than writing new number parsing.
- [ ] Run the test file and confirm failure.
- [ ] Implement, reusing `parseCsv`/`normalizeDate`/`parseAmount` from `lib/import.ts`, and the extracted shared debit/credit-to-signed-amount helper if Task 3's dedup step applies.
- [ ] Run the test again and confirm it passes.
- [ ] Commit with `feat(migration-import): add YNAB export support`.

### Task 4: Wire the three sniffers into the existing preview/commit routes

**Files:**

- Modify: `app/api/import/preview/route.ts`
- Modify: `app/api/import/csv/route.ts`
- Modify: `tests/unit/` files covering both routes (locate the existing test files for `import/preview` and `import/csv`)

**Interfaces:** A new shared dispatcher, `lib/import.ts::detectSourceFormat(text: string): "mint" | "monarch" | "ynab" | "csv" | "ofx"`, used by both routes in place of each route's current ad-hoc `looksLikeOfx(text) ? ... : parseImportCsv(...)` branch — this also fixes the pre-existing duplication the research surfaced (both routes independently reimplement the OFX-vs-CSV dispatch; consolidating it here means the new formats are wired exactly once, not twice).

- [ ] Write failing tests covering: `detectSourceFormat` checks OFX first (`looksLikeOfx`), then Mint/Monarch/YNAB header sniffing (parse just the header row via `getCsvColumns`), falling back to plain `"csv"` when none match; each route's existing OFX and plain-CSV behavior is unchanged (regression coverage — re-run the existing test suites for both routes and confirm nothing broke); a Mint/Monarch/YNAB file previewed through `/api/import/preview` produces `needs_mapping: false` and populated `rows` without the user ever seeing the manual column-mapping UI (the whole point of a dedicated sniffer over generic `detectColumns` is that these formats never need manual mapping); re-uploading the same Mint/Monarch/YNAB file through `/api/import/csv` a second time reports `imported: 0` (all rows already present, deterministic ids collide) proving idempotency carries over from the existing mechanism unchanged.
- [ ] Run the affected test files and confirm the new cases fail.
- [ ] Implement `detectSourceFormat` in `lib/import.ts`, then update `parseUploadedRows` in `app/api/import/csv/route.ts` and `parsePreviewInput` in `app/api/import/preview/route.ts` to call it and dispatch to the matching parser (`parseMintCsv`/`parseMonarchCsv`/`parseYnabCsv`/`parseImportCsv`/`parseOfx`) instead of each route's current inline OFX check.
- [ ] Also fix the `category` handling gap the research surfaced while touching this code: `app/api/import/commit/route.ts` currently hardcodes `category: null` even though the parsed rows carry a category — since Mint/Monarch/YNAB rows are far more likely to have a useful `category` than a bank CSV, thread `imported.category` through into `pfc_primary` in the commit route the same way `csv/route.ts`'s `buildDatabaseRows` already does, rather than shipping this feature on top of a route that silently drops the very field these new formats rely on most.
- [ ] Run the affected test files again and confirm everything passes, including the pre-existing OFX/CSV cases.
- [ ] Commit with `feat(migration-import): wire Mint, Monarch, and YNAB into the import pipeline`.

### Task 5: Update the import UI to reflect the new formats and the transactions-only scope

**Files:**

- Modify: `components/settings/ImportSection.tsx`
- Modify: `components/settings/ImportReviewSection.tsx` (the review-flow component fed by `/api/import/preview`, referenced from `app/settings/page.tsx` but not previously read in full — read it before editing)

**Interfaces:** No new props; both components' copy and the file-input's `accept` attribute change to reflect the widened format support.

- [ ] Update `ImportSection.tsx`'s `accept` attribute and helper copy to mention Mint, Monarch, and YNAB exports alongside bank CSV/OFX/QFX, and add a one-line note that only transactions import (budgets, goals, and rules from the source app are not carried over) — this satisfies the acceptance criterion that the UI says so explicitly.
- [ ] Make the equivalent copy update in `ImportReviewSection.tsx` if its file-picker/help text duplicates `ImportSection.tsx`'s copy.
- [ ] Verify by hand in the dev server with a small real (or hand-built) sample file from each of the three formats: preview shows correctly-signed amounts and merchants with no manual column-mapping step; commit imports without duplication on a second upload; light/dark themes; 375px mobile layout.
- [ ] Commit with `feat(migration-import): update import UI copy for new formats`.

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] Run `npm run lint`, `npm run test:unit`, and `npm run build`; fix anything this feature introduced.
- [ ] Manually verify the three acceptance criteria from `features.md` §6: a Mint CSV, a Monarch CSV, and a YNAB export each preview and commit through the existing review queue without manual column mapping; re-importing the same file of each format doesn't duplicate; the account chosen during import is remembered only in the sense that the existing account-selection UI already persists nothing extra to re-derive — confirm a second import of the same source file against the same account lands in that same account without prompting again for anything the first import already established.
- [ ] Update `docs/HANDOFF.md` and `docs/TODO.md`.
