# Tax-Ready Categorization and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a user a curated set of tax categories (W-2 income, mortgage interest, charitable donations, capital gains, deductible expenses), a way to tag transactions into them through the existing annotation flow, and a yearly export that groups a year's transactions by tax line item — split-safe, honoring the existing privacy and `ai_export_enabled` contract, and replacing today's silent `"tax"`-tag-only export with something that resolves the already-written-but-dead `toTaxCsv` dead-code finding (F3) instead of adding a third, competing tax-CSV shape.

**Architecture:** Tax categories are just a curated, reserved slice of the existing tag registry (`lib/tags.ts`/`user_tags`) — no new table. The export route is rebuilt to read through `lib/finance-domain.ts::projectFinanceTransactions` (the canonical, split-aware, transfer-netted projection) instead of querying `transactions` directly, which is the one correctness gap the research surfaced in the current `?scope=tax` branch. `toTaxCsv` gets wired in as the actual serializer for this route instead of staying dead code.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres, Vitest.

**Spec:** `/Users/navaneethbv/Desktop/Projects/FundFlow/features.md` §7 ("Tax-ready categorization and export").

## Global Constraints

- No tax advice: the export is data only, with a one-line "not tax advice" disclosure consistent with the Advice page's language rules (never "prediction" or a confidence level nothing computes, per `CLAUDE.md`'s money-and-correctness rules).
- The export must never include balances, account numbers, or Plaid tokens — same privacy contract as every other export route.
- Splits must be counted once (split-safe aggregation), never double — route through `projectFinanceTransactions`, not a raw `transactions` query.
- Every export route goes through `resolveExportContext` → the `ai_export_enabled` gate (`fetchPrivacySafeRows`/`isExportAllowed`) → `recordExport` — this route is no exception.
- Route handlers: `requireUser()` → early-return the `NextResponse` → `badRequest()` → work → `writeAudit()`-equivalent (`recordExport` already calls `writeAudit` internally) → response, wrapped so failures hit `errorResponse`/`exportError`.
- Create migrations with `npx supabase migration new <slug>` only if a schema change turns out to be needed (this plan is designed not to need one — flag it as a plan deviation if Task 1 finds otherwise).
- Tests mock with `vi.mock` and import route handlers directly, using `tests/fixtures/supabase-query.ts`.
- `npm run lint`, `npm test`, and `npm run build` must pass before this is done.

---

### Task 1: Define the curated tax-category set and a validator

**Files:**

- Create: `lib/tax-categories.ts`
- Create: `tests/unit/tax-categories.test.ts`

**Interfaces:** `TAX_CATEGORIES: readonly TaxCategory[]` (a fixed list: `"W-2 Income"`, `"1099 Income"`, `"Mortgage Interest"`, `"Charitable Donations"`, `"Capital Gains"`, `"Capital Losses"`, `"Deductible Business Expense"`, `"Medical Expense"`, `"Property Tax"`, `"Other Deduction"`) and `isTaxCategory(tag: string): tag is TaxCategory`.

These are applied through the **existing** tag registry (`transaction_annotations.tags`, `lib/tags.ts`) exactly as `features.md` specifies ("reusing the tag registry so renames merge cleanly") — a tax category is just a tag whose name happens to be one of these ten strings. No new table, no new column. The one piece of real logic this task adds is the closed list itself and a type guard the export route uses to separate "tax-relevant tags" from a user's other free-form tags.

- [ ] Write failing tests: `isTaxCategory` returns `true` for every string in `TAX_CATEGORIES` and `false` for an arbitrary tag like `"groceries"` or a near-miss like `"w2 income"` (exact match only — case and punctuation matter, since these are also the literal strings rendered in the tag picker and exported CSV).
- [ ] Run `npx vitest run tests/unit/tax-categories.test.ts` and confirm failure.
- [ ] Implement `TAX_CATEGORIES` and `isTaxCategory` in `lib/tax-categories.ts`.
- [ ] Run the test again and confirm it passes.
- [ ] Commit with `feat(tax-export): define curated tax category set`.

### Task 2: Build the tax-year aggregator as a pure, split-safe function

**Files:**

- Modify: `lib/export-formats.ts`
- Create: `tests/unit/tax-export.test.ts`

**Interfaces:** `groupByTaxCategory(rows: CanonicalFinanceTransaction[], tagsByTransactionId: Map<string, string[]>): TaxCategoryGroup[]`, where `TaxCategoryGroup` is `{ category: TaxCategory; rows: ExportRow[]; total: number }` — this is the function that makes the export "grouped by tax line item" rather than a flat CSV, and it's the one place split-safety actually needs proving, so it gets its own dedicated test file rather than folding into the route's tests.

- [ ] Write failing tests covering: a transaction tagged with exactly one `TaxCategory` tag lands in that category's group at its (already split-projected) `signedAmount`; a transaction with **no** tax-category tag is excluded entirely (this export is opt-in per transaction, not "everything from the year"); a transaction tagged with **two** different tax-category tags (e.g. both `"Mortgage Interest"` and `"Property Tax"` on one payment, a realistic case for an escrowed mortgage payment) appears in **both** groups at its full amount — this is a deliberate exception to "never double count": the source data itself claims the transaction belongs to two line items, so both totals are correct even though summing across all groups would overcount that one payment; document this explicitly in a code comment since it looks like the split-safety rule at first glance and isn't; a transaction already split via `transaction_splits` (so it arrives here as multiple `CanonicalFinanceTransaction` rows, one per split, per `projectFinanceTransactions`'s existing split-expansion) is grouped split-by-split — each split's own tags (read from the annotation on the *parent* transaction id, since splits don't carry independent tags) put that split's row into the group, proving a split $500 Costco run ($300 tagged deductible, $200 untagged) exports only its $300 half under the deductible category, not the full $500; group totals sum their member rows' amounts exactly (a rounding regression test at the cent boundary).
- [ ] Run `npx vitest run tests/unit/tax-export.test.ts` and confirm failure.
- [ ] Implement `groupByTaxCategory` in `lib/export-formats.ts` next to the existing `toTaxCsv`, and update `toTaxCsv` itself to accept the grouped shape (or add a new `toTaxCsvGrouped(groups: TaxCategoryGroup[]): string` alongside it if changing `toTaxCsv`'s signature would break another caller — check for other callers first; the research found none, so changing it in place is likely safe, but verify before deciding).
- [ ] Run the test file again and confirm it passes.
- [ ] Commit with `feat(tax-export): add split-safe tax category aggregation`.

### Task 3: Rebuild the tax export route on the canonical projection

**Files:**

- Modify: `app/api/export/csv/route.ts`
- Modify: `tests/unit/` file covering `app/api/export/csv/route.ts` (locate the existing test file and extend it)

**Interfaces:** The existing `GET /api/export/csv?scope=tax` branch is replaced — same URL contract, but internally it now calls `projectFinanceTransactions` (feeding it the same `rows`, `merchantRules`, `categoryOverrides`, `splits`, `linkedRefunds` inputs `getDashboardData` already assembles, scoped to a tax year) instead of querying `transactions` directly, then filters to rows whose parent transaction carries a `TaxCategory` tag, then calls `groupByTaxCategory`, then serializes with `toTaxCsv`/`toTaxCsvGrouped`.

- [ ] Write failing tests covering: the route still gates on `resolveExportContext` and the `ai_export_enabled` check exactly as before (`403` when disabled) — this is regression coverage, not new behavior; a new `?scope=tax&year=2026` query param (add `year`, since "yearly tax export" per the spec needs a year boundary the current route has no concept of — default to the current year when omitted) filters transactions to that calendar year before projection; a split transaction with one tax-tagged split and one untagged split exports only the tax-tagged half (integration-level proof that Task 2's unit-tested function is actually wired in correctly, not just unit-correct in isolation); a transfer-linked transaction (once transfer-linking, per the companion plan, exists — if that feature hasn't landed yet in this codebase when this task is implemented, skip this case and note it as a follow-up rather than blocking on an unshipped dependency) never appears in the export even if tax-tagged, since `flow: "transfer"` rows are cash movement, not income or a deduction; the response never includes account numbers, balances, or any column beyond `date, merchant, category, amount` (or whatever `toTaxCsv`'s header row actually is) — a snapshot-style assertion on the CSV header row; `recordExport` is called with `format: "csv"` and the actual row count on success.
- [ ] Run the affected test file and confirm the new/changed cases fail.
- [ ] Implement: in the `scope === "tax"` branch, replace the direct `transactions` query with: fetch the same inputs `getDashboardData` uses for a year-scoped window (`rows`, `merchantRules`, `categoryOverrides`, `splits`, `linkedRefunds`, and `linkedTransfers` if that table exists in this codebase by the time this task runs), call `projectFinanceTransactions`, build a `tagsByTransactionId` map from `transaction_annotations` (querying `.select("transaction_id, tags").eq("user_id", userId).gte(...).lte(...)` for the year window), call `groupByTaxCategory`, serialize with the Task 2 serializer, and set the `Content-Disposition` filename to include the tax year (e.g. `fundflow-tax-2026.csv`).
- [ ] Delete the now-dead inline tax-branch code this replaces (the direct `transaction_annotations`/`transactions` query and manual row-mapping currently in the route) rather than leaving both paths present.
- [ ] Run the test file again and confirm everything passes, including the pre-existing non-tax-scope regression cases.
- [ ] Commit with `fix(tax-export): rebuild tax export on the canonical split-safe projection`, and reference the `docs/Security-Review-2026-08-20.md` F3 finding this closes in the commit body.

### Task 4: Build the tax-category tagging and yearly export UI

**Files:**

- Modify: `components/transactions/TransactionEditor.tsx` (or wherever the existing tag picker renders — confirm the exact file by reading the annotate-flow UI before editing)
- Modify: `components/settings/ExportSection.tsx`

**Interfaces:** No new components required if the existing tag picker in `TransactionEditor.tsx` already supports arbitrary tag entry — in that case this task is purely a UX affordance (surface the ten `TAX_CATEGORIES` as quick-pick chips above the free-form tag input, using `lib/tax-categories.ts::TAX_CATEGORIES`) plus a new export entry point.

- [ ] Add a "Tax categories" quick-pick row to the transaction tag editor: ten chips (from `TAX_CATEGORIES`) that toggle the corresponding tag on click, rendered above or beside the existing free-form tag input, sharing the same `POST`/`PATCH` call the tag editor already makes (no new API call — this is purely a faster way to add one of the ten reserved tag strings).
- [ ] Also support tax-category tagging in bulk via the existing `/api/transactions/annotate-batch` route (already generic over `tag: string`) — add a "Tag as tax category" bulk action to wherever multi-select ledger actions currently live, if such a bulk-action surface already exists; if it doesn't exist yet, skip this step and note it as a nice-to-have follow-up rather than inventing a new bulk-select UI paradigm for this feature alone.
- [ ] Add a "Tax export" entry to `ExportSection.tsx`: a year `<Select>` (populate from the range of years the user actually has transactions in, or a fixed recent-years list if that data isn't cheaply available at render time) plus a `ButtonLink` to `/api/export/csv?scope=tax&year=<selected>`, with the one-line "This is data only, not tax advice" disclosure directly beneath it.
- [ ] Verify by hand in the dev server: tagging a transaction with a tax category via the quick-pick chip persists and shows in the ledger's existing tag badges; the yearly export downloads a CSV grouped by tax line item with correct split-safe totals; light/dark themes; 375px mobile layout.
- [ ] Commit with `feat(tax-export): add tax-category tagging and yearly export UI`.

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] Run `npm run lint`, `npm run test:unit`, and `npm run build`; fix anything this feature introduced.
- [ ] Manually verify the three acceptance criteria from `features.md` §7: a year of tagged transactions exports grouped by line item; a split transaction is counted once per split, never doubled, across the whole export; the export contains no balances, account numbers, or Plaid tokens (diff the exported CSV's columns against the privacy contract by eye).
- [ ] Confirm `docs/Security-Review-2026-08-20.md`'s F3 finding (`toTaxCsv` unwired dead export) is resolved and update that document if it tracks finding status inline.
- [ ] Update `docs/HANDOFF.md` and `docs/TODO.md`.
