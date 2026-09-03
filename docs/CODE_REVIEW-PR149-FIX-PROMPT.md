# Handoff prompt: fix the defects found in FundFlow PR #149

Copy everything below the line into the other LLM's first message.

---

You are working in the FundFlow repository, a personal-finance app for 1-2 users: Next.js 16 App Router (TypeScript, Tailwind 4) on Vercel, Supabase for auth and Postgres, Plaid for bank data.

Your job is to fix a list of defects found in an already-open pull request. A full review is committed at `docs/CODE_REVIEW-PR149-2026-09-02.md`. **Read that file first.** It has the reasoning and exact file:line references behind every item summarized here.

## Before you touch anything

Read `CLAUDE.md` and `AGENTS.md` at the repo root. They contain hard invariants. The ones most likely to be broken by this work:

- **Two Supabase clients.** `lib/supabase/server.ts` `createClient()` is cookie-bound and RLS applies. `lib/supabase/service.ts` `createServiceClient()` **bypasses RLS** and every query through it must filter `user_id` explicitly.
- **Amount sign follows Plaid: positive = money out**, negative = money in. Dates are `YYYY-MM-DD` strings end to end; month keys are `YYYY-MM`.
- **Every spend total must apply `EXCLUDED_PFC`** (aliased from `TRANSFER_GROUPS` in `lib/finance-domain.ts`), or credit-card payments get double-counted.
- **Migrations in `supabase/migrations/` are applied by hand.** There is no migration runner in CI, so code reading a new column fails until a human applies it to the live project. If you add or change a migration, say so explicitly in your summary so it can be applied.
- **Never silently swallow an error.** Route handler convention is: `requireUser()` -> early-return the `NextResponse` -> rate limit where sensitive -> validate with `badRequest()` -> work -> `writeAudit()` -> JSON, all wrapped so failures hit `errorResponse(context, error)`.
- Tests mock with `vi.mock` and import route handlers directly rather than spinning up a server.

Style rules that apply to everything you write:

- Simplest solution that works. No abstractions or flexibility unless asked for.
- Do not touch unrelated code. Exception: if you see a lint error, failing test, or flaky test along the way, fix it.
- Prefer immutable patterns; do not mutate inputs.
- Never use an em dash (U+2014) in any output. Use a comma, colon, semicolon, hyphen, or parentheses.
- Ask rather than assume. If a requirement is ambiguous, ask before writing code.

## Critical: the working tree already has work in it. Do not discard it.

Current branch: `feat/frontend-motion-and-power-features`.

- Local `HEAD` is commit `4c1156e` ("test: reproduce PR 149 review defects"). It is **unpushed** and contains deliberately failing tests that encode the intended behavior for three of the defects below. These red tests are the specification. Make them pass. Do not weaken or delete them.
- There are **uncommitted modifications** to `app/api/rules/batch/route.ts`, `components/settings/RestoreSection.tsx`, `lib/planning.ts`, `lib/restore.ts`, `lib/scheduled-transactions.ts`, `lib/tax-export.ts`, plus an **untracked** `supabase/migrations/20260902220000_smart_rules_regex.sql`. These are correct partial fixes from a previous round. Keep them.

Do not run `git stash`, `git checkout -- .`, `git reset --hard`, or `git clean`. Confirm with `git status` before and after any git operation.

## How to verify

```bash
npx tsc --noEmit           # typecheck
npm run lint               # eslint
npm run test:unit          # unit tests only, no external services
node scripts/validate_palette.js   # chart palette gate, must stay green
npm run build              # fastest full type/route check
```

Run one file with `npx vitest run tests/unit/<file>.test.ts`.

Do **not** run `npm test` (it includes integration tests that hit the live Supabase project). Do not point integration tests at a database with real user data.

Baseline right now: `tsc` clean, `lint` clean, palette green, **3 unit tests failing** out of 4,721.

## Working agreement

Work through the items **one at a time, in the order given**. For each one:

1. Confirm you can reproduce the defect (run the named red test, or write one if the item has no test yet).
2. Make the smallest change that fixes it.
3. Re-run `npx tsc --noEmit`, `npm run lint`, and `npm run test:unit`.
4. Stop and report: what you changed, what now passes, anything you found that changes the plan.

Do not batch multiple items into one change set. Do not move to the next item until the current one is confirmed green.

---

## The defects

### 1. BLOCKER: restore wipes the ledger and restores nothing

Files: `lib/restore.ts`, `lib/user-data.ts`

`RESTORE_ORDER` puts `accounts` first. `restoreUserTable` runs `DELETE FROM accounts WHERE user_id = X`. `accounts` is the cascade root for most of the schema: `transactions.account_id` is `on delete cascade`, and transitively that takes `transaction_annotations`, `transaction_splits`, `linked_refunds`, `linked_transfers`, `receipts`, `recurring_stream_transactions`, plus `holdings`, `account_balance_snapshots`, `scheduled_transactions`, `account_reconciliations`.

The insert that follows carries only the archived columns plus `user_id`. But `public.accounts` declares `plaid_item_id uuid not null` and `plaid_account_id text not null unique` (see `supabase/migrations/0001_init.sql`), and neither is in the table spec's `select` or its `restoreKeys`. The insert fails on a NOT NULL violation and `executeRestore` returns `failedTable: "accounts"`.

Net effect of pressing "Restore": every account and every transaction is deleted, and nothing is written back. This happens on the first table of every restore.

`tests/unit/restore.test.ts` passes because the Supabase client is mocked, so neither the NOT NULL constraint nor the cascade is exercised.

Same failure mode on three more tables (behind the `investmentsPage` feature flag): `holdings.security_id` (`not null`, absent from the spec), `holding_snapshots.holding_id` (references `holdings(id)`, but `holdings` has no `id` in `restoreKeys` so ids are regenerated), and `investment_transactions.account_id` / `plaid_investment_transaction_id` (both `not null`, both absent). `securities` is also ordered before `holdings` and cascades into it.

Separately, `executeRestore`'s docstring claims "a per-table, all-or-nothing restore". Delete-then-chunked-insert (`INSERT_CHUNK = 500`) is not atomic: a failure on chunk 3 of 7 leaves the table half populated with no way back. `restoreUserTable` also returns `rowsWritten: 0` on error, hiding how many rows landed.

**This is the item to think hardest about, and the one where I most want your recommendation before you write code.** The options as I see them:

- (a) Make restore correct: every restorable table's spec carries every NOT NULL column it needs, and the delete+insert pair runs inside one Postgres transaction via an RPC so a partial failure rolls back.
- (b) Cut restore from this PR: put it behind a disabled feature flag or remove the route and UI, and land the rest of #149.

Note that (a) has a knock-on consequence worth surfacing: the backup archive currently omits provider identifiers on purpose, and widening what it stores is a privacy decision, not just a schema fix. Read the backup privacy contract in `CLAUDE.md` before proposing it.

Tell me which option you recommend and why, then wait for my answer before implementing.

### 2. BLOCKER: reconcile creates a balance adjustment nobody asked for, and it counts as spending

File: `app/api/accounts/reconcile/route.ts`
Red test: `tests/unit/accounts-reconcile-route.test.ts`, "does not create an adjustment unless the user explicitly requests one"

Two problems:

1. `adjustmentAmount` is derived purely from `bookBalance - statementBalance`, and any nonzero difference inserts a synthetic row into `transactions`. There is no `create_adjustment` flag in `parseReconcilePayload`. A user who mistypes a statement balance gets a permanent fake ledger entry with no delete path. The red test (and its sibling, "inserts an adjustment entry when the user explicitly requests one") already specifies the intended contract: an explicit `create_adjustment: true` in the request body.
2. The row is written with `pfc_primary: "RECONCILE_ADJUSTMENT"`, which is not in `TRANSFER_GROUPS` in `lib/finance-domain.ts`. Because it is absent, the adjustment is counted as real spending or income in every dashboard total, category breakdown, and report. This violates the `EXCLUDED_PFC` invariant.

Fix both: gate the insert on an explicit opt-in, and add `RECONCILE_ADJUSTMENT` to `TRANSFER_GROUPS`. Check whether `components/accounts/ReconcilePanel.tsx` needs a control for the opt-in and wire it if so.

### 3. BLOCKER: transfer confirmation persists the decision before validating the pair

File: `app/api/transactions/transfers/route.ts`
Red test: `tests/unit/transactions-transfers-route.test.ts`, "validates the current pair before persisting a confirmed decision"

`POST` upserts into `transaction_review_decisions` first, then calls `linkConfirmedTransfer`, which can still return a 400 (missing `out_id`/`in_id`, `subject_id` mismatch, transactions not owned). On that path the decision row is already committed as `confirmed`, so `GET` filters the pair out of the suggestion list via `resolved`, while no `linked_transfers` row exists to net it out. The transfer silently stops being reviewable and never nets out.

Validate and link first, then record the decision.

### 4. BLOCKER: transfer link amount is taken from the request body

File: `app/api/transactions/transfers/route.ts`
Red test: `tests/unit/transactions-transfers-route.test.ts`, "derives the linked amount from the owned transactions"

`amount` comes straight from the client and is written to `linked_transfers.amount` after only a `Number.isFinite` check. A client can persist a link whose recorded amount has nothing to do with either transaction. The route already fetches both owned rows to verify ownership; select the amount there and derive the link amount from those rows instead of trusting the body.

### 5. HIGH: reconcile un-clears transactions the UI never showed

File: `app/api/accounts/reconcile/route.ts`

`GET` scopes its working set to `sinceDate`, which is the last statement date, falling back to 120 days. `syncClearedStatus` un-marks everything in scope that is not in `cleared_ids`, but computes its own scope as a flat `isoDaysAgo(LOOKBACK_DAYS)` (120 days) regardless of the last statement.

On the second and later reconciliations, saving therefore un-clears every transaction between 120 days ago and the previous statement date, rows the client never received and so never sent back. Prior reconciliation work is silently undone.

Use the same `sinceDate` derivation in both handlers. Write a test that covers a second reconciliation after a first one.

### 6. HIGH: the batch rules apply swallows write errors and reports success

File: `app/api/rules/batch/route.ts`

Both the annotation upsert and the merchant-name update discard their errors (`if (!upsertError) { appliedCount += ... }`). The route then returns `success: true` with a silently lower `appliedCount` and writes an audit row saying the batch was applied. A user whose live apply failed is told it worked.

Propagate the failure. At minimum return which writes failed, and do not write a success audit row for a run that did not succeed.

### 7. HIGH: tag automation in the rules engine is wired to nothing

Files: `app/api/rules/batch/route.ts`, `lib/rules-engine.ts`

`loadUserRules` selects `id, match_type, pattern, display_name, category, enabled`. There is no `tags` column in the query, and none in `merchant_rules`. So `SmartRule.tags` is always `undefined`, `nextTags` always equals `originalTags`, and the auto-tagging the PR advertises never fires.

The knock-on: the annotation upsert filter is `r.updated.tags.length > 0 || category changed`, so every transaction that already has tags gets a no-op annotation rewrite that inflates `appliedCount`.

Decide with me which way to go before implementing: either add a `tags` column to `merchant_rules` (new migration, applied by hand) and select it, or remove the tag path from the engine and the PR description. Do not leave it half-wired.

Separately, `applyRulesToTransaction` detects tag changes with `nextTags.length !== originalTags.length`, which cannot see a same-count tag swap. Compare contents.

### 8. MEDIUM: the regex match-type migration is untracked

`supabase/migrations/20260902220000_smart_rules_regex.sql` exists in the working tree but is not committed. Until it is committed and applied by hand, the `merchant_rules_match_type_check` constraint rejects `'regex'`, so every regex rule the settings UI offers fails on insert.

Commit it and flag clearly in your summary that it needs to be applied to the live project.

### 9. MEDIUM: the ReDoS guard is narrower than the PR claims

File: `lib/rules-engine.ts`

`hasAmbiguousQuantifiedGroup` matches `\(([^()]*)\)([*+{])`, so the group body may not itself contain parentheses. `((a+))+` passes the guard: the inner `(a+)` is not followed by a quantifier, and the outer group's body contains parens so it never matches. There is also no execution budget, so polynomial backtracking (`[a-z]+[a-z]+[a-z]+...`) is unaffected.

With a 120-character cap and a single trusted user the practical risk is low, but the PR body claims this "eliminates super-linear evaluation" and cites CWE-730. Either tighten the check to reject a quantifier applied to any group containing a quantifier or alternation at any nesting depth, or tell me and I will soften the claim instead. Add test cases for the bypass either way.

### 10. MEDIUM: regex rules mean different things on different surfaces

`lib/rules-engine.ts` tests the regex against `merchant` and `name`. `lib/planning.ts` `matchesRule` tests it against `merchant` and `accountName`. The same saved rule matches different transactions depending on which path evaluates it. Pick one definition and share it.

### 11. MEDIUM: no rate limit on the two heaviest new write routes

`/api/accounts/reconcile` inserts ledger rows. `/api/rules/batch` reads up to 5,000 transactions and bulk-writes annotations plus merchant renames. Neither calls `checkRateLimit`, while `/api/transactions/transfers` and `/api/backup/restore` in this same PR both do. Add limits consistent with the existing ones.

### 12. MEDIUM: type escape hatch in the transfers route

File: `app/api/transactions/transfers/route.ts`

`linkConfirmedTransfer` takes a conditional-type-derived parameter, casts it to a hand-written structural type, and the call site passes `supabase as never`. This turns off type checking exactly where the query shapes matter. Type the parameter as `SupabaseClient`, as every other route in the PR does.

### 13. MEDIUM: `?` cannot close the shortcuts modal

File: `lib/use-keyboard-shortcuts.ts`

`useKeyboardShortcuts` returns early whenever `isDialogOpen()` is true, and the help modal renders a `<dialog>`. So `?` opens the sheet but cannot toggle it shut, despite `toggleHelp` being written as a toggle. Escape still works via `Modal`, so this is cosmetic, but it contradicts the documented behavior.

### 14. LOW: small correctness and consistency items

- `lib/scheduled-promotion.ts`: `promoted += chunk.length` runs after an `ignoreDuplicates: true` upsert, so a re-run reports rows it skipped. Use the returned row count.
- `lib/scheduled-transactions.ts`: date validation compares against server UTC "today", so a user in PDT after 17:00 cannot schedule anything for their own today. The repo fixed a family of these in PR #145; reuse the same timezone helper.
- `app/api/transactions/transfers/route.ts` `GET`: filters `user_id` on `transactions` but not on `transaction_review_decisions` or `linked_transfers`. RLS covers it today, but `transactions` already carries a household-widened SELECT policy and the house rule is that personal reads filter explicitly. Add the filters.
- `app/api/transactions/transfers/route.ts`: `pairs.find(...)` inside a `.map` over the same list, and `app/api/accounts/reconcile/route.ts`: `new Set(clearedIds)` rebuilt per `.filter` iteration. Both accidental O(n^2). Hoist them.
- `supabase/migrations/20260902120000_linked_transfers.sql` drops `transaction_review_decisions_kind_check` without `if exists`, unlike its sibling migration, so re-running it fails.

### 15. Finally: correct three claims in the PR description

Once the code is fixed, update the PR body on GitHub. Three statements are wrong today:

1. It claims scheduled transactions support "'Once' and recurring frequencies". `scheduled_transactions` has no frequency column and `toRecurringItem` hardcodes `frequency: "once"`. One-off only.
2. The keyboard chord table is wrong. The actual mapping in `NAVIGATION_ROUTES` is `g c` for Cash Flow and `g r` for Recurring. There is no Reports chord at all.
3. It claims all SonarCloud and CodeFactor alerts are resolved. That was true of the pushed commit, but the branch has unpushed red tests and an untracked migration.

---

Start with item 1 and give me your recommendation on the restore approach before writing any code.
